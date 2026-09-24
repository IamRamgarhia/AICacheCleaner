import path from 'path';
import crypto from 'crypto';
import fsp from 'fs/promises';
import type { DuplicateCopy, DuplicateGroup, DuplicateScanResult } from '../src/lib/types/duplicates';
import { defaultModelStoreRoots, listOllamaManifests, ollamaDisplayName, parseHubDirName, type ModelStoreRoots } from './modelStores';
import { formatBytes } from './scanner';
import { stableId } from './ids';
import { mapLimit, pathExists, readdirSafe, statSafe } from './fsAsync';

/**
 * The same multi-GB weights often sit in several stores at once: a GGUF pulled
 * into Ollama AND downloaded in LM Studio, or one Hugging Face file cached
 * under two repo names. This finds those copies.
 *
 * Only plain files may ever be moved to the Recycle Bin. Ollama and Hugging
 * Face blobs are content-addressed and referenced by manifests/snapshots, so
 * deleting one by hand silently breaks every model that points at it.
 */

export const MIN_MODEL_BYTES = 100 * 1024 * 1024;
const SAMPLE_BYTES = 8 * 1024 * 1024;
const HEX64 = /^[a-f0-9]{64}$/;
const WALK_DEPTH = 6;
const CONCURRENCY = 4;

interface Candidate extends Omit<DuplicateCopy, 'id'> {
  /** SHA-256 of the content, when the store names files by it. */
  contentId?: string;
}

interface FoundFile { path: string; size: number; inode: string }

/** Real files (symlinks/junctions are not Dirent files) of at least `minBytes`, recursively. */
async function bigFiles(dir: string, minBytes: number, depth = WALK_DEPTH): Promise<FoundFile[]> {
  const entries = await readdirSafe(dir);
  const files = await mapLimit(entries.filter(e => e.isFile()), CONCURRENCY, async e => {
    const full = path.join(dir, e.name);
    try {
      const s = await fsp.stat(full, { bigint: true });
      return s.size >= BigInt(minBytes) ? { path: full, size: Number(s.size), inode: `${s.dev}:${s.ino}` } : null;
    } catch {
      return null;
    }
  });
  const nested = depth > 0
    ? await mapLimit(entries.filter(e => e.isDirectory()), CONCURRENCY, e => bigFiles(path.join(dir, e.name), minBytes, depth - 1))
    : [];
  return [...files.filter((f): f is FoundFile => f !== null), ...nested.flat()];
}

async function ollamaCandidates(root: string, minBytes: number): Promise<(Candidate & { inode: string })[]> {
  const manifests = await listOllamaManifests(root);
  const namesByDigest = new Map<string, string[]>();
  for (const m of manifests) {
    const name = ollamaDisplayName(m.registry, m.namespace, m.model, m.tag);
    for (const d of m.digests) namesByDigest.set(d, [...(namesByDigest.get(d) ?? []), name]);
  }
  const blobs = await bigFiles(path.join(root, 'blobs'), minBytes, 0);
  return blobs.flatMap(f => {
    const hex = /^sha256-([a-f0-9]{64})$/.exec(path.basename(f.path))?.[1];
    if (!hex) return [];
    const names = namesByDigest.get(hex) ?? [];
    return [{
      path: f.path,
      inode: f.inode,
      store: 'Ollama' as const,
      modelName: names.length > 0 ? names.join(', ') : 'Unreferenced Ollama blob',
      sizeBytes: f.size,
      contentId: hex,
      trashable: false,
      command: names.length > 0 ? `ollama rm ${names.join(' ')}` : undefined,
      note: names.length > 0
        ? 'Ollama blob shared through model manifests. Deleting the file would break every model listed; remove the model with Ollama instead.'
        : 'No installed model uses this blob. Ollama removes unreferenced blobs itself the next time it starts.'
    }];
  });
}

