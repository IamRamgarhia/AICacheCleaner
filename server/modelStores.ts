import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import type { AICacheItem } from '../src/types';
import { formatBytes, idleDaysFor, measureDirectory } from './scanner';
import { stableId } from './ids';
import { mapLimit, pathExists, readdirSafe, statSafe } from './fsAsync';

/**
 * Per-model listing for local model stores (Hugging Face hub, Ollama, LM Studio).
 *
 * The generic scanner reports these stores as one opaque multi-GB folder. Model
 * weights are the single largest thing on most AI machines, so the user needs
 * to see WHICH model is taking the space and remove only that one.
 */

export interface ModelStoreRoots {
  huggingfaceHub: string[];
  ollamaModels: string[];
  lmStudioModels: string[];
}

type ModelItem = AICacheItem & { manualCommand?: string; evidence?: string };

const CONCURRENCY = 4;
const OLLAMA_DEFAULT_REGISTRY = 'registry.ollama.ai';
// Every part of an Ollama name ends up inside a copy-paste shell command, so
// anything outside this set (quotes, &, ;, spaces) is rejected outright.
const SAFE_NAME_PART = /^[A-Za-z0-9._-]+$/;
const DIGEST = /^sha256[:-]([a-f0-9]{64})$/;

export function defaultModelStoreRoots(): ModelStoreRoots {
  const home = os.homedir();
  const env = process.env;
  const hfHub = env.HF_HUB_CACHE
    || (env.HF_HOME ? path.join(env.HF_HOME, 'hub') : path.join(home, '.cache', 'huggingface', 'hub'));
  return {
    huggingfaceHub: [hfHub],
    ollamaModels: [env.OLLAMA_MODELS || path.join(home, '.ollama', 'models')],
    lmStudioModels: [path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio', 'models')]
  };
}

export async function scanModelStores(roots: ModelStoreRoots = defaultModelStoreRoots()): Promise<AICacheItem[]> {
  const [hf, ollama, lmStudio] = await Promise.all([
    collect(roots.huggingfaceHub, scanHuggingFaceRoot),
    collect(roots.ollamaModels, scanOllamaRoot),
    collect(roots.lmStudioModels, scanLmStudioRoot)
  ]);
  return [...hf, ...ollama, ...lmStudio] as AICacheItem[];
}

async function collect(roots: string[], scan: (root: string) => Promise<ModelItem[]>): Promise<ModelItem[]> {
  const unique = [...new Set(roots.filter(Boolean).map(r => path.resolve(r)))];
  const perRoot = await Promise.all(unique.map(async root => (await pathExists(root)) ? scan(root) : []));
  return perRoot.flat();
}

const isoDay = (ms: number) => new Date(ms).toISOString().split('T')[0];

/** Real subdirectories only: a symlink/junction is never a Dirent directory, so links out of the root are skipped. */
async function subdirs(dir: string): Promise<string[]> {
  return (await readdirSafe(dir)).filter(e => e.isDirectory()).map(e => e.name);
}

// --- Hugging Face hub -------------------------------------------------------

/** `models--org--name` -> { kind: 'model', repo: 'org/name' }; null for anything else. */
export function parseHubDirName(dirName: string): { kind: 'model' | 'dataset'; repo: string } | null {
  const match = /^(models|datasets)--(.+)$/.exec(dirName);
  if (!match) return null;
  const repo = match[2].split('--').join('/');
  return { kind: match[1] === 'models' ? 'model' : 'dataset', repo };
}

async function scanHuggingFaceRoot(root: string): Promise<ModelItem[]> {
  const entries = (await subdirs(root))
    .map(name => ({ name, parsed: parseHubDirName(name) }))
    .filter((e): e is { name: string; parsed: NonNullable<ReturnType<typeof parseHubDirName>> } => e.parsed !== null);

  const items = await mapLimit(entries, CONCURRENCY, async ({ name, parsed }): Promise<ModelItem | null> => {
    const dir = path.join(root, name);
    // measureDirectory skips symlinks, so snapshot links into blobs/ are not double-counted.
    const m = await measureDirectory(dir);
    if (m.bytes === 0) return null;
    return {
      id: stableId('model-hf', dir),
      name: `Hugging Face ${parsed.kind}: ${parsed.repo}`,
      category: 'HuggingFace',
      path: dir,
      sizeBytes: m.bytes,
      formattedSize: formatBytes(m.bytes),
      tier: 'YELLOW',
      canDelete: true,
      impactDescription: `Cached ${parsed.kind} weights for ${parsed.repo}. Anything that loads it will re-download all ${formatBytes(m.bytes)} on next use.`,
      lastModified: isoDay(m.newestMtimeMs),
      safeReason: 'Download cache: nothing unique is stored here, but getting it back costs a large download.',
      evidence: 'The hub cache is a download cache managed by huggingface_hub, which re-fetches any missing file from the Hub on next load.',
      manualCommand: 'huggingface-cli delete-cache',
      idleDays: idleDaysFor(m.newestMtimeMs)
    };
  });
  return items.filter((i): i is ModelItem => i !== null);
}

// --- Ollama ----------------------------------------------------------------

interface OllamaManifest {
  registry: string;
  namespace: string;
  model: string;
  tag: string;
  file: string;
  mtimeMs: number;
  digests: string[];
}

/** Unique blob digests (hex only) referenced by a manifest's config and layers. Throws on bad JSON. */
export function manifestDigests(json: string): string[] {
  const parsed = JSON.parse(json) as { config?: { digest?: unknown }; layers?: { digest?: unknown }[] };
  const raw = [parsed?.config?.digest, ...(Array.isArray(parsed?.layers) ? parsed.layers.map(l => l?.digest) : [])];
  const hexes = raw
    .map(d => (typeof d === 'string' ? DIGEST.exec(d)?.[1] : undefined))
    .filter((h): h is string => Boolean(h));
  return [...new Set(hexes)];
}

export function ollamaDisplayName(registry: string, namespace: string, model: string, tag: string): string {
  const base = namespace === 'library' ? `${model}:${tag}` : `${namespace}/${model}:${tag}`;
  return registry === OLLAMA_DEFAULT_REGISTRY ? base : `${registry}/${namespace}/${model}:${tag}`;
}

export async function listOllamaManifests(root: string): Promise<OllamaManifest[]> {
  const manifestsDir = path.join(root, 'manifests');
  const found: Omit<OllamaManifest, 'mtimeMs' | 'digests'>[] = [];
  for (const registry of await subdirs(manifestsDir)) {
    for (const namespace of await subdirs(path.join(manifestsDir, registry))) {
      for (const model of await subdirs(path.join(manifestsDir, registry, namespace))) {
        const modelDir = path.join(manifestsDir, registry, namespace, model);
        const tags = (await readdirSafe(modelDir)).filter(e => e.isFile()).map(e => e.name);
        found.push(...tags.map(tag => ({ registry, namespace, model, tag, file: path.join(modelDir, tag) })));
      }
    }
  }

  const safe = found.filter(f => [f.registry, f.namespace, f.model, f.tag].every(p => SAFE_NAME_PART.test(p)));
  const loaded = await mapLimit(safe, CONCURRENCY, async (f): Promise<OllamaManifest | null> => {
    try {
      const [text, stat] = await Promise.all([fsp.readFile(f.file, 'utf-8'), fsp.stat(f.file)]);
      return { ...f, mtimeMs: stat.mtimeMs, digests: manifestDigests(text) };
    } catch {
      return null; // unreadable or corrupt manifest: not ours to judge, just skip it
    }
  });
  return loaded.filter((m): m is OllamaManifest => m !== null && m.digests.length > 0);
}

/** lstat so a blob that is a symlink is not followed out of the store. */
async function blobStat(root: string, hex: string) {
  try {
    const s = await fsp.lstat(path.join(root, 'blobs', `sha256-${hex}`));
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

async function scanOllamaRoot(root: string): Promise<ModelItem[]> {
  const manifests = await listOllamaManifests(root);
  const useCount = manifests
    .flatMap(m => m.digests)
    .reduce((acc, d) => acc.set(d, (acc.get(d) ?? 0) + 1), new Map<string, number>());

  const items = await mapLimit(manifests, CONCURRENCY, async (m): Promise<ModelItem | null> => {
    const blobs = (await mapLimit(m.digests, CONCURRENCY, async hex => ({ hex, stat: await blobStat(root, hex) })))
      .filter(b => b.stat !== null);
    const bytes = blobs.reduce((sum, b) => sum + b.stat!.size, 0);
    if (bytes === 0) return null;

    const name = ollamaDisplayName(m.registry, m.namespace, m.model, m.tag);
    const command = `ollama rm ${name}`;
    const shared = blobs.filter(b => (useCount.get(b.hex) ?? 0) > 1).length;
    const sharedNote = shared > 0
      ? ` ${shared} of its ${blobs.length} layers are shared with other models, so removing it may free less than ${formatBytes(bytes)}.`
      : '';
    const newest = Math.max(m.mtimeMs, ...blobs.map(b => b.stat!.mtimeMs));

    return {
      id: stableId('model-ollama', m.file),
      name: `Ollama model: ${name}`,
      category: 'Ollama',
      // The manifest file, not its folder: two tags of one model share the
      // folder, and identical paths are counted once in the totals.
      path: m.file,
      sizeBytes: bytes,
      formattedSize: formatBytes(bytes),
      tier: 'YELLOW',
      canDelete: false,
      impactDescription: `Remove it with \`${command}\` — Ollama must pull it again to use it.${sharedNote}`,
      lastModified: isoDay(m.mtimeMs),
      safeReason: 'Not deletable here: Ollama blobs are shared between models, so deleting files by hand can corrupt other models.',
      evidence: 'Ollama stores layers as content-addressed blobs referenced by several manifests; only `ollama rm` knows which blobs are still in use.',
      manualCommand: command,
      idleDays: idleDaysFor(newest)
    };
  });
  return items.filter((i): i is ModelItem => i !== null);
}

// --- LM Studio -------------------------------------------------------------

async function scanLmStudioRoot(root: string): Promise<ModelItem[]> {
  const pairs = (await Promise.all(
    (await subdirs(root)).map(async publisher =>
      (await subdirs(path.join(root, publisher))).map(model => ({ publisher, model })))
  )).flat();

  const items = await mapLimit(pairs, CONCURRENCY, async ({ publisher, model }): Promise<ModelItem | null> => {
    const dir = path.join(root, publisher, model);
    const [m, stat] = await Promise.all([measureDirectory(dir), statSafe(dir)]);
    if (m.bytes === 0 || !stat) return null;
    const repo = `${publisher}/${model}`;
    return {
      id: stableId('model-lmstudio', dir),
      name: `LM Studio model: ${repo}`,
      category: 'LM Studio',
      path: dir,
      sizeBytes: m.bytes,
      formattedSize: formatBytes(m.bytes),
      tier: 'YELLOW',
      canDelete: true,
      impactDescription: `Downloaded weights for ${repo}. Re-download it from LM Studio to use it again.`,
      lastModified: isoDay(m.newestMtimeMs || stat.mtimeMs),
      safeReason: 'Downloaded model files: nothing unique, but getting them back costs a large download.',
      evidence: 'LM Studio keeps each downloaded model in its own publisher/model folder and lists only what is present on disk.',
      idleDays: idleDaysFor(m.newestMtimeMs)
    };
  });
  return items.filter((i): i is ModelItem => i !== null);
}
