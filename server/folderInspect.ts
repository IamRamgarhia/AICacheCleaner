import path from 'path';
import { measureDirectory } from './scanner';
import { mapLimit, readdirSafe, statSafe } from './fsAsync';

export interface FolderChild {
  name: string;
  path: string;
  bytes: number;
  isDir: boolean;
  newestMtimeMs: number;
  /** True until this child has been measured (live snapshots only). */
  pending?: boolean;
}

export interface FolderInspection {
  path: string;
  totalBytes: number;
  childCount: number;
  children: FolderChild[];
  measuredAt: number;
  done: boolean;
}

// Measuring a big folder takes seconds; the details pane and the disk explorer
// ask for the same folders repeatedly while the user clicks around.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, FolderInspection>();
const jobs = new Map<string, { children: Map<string, FolderChild>; promise: Promise<FolderInspection> }>();

const sortBySize = (list: FolderChild[]) => [...list].sort((a, b) => b.bytes - a.bytes);

function snapshot(dir: string, children: FolderChild[], done: boolean, limit: number): FolderInspection {
  const sorted = sortBySize(children);
  return {
    path: dir,
    totalBytes: sorted.reduce((acc, c) => acc + c.bytes, 0),
    childCount: sorted.length,
    children: sorted.slice(0, limit),
    measuredAt: Date.now(),
    done
  };
}

function startJob(dir: string, key: string) {
  const children = new Map<string, FolderChild>();
  const promise = (async () => {
    const entries = await readdirSafe(dir);
    // List everything first (pending), so a live view shows all names at once.
    for (const e of entries) {
      children.set(e.name, { name: e.name, path: path.join(dir, e.name), bytes: 0, isDir: e.isDirectory(), newestMtimeMs: 0, pending: true });
    }
    await mapLimit(entries, 4, async e => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const m = await measureDirectory(full, 'low');
        children.set(e.name, { name: e.name, path: full, bytes: m.bytes, isDir: true, newestMtimeMs: m.newestMtimeMs });
      } else {
        // Symlinks/junctions are listed with 0 bytes and never followed.
        const s = e.isFile() ? await statSafe(full) : null;
        children.set(e.name, { name: e.name, path: full, bytes: s?.size ?? 0, isDir: false, newestMtimeMs: s?.mtimeMs ?? 0 });
      }
    });
    const result = snapshot(dir, [...children.values()], true, Number.MAX_SAFE_INTEGER);
    cache.set(key, result);
    return result;
  })().finally(() => jobs.delete(key));
  const job = { children, promise };
  jobs.set(key, job);
  return job;
}

/**
 * What a folder holds, largest first. Read-only: it only lists and sizes.
 * With `live`, returns immediately with whatever is measured so far (pending
 * children included) so a big folder fills in progressively.
 */
export async function inspectFolder(dir: string, limit = 50, live = false): Promise<FolderInspection> {
  const key = path.normalize(dir).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.measuredAt < CACHE_MS) return { ...hit, children: hit.children.slice(0, limit) };

  const job = jobs.get(key) ?? startJob(dir, key);
  if (live) {
    // Give a short head start so small folders come back complete in one call.
    await Promise.race([job.promise, new Promise(r => setTimeout(r, 400))]);
    const done = cache.get(key);
    if (done) return { ...done, children: done.children.slice(0, limit) };
    return snapshot(dir, [...job.children.values()], false, limit);
  }
  const result = await job.promise;
  return { ...result, children: result.children.slice(0, limit) };
}

/** Forget cached sizes under a path (after a delete changed them). */
export function invalidateInspections(changedPath: string): void {
  const p = path.normalize(changedPath).toLowerCase();
  for (const key of cache.keys()) {
    if (key === p || key.startsWith(p + path.sep) || p.startsWith(key + path.sep)) cache.delete(key);
  }
}