async function huggingFaceCandidates(root: string, minBytes: number): Promise<(Candidate & { inode: string })[]> {
  const repos = (await readdirSafe(root)).filter(e => e.isDirectory()).map(e => ({ name: e.name, parsed: parseHubDirName(e.name) }));
  const perRepo = await mapLimit(repos, CONCURRENCY, async ({ name, parsed }) => {
    if (!parsed) return [];
    const dir = path.join(root, name);
    // On Windows without symlink rights, snapshots hold real copies instead of links into blobs/.
    const files = [...await bigFiles(path.join(dir, 'blobs'), minBytes, 0), ...await bigFiles(path.join(dir, 'snapshots'), minBytes)];
    return files.map(f => {
      const base = path.basename(f.path);
      return {
        path: f.path,
        inode: f.inode,
        store: 'Hugging Face' as const,
        modelName: `${parsed.kind === 'model' ? '' : 'dataset '}${parsed.repo}`,
        sizeBytes: f.size,
        // LFS blobs are named by their SHA-256; git blobs use a 40-char SHA-1 and are not matched.
        contentId: path.basename(path.dirname(f.path)) === 'blobs' && HEX64.test(base) ? base : undefined,
        trashable: false,
        command: 'huggingface-cli delete-cache',
        note: 'Hugging Face cache file referenced by repo snapshots. Deleting it by hand corrupts the cache; remove the revision with huggingface-cli instead.'
      };
    });
  });
  return perRepo.flat();
}

async function lmStudioCandidates(root: string, minBytes: number): Promise<(Candidate & { inode: string })[]> {
  return (await bigFiles(root, minBytes)).map(f => ({
    path: f.path,
    inode: f.inode,
    store: 'LM Studio' as const,
    modelName: path.relative(root, f.path).split(path.sep).slice(0, 2).join('/'),
    sizeBytes: f.size,
    trashable: true,
    note: 'Plain model file: it can go to the Recycle Bin as long as another copy stays.'
  }));
}

async function collectCandidates(roots: ModelStoreRoots, minBytes: number): Promise<Candidate[]> {
  const per = async (list: string[], fn: (r: string, m: number) => Promise<(Candidate & { inode: string })[]>) => {
    const unique = [...new Set(list.filter(Boolean).map(r => path.resolve(r)))];
    return (await Promise.all(unique.map(async r => ((await pathExists(r)) ? fn(r, minBytes) : [])))).flat();
  };
  const all = [
    ...await per(roots.ollamaModels, ollamaCandidates),
    ...await per(roots.huggingfaceHub, huggingFaceCandidates),
    ...await per(roots.lmStudioModels, lmStudioCandidates)
  ];
  // Hard links (and overlapping roots) are one file on disk: deleting one frees nothing.
  const seen = new Set<string>();
  return all.filter(c => (seen.has(c.inode) ? false : (seen.add(c.inode), true)))
    .map(({ inode: _inode, ...c }) => c);
}

/** SHA-256 over size + first and last 8 MB. Null if the file can't be read. */
export async function sampledFingerprint(file: string, size: number): Promise<string | null> {
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(file, 'r');
    const n = Math.min(SAMPLE_BYTES, size);
    const buf = Buffer.alloc(n);
    const hash = crypto.createHash('sha256').update(String(size));
    await handle.read(buf, 0, n, 0);
    hash.update(buf);
    await handle.read(buf, 0, n, size - n);
    hash.update(buf);
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

const groupBy = <T>(items: T[], key: (t: T) => string | undefined) => {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k !== undefined) map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.values()];
};

/** Split one same-size bucket into sets of matching content. */
async function matchBucket(bucket: Candidate[]): Promise<{ match: DuplicateGroup['match']; copies: Candidate[] }[]> {
  if (bucket.every(c => c.contentId)) {
    return groupBy(bucket, c => c.contentId).map(copies => ({ match: 'identical' as const, copies }));
  }
  const fps = await mapLimit(bucket, 2, c => sampledFingerprint(c.path, c.sizeBytes));
  const withFp = bucket.map((c, i) => ({ c, fp: fps[i] ?? undefined }));
  return groupBy(withFp, x => x.fp).flatMap(set => {
    const copies = set.map(x => x.c);
    const hashes = new Set(copies.map(c => c.contentId).filter(Boolean));
    // ponytail: two different known hashes behind one fingerprint is near-impossible;
    // we then trust the hashes and drop the unhashed copies rather than guess.
    if (hashes.size > 1) return groupBy(copies, c => c.contentId).map(cs => ({ match: 'identical' as const, copies: cs }));
    return [{ match: copies.every(c => c.contentId) ? 'identical' as const : 'very likely identical' as const, copies }];
  });
}

function toGroup(match: DuplicateGroup['match'], copies: DuplicateCopy[]): DuplicateGroup {
  const sizeBytes = copies[0].sizeBytes;
  const savingsBytes = sizeBytes * (copies.length - 1);
  return {
    id: stableId('dupgroup', copies.map(c => c.path).sort().join('|')),
    match,
    sizeBytes,
    formattedSize: formatBytes(sizeBytes),
    savingsBytes,
    formattedSavings: formatBytes(savingsBytes),
    copies
  };
}

