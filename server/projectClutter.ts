import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import type { ClutterItem, ClutterKind, ClutterScanResult } from '../src/lib/types/clutter';
import { formatBytes, idleDaysFor, measureDirectory } from './scanner';
import { stableId } from './ids';
import { mapLimit, pathExists, readdirSafe, statSafe } from './fsAsync';
import { discoverProjects } from './projectLinker';
import { listDrives } from './drives';

/**
 * Rebuildable build/dependency folders inside project trees (node_modules,
 * virtualenvs, Rust target/, framework caches). Each kind is only reported
 * when the file that can rebuild it sits next to it, so a hand-made `dist`
 * or a folder that merely happens to be called `venv` is never offered.
 */

export const RECENT_DAYS = 14;
const DAY_MS = 86_400_000;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_DIRS = 60_000;
const WALK_CONCURRENCY = 16;
const MEASURE_CONCURRENCY = 4;

const JS_CLUTTER = new Set(['node_modules', '.next', '.nuxt', '.turbo', '.parcel-cache']);
const NEVER_DESCEND = new Set(['node_modules', '__pycache__']);
const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod'];
// OS and app-data trees: node_modules in there are installed tools, not project clutter.
const SKIP_NAMES = new Set(['appdata', 'program files', 'program files (x86)', 'programdata', 'windows', 'system volume information', 'library']);

export interface ClutterScanOptions {
  maxDepth?: number;
  maxDirs?: number;
  recentDays?: number;
  now?: number;
}

interface Found { projectPath: string; kind: ClutterKind; path: string }
interface Visit { dir: string; depth: number; project: string | null }

const fold = (p: string) => path.normalize(p).toLowerCase();
const skipName = (name: string) => name.startsWith('.') || name.startsWith('$') || SKIP_NAMES.has(name.toLowerCase());

async function hasBuildScript(dir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf-8')) as { scripts?: Record<string, unknown> };
    return typeof pkg?.scripts?.build === 'string';
  } catch {
    return false;
  }
}

/** True when the project's .gitignore lists this folder — i.e. the project itself says it's generated. */
async function gitIgnores(dir: string, name: string): Promise<boolean> {
  try {
    const lines = (await fsp.readFile(path.join(dir, '.gitignore'), 'utf-8')).split(/\r?\n/).map(l => l.trim());
    return lines.some(l => new RegExp(`^/?${name}/?$`).test(l));
  } catch {
    return false;
  }
}

// Files that record how to rebuild a Python environment. A venv without one
// (e.g. ComfyUI's, with hand-installed CUDA wheels) can't be recreated.
const PY_RECIPES = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'environment.yml', 'uv.lock', 'poetry.lock'];

async function classify(name: string, dir: string, files: Set<string>, buildScript: () => Promise<boolean>): Promise<ClutterKind | null> {
  if (JS_CLUTTER.has(name)) return files.has('package.json') ? (name as ClutterKind) : null;
  if (name === '__pycache__') return '__pycache__';
  if (name === '.venv' || name === 'venv') {
    return PY_RECIPES.some(f => files.has(f)) && (await pathExists(path.join(dir, name, 'pyvenv.cfg'))) ? name : null;
  }
  if (name === 'target') return files.has('Cargo.toml') ? 'target' : null;
  // A build script alone isn't enough: electron-builder keeps hand-made icons
  // and installer scripts in build/. Only output the project ignores in git.
  if (name === 'dist' || name === 'build') {
    return files.has('package.json') && (await buildScript()) && (await gitIgnores(dir, name)) ? name : null;
  }
  return null;
}

async function visitDir(v: Visit, maxDepth: number): Promise<{ found: Found[]; next: Visit[] }> {
  const entries = await readdirSafe(v.dir);
  const files = new Set(entries.filter(e => e.isFile()).map(e => e.name));
  const isProject = PROJECT_MARKERS.some(m => files.has(m)) || entries.some(e => e.isDirectory() && e.name === '.git');
  const project = isProject ? v.dir : v.project;
  let script: Promise<boolean> | undefined;
  const buildScript = () => (script ??= hasBuildScript(v.dir));

  const found: Found[] = [];
  const next: Visit[] = [];
  for (const e of entries) {
    // Dirent.isDirectory() is false for symlinks and junctions, so links are never followed.
    if (!e.isDirectory()) continue;
    const full = path.join(v.dir, e.name);
    const kind = await classify(e.name, v.dir, files, buildScript);
    if (kind) found.push({ projectPath: project ?? v.dir, kind, path: full });
    else if (!NEVER_DESCEND.has(e.name) && !skipName(e.name) && v.depth < maxDepth) {
      next.push({ dir: full, depth: v.depth + 1, project });
    }
  }
  return { found, next };
}

/** Breadth-first search for clutter folders, bounded by depth and a total directory cap. */
export async function walkForClutter(roots: string[], maxDepth: number, maxDirs: number) {
  const visited = new Set<string>();
  let frontier: Visit[] = [];
  for (const root of roots.map(r => path.resolve(r))) {
    if (visited.has(fold(root))) continue;
    visited.add(fold(root));
    frontier.push({ dir: root, depth: 0, project: null });
  }
  const found: Found[] = [];
  let dirsVisited = 0;
  let truncated = false;
  while (frontier.length > 0) {
    const batch = frontier.slice(0, Math.max(0, maxDirs - dirsVisited));
    if (batch.length < frontier.length) truncated = true;
    if (batch.length === 0) break;
    dirsVisited += batch.length;
    const results = await mapLimit(batch, WALK_CONCURRENCY, v => visitDir(v, maxDepth));
    frontier = [];
    for (const r of results) {
      found.push(...r.found);
      for (const n of r.next) {
        if (!visited.has(fold(n.dir))) {
          visited.add(fold(n.dir));
          frontier.push(n);
        }
      }
    }
  }
  return { found, dirsVisited, truncated };
}

