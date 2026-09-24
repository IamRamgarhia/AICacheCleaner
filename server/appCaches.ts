import path from 'path';
import os from 'os';
import type { AICacheItem } from '../src/types';
import { mapLimit, readdirSafe } from './fsAsync';
import { stableId } from './ids';
import { formatBytes, idleDaysFor, measureDirectory } from './scanner';

/**
 * Generic Chromium/Electron cache discovery.
 *
 * The fixed cache table only knew apps someone had written down, which is how
 * Chrome's 4 GB on-device model went unnoticed. Every Chromium-based app —
 * Chrome, Edge, Brave, VS Code, Cursor, Slack, Discord, WhatsApp, Claude… —
 * keeps the same disposable cache folders next to the same profile files, so
 * we find them by that layout instead of by app name.
 */

// Folder names Chromium uses for caches it recreates on demand: the HTTP disk
// cache, V8 compiled-code cache, and GPU/shader caches.
// https://www.chromium.org/developers/design-documents/network-stack/disk-cache/
const CACHE_DIRS = new Set([
  'cache', 'code cache', 'gpucache', 'dawncache', 'dawngraphitecache', 'dawnwebgpucache',
  'graphitedawncache', 'grshadercache', 'shadercache', 'cacheddata'
]);

// A folder only counts as a Chromium profile if it has these beside the cache,
// so an unrelated app's folder that happens to be called "Cache" is ignored.
const PROFILE_MARKERS = ['local storage', 'preferences', 'network', 'indexeddb', 'session storage', 'code cache', 'gpucache'];

const MIN_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 4;

export function appCacheRoots(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    ];
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support')];
  return [process.env.XDG_CONFIG_HOME || path.join(home, '.config')];
}

/** "Google\Chrome\User Data\Default" -> "Google Chrome · Default". */
export function appLabel(root: string, profileDir: string): string {
  const parts = path.relative(root, profileDir).split(/[\\/]/)
    .filter(p => p && !/^(user data|ebwebview|partitions|webview2?)$/i.test(p));
  if (parts.length <= 1) return parts[0] || path.basename(profileDir);
  const last = parts[parts.length - 1];
  const isProfile = /^(default|profile \d+|guest profile)$/i.test(last);
  return isProfile ? `${parts.slice(0, -1).join(' ')} · ${last}` : parts.join(' ');
}

/** True when `child` is `parent` or lies under it. */
function isInside(child: string, parent: string): boolean {
  const c = path.normalize(child).toLowerCase();
  const p = path.normalize(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}

interface Found { root: string; profileDir: string; cacheDir: string; cacheName: string }

async function findCacheDirs(root: string): Promise<Found[]> {
  const found: Found[] = [];
  let frontier = [{ dir: root, depth: 0 }];
  while (frontier.length > 0) {
    const next: { dir: string; depth: number }[] = [];
    await mapLimit(frontier, 8, async ({ dir, depth }) => {
      const entries = (await readdirSafe(dir)).filter(e => e.isDirectory());
      const names = new Set(entries.map(e => e.name.toLowerCase()));
      const isProfile = depth > 0 && PROFILE_MARKERS.filter(m => names.has(m)).length >= 2;
      for (const e of entries) {
        const lower = e.name.toLowerCase();
        const full = path.join(dir, e.name);
        if (isProfile && CACHE_DIRS.has(lower)) {
          found.push({ root, profileDir: dir, cacheDir: full, cacheName: e.name });
        } else if (depth < MAX_DEPTH && !CACHE_DIRS.has(lower)) {
          next.push({ dir: full, depth: depth + 1 });
        }
      }
    });
    frontier = next;
  }
  return found;
}

export async function scanAppCaches(known: AICacheItem[], roots: string[] = appCacheRoots()): Promise<AICacheItem[]> {
  const candidates = (await Promise.all(roots.map(findCacheDirs))).flat()
    // Our own profile is in use while we run; never offer it.
    .filter(f => !/ai-?cache-?cleaner/i.test(f.profileDir))
    // Skip when something known already sits inside this cache, or when the
    // cache is inside an item that is itself safe to delete. A cache inside a
    // "your data" folder IS offered: deleting just the cache is the safe option.
    .filter(f => !known.some(k => isInside(k.path, f.cacheDir) || (k.tier === 'GREEN' && isInside(f.cacheDir, k.path))));

  const items = await mapLimit(candidates, 4, async (f): Promise<AICacheItem | null> => {
    const m = await measureDirectory(f.cacheDir);
    if (m.bytes < MIN_BYTES) return null;
    const app = appLabel(f.root, f.profileDir);
    return {
      id: stableId('appcache', f.cacheDir),
      name: `${app} — ${f.cacheName}`,
      category: 'App caches',
      path: f.cacheDir,
      sizeBytes: m.bytes,
      formattedSize: formatBytes(m.bytes),
      tier: 'GREEN',
      canDelete: true,
      impactDescription: `${app} rebuilds this cache on its next launch. Close ${app} first so the files aren't in use.`,
      lastModified: new Date(m.newestMtimeMs || Date.now()).toISOString().split('T')[0],
      safeReason: 'Chromium disposable cache (web, compiled-code or GPU shader cache). No settings, logins or history live here.',
      evidence: 'Chromium keeps its HTTP disk cache, V8 code cache and GPU shader caches as disposable data it recreates when missing.',
      idleDays: idleDaysFor(m.newestMtimeMs)
    };
  });
  return items.filter((i): i is AICacheItem => i !== null);
}