function summarize(groups: DuplicateGroup[], filesChecked: number, scannedAt: string): DuplicateScanResult {
  const sorted = [...groups].sort((a, b) => b.savingsBytes - a.savingsBytes);
  const total = sorted.reduce((sum, g) => sum + g.savingsBytes, 0);
  return { groups: sorted, totalSavingsBytes: total, formattedTotalSavings: formatBytes(total), filesChecked, scannedAt };
}

export async function findDuplicateModels(
  roots: ModelStoreRoots = defaultModelStoreRoots(),
  opts: { minBytes?: number } = {}
): Promise<DuplicateScanResult> {
  const candidates = await collectCandidates(roots, opts.minBytes ?? MIN_MODEL_BYTES);
  const buckets = groupBy(candidates, c => String(c.sizeBytes)).filter(b => b.length > 1);
  const matched = (await mapLimit(buckets, CONCURRENCY, matchBucket)).flat().filter(m => m.copies.length > 1);
  const groups = matched.map(m => toGroup(m.match, m.copies.map(({ contentId: _cid, ...c }) => ({ ...c, id: stableId('dup', c.path) }))));
  return summarize(groups, candidates.length, new Date().toISOString());
}

export type TrashPlan =
  | { ok: true; copy: DuplicateCopy; group: DuplicateGroup }
  | { ok: false; status: number; error: string };

/**
 * Whether one copy may go to the Recycle Bin. Re-checks the disk: the copy
 * must still be the scanned size, and another copy must still exist.
 */
export async function planDuplicateTrash(result: DuplicateScanResult | null, id: string): Promise<TrashPlan> {
  const group = result?.groups.find(g => g.copies.some(c => c.id === id));
  const copy = group?.copies.find(c => c.id === id);
  if (!group || !copy) return { ok: false, status: 404, error: 'That copy is not in the last duplicate scan. Rescan and try again.' };
  if (!copy.trashable) {
    return { ok: false, status: 403, error: `This ${copy.store} file must not be deleted by hand. ${copy.command ? `Run \`${copy.command}\` instead.` : copy.note}` };
  }
  const now = await statSafe(copy.path);
  if (!now?.isFile() || now.size !== copy.sizeBytes) {
    return { ok: false, status: 409, error: 'This file changed or disappeared since the scan. Rescan and try again.' };
  }
  // A survivor must be a copy something keeps: an unreferenced Ollama blob is
  // pruned by Ollama itself on its next start, so it doesn't count.
  const candidates = group.copies.filter(c => c.id !== id && (c.trashable || c.command));
  const present = await mapLimit(candidates, CONCURRENCY, async c => {
    const s = await statSafe(c.path);
    return s?.isFile() && s.size === c.sizeBytes ? c : null;
  });
  const survivors = present.filter((c): c is DuplicateCopy => c !== null);
  if (survivors.length === 0) {
    return { ok: false, status: 409, error: 'Refused: this is the last remaining copy of the model, so nothing would be left.' };
  }
  // A sampled fingerprint is strong evidence, not proof (two fine-tunes can
  // share size, start and end). Before anything moves, compare every byte.
  if (group.match !== 'identical') {
    const target = await fullHash(copy.path);
    let proven = false;
    for (const s of survivors) {
      if (target && (await fullHash(s.path)) === target) { proven = true; break; }
    }
    if (!proven) {
      return { ok: false, status: 409, error: 'Refused: a full comparison shows these files are not identical, so this may be a different model.' };
    }
  }
  return { ok: true, copy, group };
}

/** SHA-256 of a whole file, streamed; null when it can't be read. */
async function fullHash(file: string): Promise<string | null> {
  try {
    const hash = crypto.createHash('sha256');
    const handle = await fsp.open(file, 'r');
    try {
      for await (const chunk of handle.createReadStream({ highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk as Buffer);
    } finally {
      await handle.close();
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/** The result with one copy removed; groups left with a single copy disappear. */
export function withoutCopy(result: DuplicateScanResult, id: string): DuplicateScanResult {
  const groups = result.groups
    .map(g => ({ g, copies: g.copies.filter(c => c.id !== id) }))
    .filter(x => x.copies.length > 1)
    .map(x => (x.copies.length === x.g.copies.length ? x.g : { ...toGroup(x.g.match, x.copies), id: x.g.id }));
  return summarize(groups, result.filesChecked, result.scannedAt);
}