/** Newest file mtime under `dir`, skipping .git and every clutter folder inside it. */
async function newestSourceMtime(dir: string, clutter: string[]): Promise<number> {
  const prefix = fold(dir) + path.sep;
  if (!clutter.some(c => c.startsWith(prefix))) return (await measureDirectory(dir, 'low')).newestMtimeMs;
  const entries = await readdirSafe(dir);
  const times = await mapLimit(entries, MEASURE_CONCURRENCY, async e => {
    const full = path.join(dir, e.name);
    if (e.isFile()) return (await statSafe(full))?.mtimeMs ?? 0;
    if (!e.isDirectory() || e.name === '.git' || clutter.includes(fold(full))) return 0;
    return newestSourceMtime(full, clutter);
  });
  return Math.max(0, ...times);
}

/** Home, common dev folders, projects that have AI data, and non-system drive roots. */
export async function defaultClutterRoots(): Promise<string[]> {
  const home = os.homedir();
  let linked: string[] = [];
  try {
    linked = discoverProjects().filter(p => p.exists).map(p => p.projectPath);
  } catch {
    linked = []; // AI history is optional context; the default folders still cover most projects
  }
  const dev = ['Documents', 'source', 'repos', 'projects', 'dev', 'code'].map(d => path.join(home, d));
  const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase();
  const drives = process.platform === 'win32'
    ? (await listDrives()).map(d => d.root).filter(r => !r.toUpperCase().startsWith(systemDrive))
    : [];
  // Specific roots first: once a folder is visited, broader roots skip it.
  const candidates = [...linked, ...dev, ...drives, home];
  const present = await Promise.all(candidates.map(pathExists));
  return candidates.filter((_, i) => present[i]);
}

export async function findProjectClutter(roots: string[], opts: ClutterScanOptions = {}): Promise<ClutterScanResult> {
  const recentDays = opts.recentDays ?? RECENT_DAYS;
  const now = opts.now ?? Date.now();
  const { found, dirsVisited, truncated } = await walkForClutter(roots, opts.maxDepth ?? DEFAULT_MAX_DEPTH, opts.maxDirs ?? DEFAULT_MAX_DIRS);

  // __pycache__ is scattered through a package tree: one row per project.
  const byKey = new Map<string, Omit<Found, 'path'> & { paths: string[] }>();
  for (const f of found) {
    const key = f.kind === '__pycache__' ? `${fold(f.projectPath)}|__pycache__` : fold(f.path);
    const prev = byKey.get(key);
    byKey.set(key, { projectPath: f.projectPath, kind: f.kind, paths: [...(prev?.paths ?? []), f.path] });
  }

  const clutterPaths = found.map(f => fold(f.path));
  const touched = new Map<string, Promise<number>>();
  const lastTouched = (p: string) => {
    if (!touched.has(fold(p))) touched.set(fold(p), newestSourceMtime(p, clutterPaths));
    return touched.get(fold(p))!;
  };

  const measured = await mapLimit([...byKey.values()], MEASURE_CONCURRENCY, async (g): Promise<ClutterItem | null> => {
    const sizes = await Promise.all(g.paths.map(p => measureDirectory(p, 'low')));
    const sizeBytes = sizes.reduce((sum, s) => sum + s.bytes, 0);
    if (sizeBytes === 0) return null;
    const projectLastTouchedMs = await lastTouched(g.projectPath);
    return {
      id: stableId('clutter', g.kind === '__pycache__' ? `${g.projectPath}|__pycache__` : g.paths[0]),
      projectPath: g.projectPath,
      kind: g.kind,
      paths: g.paths,
      sizeBytes,
      formattedSize: formatBytes(sizeBytes),
      projectLastTouchedMs,
      idleDays: idleDaysFor(projectLastTouchedMs),
      // Unknown age counts as recent: never assume a project is abandoned.
      recent: !projectLastTouchedMs || now - projectLastTouchedMs < recentDays * DAY_MS
    };
  });

  const items = measured.filter((i): i is ClutterItem => i !== null).sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  return {
    items,
    totalBytes,
    formattedTotal: formatBytes(totalBytes),
    roots,
    truncated,
    dirsVisited,
    recentDays,
    scannedAt: new Date(now).toISOString()
  };
}

/** Which requested items may move. Unknown ids are reported separately (the route rejects them). */
export function planClutterTrash(result: ClutterScanResult, ids: string[], includeRecent: boolean) {
  const byId = new Map(result.items.map(i => [i.id, i]));
  const unknown = ids.filter(id => !byId.has(id));
  const requested = ids.map(id => byId.get(id)).filter((i): i is ClutterItem => i !== undefined);
  const refused = requested
    .filter(i => i.recent && !includeRecent)
    .map(i => ({ id: i.id, reason: `the project was changed within the last ${result.recentDays} days — confirm recent projects explicitly to include it` }));
  const refusedIds = new Set(refused.map(r => r.id));
  return { toMove: requested.filter(i => !refusedIds.has(i.id)), refused, unknown };
}

/** The result without the given items. */
export function withoutClutter(result: ClutterScanResult, ids: Set<string>): ClutterScanResult {
  const items = result.items.filter(i => !ids.has(i.id));
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  return { ...result, items, totalBytes, formattedTotal: formatBytes(totalBytes) };
}
