import path from 'path';
import os from 'os';
import type { AICacheItem, SafetyTier } from '../src/types';
import { mapLimit, pathExists, readdirSafe, statSafe } from './fsAsync';
import { discoverAITools } from './aiToolRegistry';
import { dockerStoredBytes } from './dockerUsage';

// How many directory reads / file stats may be in flight at once. High enough
// to keep the disk busy, low enough to stay well under the fd limit.
const IO_CONCURRENCY = 16;

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Prevents double-counting nested subfolders
export function calculateNonOverlappingSize(items: AICacheItem[]): number {
  if (!items || items.length === 0) return 0;
  
  const sorted = [...items].sort((a, b) => a.path.length - b.path.length);
  const countedRoots: string[] = [];
  let totalBytes = 0;

  for (const item of sorted) {
    const normPath = path.normalize(item.path).toLowerCase();
    
    const isEnclosed = countedRoots.some(root => {
      const normRoot = path.normalize(root).toLowerCase();
      return normPath === normRoot || normPath.startsWith(normRoot + path.sep);
    });

    if (!isEnclosed) {
      countedRoots.push(item.path);
      totalBytes += item.sizeBytes;
    }
  }

  return totalBytes;
}

/** Days since the newest file inside a directory was written. */
export function idleDaysFor(newestMtimeMs: number): number | undefined {
  if (!newestMtimeMs) return undefined;
  return Math.max(0, Math.round((Date.now() - newestMtimeMs) / 86_400_000));
}

// Breadth-first, bounded-concurrency directory size calculation.
//
// This was previously a synchronous readdirSync/statSync walk. Because the
// Express server runs inside the Electron main process, a single scan pegged
// the event loop for the whole walk — measured at 43 s on a normal dev machine,
// during which a trivial GET /api/config took 15.7 s to answer and the window
// stopped responding. Every await below is a yield point, so the server stays
// responsive while the disk work happens.
export async function getDirectorySize(dirPath: string): Promise<number> {
  return (await measureDirectory(dirPath)).bytes;
}

/**
 * Size AND newest-file timestamp in one walk.
 *
 * The newest mtime is what tells you a folder is abandoned. A directory's own
 * mtime does not change when a file several levels down is edited, so the
 * folder timestamp alone is worthless for staleness.
 */
export async function measureDirectory(dirPath: string): Promise<{ bytes: number; newestMtimeMs: number }> {
  const rootStat = await statSafe(dirPath);
  if (!rootStat) return { bytes: 0, newestMtimeMs: 0 };
  if (!rootStat.isDirectory()) return { bytes: rootStat.size, newestMtimeMs: rootStat.mtimeMs };

  let newestMtimeMs = 0;
  let totalSize = 0;
  let frontier: string[] = [dirPath];

  while (frontier.length > 0) {
    const levelResults = await mapLimit(frontier, IO_CONCURRENCY, async (dir) => {
      const entries = await readdirSafe(dir);
      const childDirs: string[] = [];
      const filePaths: string[] = [];

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        // Symlinks/junctions are deliberately not followed: they would both
        // double-count and risk cycles.
        if (entry.isDirectory()) childDirs.push(full);
        else if (entry.isFile()) filePaths.push(full);
      }

      const stats = await mapLimit(filePaths, IO_CONCURRENCY, statSafe);
      let size = 0;
      let newest = 0;
      for (const s of stats) {
        if (!s) continue;
        size += s.size;
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      }

      return { size, childDirs, newest };
    });

    const nextFrontier: string[] = [];
    for (const result of levelResults) {
      totalSize += result.size;
      if (result.newest > newestMtimeMs) newestMtimeMs = result.newest;
      nextFrontier.push(...result.childDirs);
    }
    frontier = nextFrontier;
  }

  return { bytes: totalSize, newestMtimeMs };
}

// File extensions that mark a directory as a downloaded-media folder rather
// than a project. Matched with endsWith, never substring: `includes('.ai')`
// used to reject legitimate paths such as `~/.ai-cache-cleaner` (this app's own
// data directory) and any folder named e.g. `my.aiproject`.
export const JUNK_EXTENSIONS = [
  '.avif', '.crdownload', '.doc', '.docx', '.exe', '.gz', '.jpeg', '.jpg',
  '.png', '.gif', '.svg', '.webp', '.psd', '.ai', '.pdf', '.xlsx', '.pptx',
  '.zip', '.rar', '.7z', '.tar', '.dll', '.iso', '.mp4', '.avi', '.mov', '.mp3'
];

export function hasJunkExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return JUNK_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// Strict AI / Software Project Fingerprint Verifier
export async function isGenuineAIProject(dirPath: string): Promise<boolean> {
  const stats = await statSafe(dirPath);
  if (!stats || !stats.isDirectory()) return false;

  try {
    const folderName = path.basename(dirPath).toLowerCase();
    const fullPathLower = dirPath.toLowerCase();

    // REJECT dot folders, hidden system folders, download directories, or file extensions
    if (folderName.startsWith('.')) return false;
    if (fullPathLower.includes('\\downl') || fullPathLower.includes('\\downloads') || fullPathLower.includes('\\temp') || fullPathLower.includes('$recycle')) return false;

    if (hasJunkExtension(folderName)) {
      return false;
    }

    // REQUIRE AI / Code Project Fingerprint Files
    const subFiles = (await readdirSafe(dirPath)).map(f => f.name.toLowerCase());
    const aiCodeFingerprints = [
      'package.json',
      '.git',
      '.cursor',
      '.cursorrules',
      '.gemini',
      'antigravity',
      'pyproject.toml',
      'requirements.txt',
      'tsconfig.json',
      'vite.config.ts',
      'vite.config.js',
      'next.config.js',
      'next.config.mjs',
      'index.html',
      'server.js',
      'app.js',
      'app.py',
      'main.py',
      'manage.py',
      'docker-compose.yml',
      'node_modules',
      'src'
    ];

    return aiCodeFingerprints.some(fp => subFiles.includes(fp));
  } catch (e) {
    return false;
  }
}

export async function isLocalhostRunnable(dirPath: string): Promise<boolean> {
  const stats = await statSafe(dirPath);
  if (!stats || !stats.isDirectory()) return false;

  try {
    const files = (await readdirSafe(dirPath)).map(f => f.name.toLowerCase());
    const webMarkers = [
      'package.json',
      'vite.config.ts',
      'vite.config.js',
      'next.config.js',
      'next.config.mjs',
      'index.html',
      'server.js',
      'app.js',
      'app.py',
      'main.py',
      'manage.py',
      'docker-compose.yml'
    ];

    return webMarkers.some(marker => files.includes(marker));
  } catch (e) {
    return false;
  }
}

function isSkippableTopLevelDir(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('$') ||
    lower.includes('system') ||
    lower === 'windows' ||
    lower.startsWith('.') ||
    lower.includes('downl') ||
    lower.includes('temp')
  );
}

async function buildProjectItem(
  projectPath: string,
  id: string,
  name: string,
  root: string,
  descriptor: string
): Promise<AICacheItem | null> {
  const size = await getDirectorySize(projectPath);
  if (size <= 0) return null;

  const stat = await statSafe(projectPath);
  if (!stat) return null;

  const runnable = await isLocalhostRunnable(projectPath);
  const drive = root.substring(0, 2);

  return {
    id,
    name,
    // Was hardcoded 'Antigravity', which filed every project on D: under one
    // AI tool. And a project is source code: shown for size, never deletable.
    category: 'Your projects',
    path: projectPath,
    sizeBytes: size,
    formattedSize: formatBytes(size),
    tier: 'YELLOW',
    canDelete: false,
    impactDescription: `Verified ${descriptor} on Drive ${drive}.${runnable ? ' Runnable on Localhost.' : ''}`,
    lastModified: stat.mtime.toISOString().split('T')[0],
    safeReason: 'Your source code — this app only reports its size. Remove a project yourself if you mean to.',
    isRunnableProject: runnable
  };
}

async function scanSecondaryDrives(): Promise<AICacheItem[]> {
  const items: AICacheItem[] = [];
  const secondaryDriveRoots = ['D:\\', 'E:\\', 'F:\\'];

  for (const root of secondaryDriveRoots) {
    if (!(await pathExists(root))) continue;

    const topEntries = (await readdirSafe(root)).filter(
      e => e.isDirectory() && !isSkippableTopLevelDir(e.name)
    );

    // Each top-level directory is inspected independently and concurrently.
    const perTop = await mapLimit(topEntries, 4, async (entry) => {
      const found: AICacheItem[] = [];
      const firstLevelPath = path.join(root, entry.name);

      if (await isGenuineAIProject(firstLevelPath)) {
        const item = await buildProjectItem(
          firstLevelPath,
          `secondary-${root.charAt(0)}-top-${entry.name}`,
          `AI Root Workspace: ${entry.name} (${root.substring(0, 2)})`,
          root,
          'top-level AI coding project'
        );
        if (item) found.push(item);
      }

      const childEntries = (await readdirSafe(firstLevelPath)).filter(c => c.isDirectory());
      const childItems = await mapLimit(childEntries, 4, async (child) => {
        const childPath = path.join(firstLevelPath, child.name);
        if (!(await isGenuineAIProject(childPath))) return null;
        return buildProjectItem(
          childPath,
          `secondary-${root.charAt(0)}-${entry.name}-${child.name}`,
          `AI Project: ${entry.name}/${child.name} (${root.substring(0, 2)})`,
          root,
          'AI coding project'
        );
      });

      for (const item of childItems) if (item) found.push(item);
      return found;
    });

    for (const group of perTop) items.push(...group);
  }

  return items;
}

function overlaps(a: string, b: string): boolean {
  const x = path.normalize(a).toLowerCase();
  const y = path.normalize(b).toLowerCase();
  return x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep);
}

/** Where a folder sits, so two folders both named "Antigravity IDE" are told apart. */
function locationKind(dir: string): string {
  const d = dir.toLowerCase();
  if (d.includes(`${path.sep}programs${path.sep}`) || d.includes('program files')) return 'installed app';
  if (d.includes(`${path.sep}roaming${path.sep}`)) return 'settings & state';
  if (d.includes(`${path.sep}.cache${path.sep}`) || d.includes(`${path.sep}local${path.sep}`)) return 'local data';
  return 'user folder';
}

const LOCK_MARKERS: { match: RegExp; reason: string }[] = [
  { match: /^(update\.exe|app-\d[\w.]*|.+\.exe)$/i, reason: 'program files' },
  { match: /^(\.git|package\.json|pyproject\.toml)$/i, reason: 'source code or a git repository' },
  { match: /^(auth\.json|\.?credentials(\.json)?|.+\.pem)$/i, reason: 'login credentials' },
  { match: /\.(sqlite3?|db)$/i, reason: 'a database' }
];

/**
 * Why a discovered folder must not be offered for deletion, or null. Checks the
 * folder and its direct children (a worktrees folder holds repos one level down).
 */
async function lockReason(dir: string): Promise<string | null> {
  const hit = (names: string[]) => LOCK_MARKERS.find(m => names.some(n => m.match.test(n)))?.reason ?? null;
  const top = await readdirSafe(dir);
  const own = hit(top.map(e => e.name));
  if (own) return own;
  const children = top.filter(e => e.isDirectory()).slice(0, 200);
  const nested = await mapLimit(children, IO_CONCURRENCY, async c =>
    hit((await readdirSafe(path.join(dir, c.name))).map(e => e.name).filter(n => !/\.exe$/i.test(n))));
  return nested.find(r => r !== null) ?? null;
}

/**
 * Folders the tool discovery found that the fixed table above doesn't cover
 * (e.g. ~/.antigravity-ide, ~/AppData/Roaming/Antigravity, ms-playwright).
 * Without this the software view and the storage list disagreed on totals.
 * Contents are unverified app data: YELLOW, so deleting needs the explicit
 * acknowledgement in the pre-delete dialog.
 */
async function scanDiscoveredToolFolders(known: AICacheItem[]): Promise<AICacheItem[]> {
  const tools = await discoverAITools();
  const candidates = tools.flatMap(t => t.paths.map(p => ({ tool: t, path: p })))
    .filter(c => !known.some(k => overlaps(k.path, c.path)));

  const measured = await mapLimit(candidates, 4, async ({ tool, path: dir }) => {
    const stat = await statSafe(dir);
    if (!stat) return null;
    const m = await measureDirectory(dir);
    if (m.bytes === 0) return null;
    const lockedBecause = await lockReason(dir);
    const kind = lockedBecause === 'program files' ? 'installed app' : locationKind(dir);
    const item: AICacheItem = {
      id: `discovered-${dir.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${tool.name} — ${path.basename(dir)} (${kind})`,
      category: tool.name,
      path: dir,
      sizeBytes: m.bytes,
      formattedSize: formatBytes(m.bytes),
      tier: 'YELLOW',
      // Program folders are removed by uninstalling; folders holding code,
      // databases or logins are never offered — open them and decide by hand.
      canDelete: kind !== 'installed app' && !lockedBecause,
      impactDescription: kind === 'installed app'
        ? `${tool.kind} program files. Uninstall it from Windows Settings > Apps instead of deleting the folder.`
        : lockedBecause
          ? `${tool.kind} data that contains ${lockedBecause}. Not deletable here — open the folder and remove only what you are sure of.`
          : `${tool.kind} data found on disk. May hold settings, extensions, chats or history — open the folder and check before deleting.`,
      lastModified: stat.mtime.toISOString().split('T')[0],
      safeReason: lockedBecause || kind === 'installed app'
        ? 'Locked: deleting this could lose code, logins, databases or break the app.'
        : 'Not verified as rebuildable. Deleting goes to the Recycle Bin after a caution prompt.',
      idleDays: idleDaysFor(m.newestMtimeMs)
    };
    return item;
  });
  // Nested discoveries (a tool folder inside another) would double-list bytes.
  const found = measured.filter((i): i is AICacheItem => i !== null)
    .sort((a, b) => a.path.length - b.path.length);
  return found.filter((item, idx) => !found.slice(0, idx).some(prev => overlaps(prev.path, item.path)));
}

export async function scanAICaches(): Promise<AICacheItem[]> {
  const homeDir = os.homedir();
  const isWindows = process.platform === 'win32';
  const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');

  const targets: AICacheItem[] = [];

  const scanDefinitions = [
    {
      id: 'cursor-cache-data',
      name: 'Cursor Chromium UI Cache_Data (C:)',
      category: 'Cursor' as const,
      path: isWindows ? path.join(appData, 'Cursor', 'Cache', 'Cache_Data') : path.join(homeDir, 'Library', 'Caches', 'Cursor', 'Cache_Data'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: '100% Safe. Temporary UI graphics & Chromium webview cache. Automatically regenerates on launch.',
      safeReason: 'REASON: 100% Safe to delete. Temporary UI resource cache. Automatically rebuilds on launch with zero data loss.'
    },
    {
      id: 'cursor-v8-cacheddata',
      name: 'Cursor V8 Compiled CachedData (C:)',
      category: 'Cursor' as const,
      path: isWindows ? path.join(appData, 'Cursor', 'CachedData') : path.join(homeDir, 'Library', 'Caches', 'Cursor', 'CachedData'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: '100% Safe. Compiled V8 engine bytecode. Automatically regenerates on startup.',
      safeReason: 'REASON: 100% Safe to delete. V8 engine bytecode cached to accelerate editor startup. Contains no code or settings.'
    },
    {
      id: 'claude-cache-folder',
      name: 'Claude Desktop Chromium Cache (C:)',
      category: 'Claude' as const,
      path: isWindows ? path.join(appData, 'Claude', 'Cache') : path.join(homeDir, 'Library', 'Caches', 'Claude'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: '100% Safe. Temporary UI graphics & webview cache for Claude Desktop.',
      safeReason: 'REASON: 100% Safe to delete. Temporary UI graphics cache. Does NOT touch chat databases or session tokens.'
    },
    {
      id: 'claude-code-cache-folder',
      name: 'Claude Desktop V8 Code Cache (C:)',
      category: 'Claude' as const,
      path: isWindows ? path.join(appData, 'Claude', 'Code Cache') : path.join(homeDir, 'Library', 'Caches', 'Claude', 'Code Cache'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: '100% Safe. Compiled JS bytecode cache for Claude Desktop app.',
      safeReason: 'REASON: 100% Safe to delete. Compiled V8 bytecode cache. Automatically rebuilds on launch.'
    },
    {
      id: 'claude-gpu-cache-folder',
      name: 'Claude Desktop GPU Shader Cache (C:)',
      category: 'Claude' as const,
      path: isWindows ? path.join(appData, 'Claude', 'GPUCache') : path.join(homeDir, 'Library', 'Caches', 'Claude', 'GPUCache'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: '100% Safe. GPU hardware acceleration shader cache.',
      safeReason: 'REASON: 100% Safe to delete. Hardware GPU shader cache.'
    },
    {
      id: 'claude-caches-logs',
      name: 'Claude Desktop App Diagnostic Logs (C:)',
      category: 'Claude' as const,
      path: isWindows ? path.join(appData, 'Claude', 'logs') : path.join(homeDir, 'Library', 'Logs', 'Claude'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: '100% Safe. Diagnostic event logs generated by Claude Desktop.',
      safeReason: 'REASON: 100% Safe to delete. Diagnostic event logs. Does NOT touch chat history or user settings.'
    },
    {
      id: 'cursor-appdata-local',
      name: 'Cursor Local App Data & Updates (C:)',
      category: 'Cursor' as const,
      path: isWindows ? path.join(localAppData, 'Cursor') : path.join(homeDir, 'Library', 'Caches', 'Cursor'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Local Cursor cache, GPU shader cache, and auto-update packages.',
      safeReason: 'Local Cursor application cache.'
    },
    {
      id: 'claude-appdata-roaming',
      name: 'Claude Desktop User Data & Chat Databases (C:)',
      category: 'Claude' as const,
      path: isWindows ? path.join(appData, 'Claude') : path.join(homeDir, 'Library', 'Application Support', 'Claude'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Contains Claude Desktop offline chat databases, session keys, and custom MCP settings.',
      safeReason: 'YELLOW / REVIEW DATA: Contains Claude Desktop session keys, MCP server configs, and offline chat databases. Review before cleaning.'
    },
    {
      id: 'antigravity-gemini-root',
      name: 'Google Antigravity & Gemini AI Engine Storage (C:)',
      category: 'Antigravity' as const,
      path: path.join(homeDir, '.gemini'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Full Antigravity & Gemini AI directory containing agent brain state, conversation transcripts, plugins, skills, and model artifacts.',
      safeReason: 'Root Google Antigravity & Gemini engine directory. Contains agent brain, transcripts, skills, and plugin state.'
    },
    {
      id: 'cursor-user-data-root',
      name: 'Cursor AI User Data & Extension Storage (C:)',
      category: 'Cursor' as const,
      path: path.join(homeDir, '.cursor'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Cursor AI user configuration, extension state, and prompt history.',
      safeReason: 'Root Cursor directory containing extension cache and AI settings.'
    },
    {
      id: 'claude-user-data-root',
      name: 'Claude CLI & Code Session Storage (C:)',
      category: 'Claude' as const,
      path: path.join(homeDir, '.claude'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Claude Desktop & CLI session storage, project transcripts, and MCP configurations.',
      safeReason: 'Root Claude directory containing CLI configs and session logs.'
    },
    {
      id: 'ollama-models-root',
      name: 'Ollama Local LLM Models & Weights (C:)',
      category: 'Ollama' as const,
      path: path.join(homeDir, '.ollama'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Stored local LLM weights (Llama 3, Qwen, DeepSeek) and model manifests.',
      safeReason: 'Ollama models directory storing local LLM weights.'
    },
    {
      id: 'cursor-appdata-roaming',
      name: 'Cursor Application Data & Workspace Storage (C:)',
      category: 'Cursor' as const,
      path: isWindows ? path.join(appData, 'Cursor') : path.join(homeDir, 'Library', 'Application Support', 'Cursor'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Cursor workspace storage, extensions state, and session settings.',
      safeReason: 'Cursor app data directory.'
    },
    {
      id: 'huggingface-cache',
      name: 'HuggingFace Model & Dataset Cache (C:)',
      category: 'Ollama' as const,
      path: path.join(homeDir, '.cache', 'huggingface'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded HuggingFace AI model weights, tokenizers, and datasets.',
      safeReason: 'Local HuggingFace model cache.'
    },
    {
      id: 'pytorch-cache',
      name: 'PyTorch & Torch Hub Model Checkpoints (C:)',
      category: 'Ollama' as const,
      path: path.join(homeDir, '.cache', 'torch'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Cached PyTorch model weights and neural network checkpoints.',
      safeReason: 'PyTorch hub cache directory.'
    },
    // --- Package-manager caches -------------------------------------------
    //
    // These are the CACHES of general-purpose toolchains, not the toolchains
    // themselves. Node and Python are deliberately NOT listed as removable
    // software: they are general-purpose runtimes, removing one breaks far more
    // than AI work, and there is no honest "safe" tier for a language runtime.
    // Their download caches are a different matter — every AI tool, MCP server
    // and agent pulls packages through them, they re-download on demand, and
    // they are routinely the largest reclaimable thing on a developer's disk.
    {
      id: 'pip-cache',
      name: 'pip download cache',
      category: 'Ollama' as const,
      // Windows keeps this at %LOCALAPPDATA%\pip\Cache. The previous entry only
      // checked the Linux/macOS path (~/.cache/pip), so on Windows — the app's
      // only supported platform — it never matched.
      path: isWindows ? path.join(localAppData, 'pip', 'Cache') : path.join(homeDir, '.cache', 'pip'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded Python wheels and build artifacts. pip re-downloads on demand.',
      safeReason: 'Safe to delete. A download cache only — pip refetches anything it needs. No installed package is affected.'
    },
    {
      id: 'npm-cache',
      name: 'npm download cache',
      category: 'VS Code Extension' as const,
      path: isWindows ? path.join(localAppData, 'npm-cache') : path.join(homeDir, '.npm', '_cacache'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Tarballs npm has downloaded. Rebuilt automatically on the next install.',
      safeReason: 'Safe to delete. A content-addressable download cache — npm refetches as needed. Installed node_modules are untouched.'
    },
    {
      id: 'npm-cacache-home',
      name: 'npm cache (home)',
      category: 'VS Code Extension' as const,
      path: path.join(homeDir, '.npm', '_cacache'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Secondary npm content cache in the home directory.',
      safeReason: 'Safe to delete. Download cache only; npm rebuilds it.'
    },
    {
      id: 'bun-cache',
      name: 'Bun install cache',
      category: 'VS Code Extension' as const,
      path: path.join(homeDir, '.bun', 'install', 'cache'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Packages Bun has downloaded. Refetched on the next install.',
      safeReason: 'Safe to delete. Download cache only — Bun refetches on demand.'
    },
    {
      id: 'yarn-cache',
      name: 'Yarn download cache',
      category: 'VS Code Extension' as const,
      path: isWindows ? path.join(localAppData, 'Yarn', 'Cache') : path.join(homeDir, '.cache', 'yarn'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Packages Yarn has downloaded.',
      safeReason: 'Safe to delete. Download cache only — Yarn refetches on demand.'
    },
    {
      id: 'uv-cache',
      name: 'uv Python cache',
      category: 'Ollama' as const,
      path: isWindows ? path.join(localAppData, 'uv', 'cache') : path.join(homeDir, '.cache', 'uv'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Wheels and source distributions cached by uv.',
      safeReason: 'Safe to delete. Download cache only — uv refetches on demand.'
    },
    {
      id: 'continue-dev-root',
      name: 'Continue.dev AI Assistant Storage (C:)',
      category: 'Cursor' as const,
      path: path.join(homeDir, '.continue'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Continue.dev AI coding assistant session history, indexing cache, and model configs.',
      safeReason: 'Continue.dev AI assistant directory.'
    },
    {
      id: 'lm-studio-cache',
      name: 'LM Studio Local Models & Cache (C:)',
      category: 'Ollama' as const,
      path: path.join(homeDir, '.cache', 'lm-studio'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded GGUF model files and LM Studio inference cache.',
      safeReason: 'LM Studio model storage.'
    },
    {
      id: 'jan-ai-appdata',
      name: 'Jan.ai Local Model Storage (C:)',
      category: 'Ollama' as const,
      path: path.join(appData, 'Jan'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Jan.ai open-source local AI model files and conversations.',
      safeReason: 'Jan.ai local storage.'
    },
    {
      id: 'anything-llm-appdata',
      name: 'AnythingLLM Vector DB Storage (C:)',
      category: 'Ollama' as const,
      path: path.join(appData, 'AnythingLLM'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'AnythingLLM local vector database, document embeddings, and chat history.',
      safeReason: 'AnythingLLM local vector database.'
    },
    // --- Temp & system caches ------------------------------------------------
    //
    // Not AI-specific, but they sit in the same profile and are pure waste. All
    // GREEN: the OS and each app recreate them on demand.
    {
      id: 'user-temp',
      name: 'Temporary files (your account)',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'Temp'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Installer leftovers, extracted archives and scratch files from every app you run.',
      safeReason: 'Safe to delete. Files still open are skipped automatically; everything else is scratch space.'
    },
    {
      id: 'windows-temp',
      name: 'Temporary files (system)',
      category: 'Dev Toolchain' as const,
      path: path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'System-wide scratch files.',
      safeReason: 'Safe to delete. Recreated as needed; in-use files are skipped.'
    },
    {
      id: 'windows-update-cache',
      name: 'Windows Update download cache',
      category: 'Dev Toolchain' as const,
      path: path.join(process.env.SystemRoot || 'C:\\Windows', 'SoftwareDistribution', 'Download'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Installers for updates already applied.',
      safeReason: 'Safe to delete. Windows re-downloads anything it still needs.'
    },
    {
      id: 'crash-dumps',
      name: 'Application crash dumps',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'CrashDumps'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Memory dumps written when an app crashed.',
      safeReason: 'Safe to delete unless you are actively debugging a crash.'
    },
    {
      id: 'thumbnail-cache',
      name: 'Explorer thumbnail cache',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'Microsoft', 'Windows', 'Explorer'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Cached folder thumbnails and icons.',
      safeReason: 'Safe to delete. Explorer rebuilds thumbnails as you browse.'
    },
    {
      id: 'dx-shader-cache',
      name: 'GPU shader caches (DirectX / NVIDIA)',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'D3DSCache'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Compiled GPU shaders.',
      safeReason: 'Safe to delete. Recompiled automatically, at a brief one-time cost.'
    },
    {
      id: 'pnpm-store',
      name: 'pnpm content store',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'pnpm', 'store'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      reclaimCommandId: 'pnpm-store-prune',
      impactDescription: 'Every package version pnpm has downloaded, shared across all your projects.',
      safeReason: 'Safe to delete. pnpm refetches on the next install. Prefer "pnpm store prune", which removes only versions no project references.'
    },
    {
      id: 'composer-cache',
      name: 'Composer cache (PHP)',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'Composer'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      reclaimCommandId: 'composer-clear-cache',
      impactDescription: 'Downloaded PHP packages and VCS clones.',
      safeReason: 'Safe to delete. Composer refetches on the next install.'
    },
    // --- Dev toolchains -----------------------------------------------------
    //
    // Not AI tools, but every AI agent, MCP server and coding assistant builds
    // on them, and their caches are routinely the largest reclaimable thing on
    // a developer's disk. As with Node and Python, the RUNTIME is never offered
    // for deletion — only its caches.
    {
      id: 'docker-wsl-disk',
      name: 'Docker virtual disk (images, containers, volumes)',
      category: 'Dev Toolchain' as const,
      path: path.join(localAppData, 'Docker', 'wsl', 'disk', 'docker_data.vhdx'),
      // RED: this single file IS your Docker data. Deleting it destroys every
      // image, container and volume. It shrinks by running Docker's own prune,
      // never by removing the file.
      tier: 'RED' as SafetyTier,
      canDelete: false,
      reclaimCommandId: 'docker-prune',
      impactDescription: 'Every Docker image, container and volume lives in this one file. It grows and never shrinks on its own.',
      safeReason: 'DO NOT DELETE — this file is your Docker data. Free space with "docker system prune -a" (one click), then compact the disk (copy the admin command under Tool cleanup).'
    },
    {
      id: 'chrome-on-device-model',
      name: 'Chrome on-device AI model (Gemini Nano)',
      category: 'Chrome AI' as const,
      path: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'OptGuideOnDeviceModel'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Model weights Chrome downloads for "Help me write" and scam detection. Chrome downloads it again unless you turn it off.',
      safeReason: 'Best way: Chrome > Settings > System > turn off "On-device AI" — Chrome removes it itself. Deleting the folder alone only frees it until Chrome redownloads it.'
    },
    {
      id: 'gradle-cache',
      name: 'Gradle build cache',
      category: 'Dev Toolchain' as const,
      path: path.join(homeDir, '.gradle', 'caches'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded dependencies and build outputs. Gradle refetches and rebuilds on demand.',
      safeReason: 'Safe to delete. A build cache only — the next build repopulates it.'
    },
    {
      id: 'maven-repo',
      name: 'Maven local repository',
      category: 'Dev Toolchain' as const,
      path: path.join(homeDir, '.m2', 'repository'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded Java dependencies. Maven refetches on the next build.',
      safeReason: 'Safe to delete. Dependencies are redownloaded from the registry.'
    },
    {
      id: 'go-mod-cache',
      name: 'Go module cache',
      category: 'Dev Toolchain' as const,
      path: path.join(homeDir, 'go', 'pkg', 'mod'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      reclaimCommandId: 'go-cache-clean',
      impactDescription: 'Downloaded Go modules. Redownloaded on the next build.',
      safeReason: 'Safe to delete. Use "go clean -modcache" or delete directly.'
    },
    {
      id: 'cargo-registry',
      name: 'Rust cargo registry',
      category: 'Dev Toolchain' as const,
      path: path.join(homeDir, '.cargo', 'registry'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded crates. Refetched on the next build.',
      safeReason: 'Safe to delete. Crates are redownloaded from crates.io.'
    },
    {
      id: 'nuget-packages',
      name: 'NuGet package cache',
      category: 'Dev Toolchain' as const,
      path: path.join(homeDir, '.nuget', 'packages'),
      tier: 'GREEN' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded .NET packages. Restored on the next build.',
      safeReason: 'Safe to delete. Packages are restored from the feed.'
    },
  ];

  const scanned = await mapLimit(scanDefinitions, 4, async (def) => {
    const stat = await statSafe(def.path);
    if (!stat) return null;

    const measured = await measureDirectory(def.path);
    const size = measured.bytes;
    const item: AICacheItem = {
      id: def.id,
      name: def.name,
      category: def.category,
      path: def.path,
      sizeBytes: size,
      formattedSize: formatBytes(size),
      tier: def.tier,
      canDelete: def.canDelete,
      impactDescription: def.impactDescription,
      lastModified: stat.mtime.toISOString().split('T')[0],
      safeReason: def.safeReason,
      reclaimCommandId: (def as { reclaimCommandId?: string }).reclaimCommandId,
      idleDays: idleDaysFor(measured.newestMtimeMs)
    };
    return item;
  });

  for (const item of scanned) if (item) targets.push(item);

  targets.push(...(await scanDiscoveredToolFolders(targets)));

  const secondaryItems = await scanSecondaryDrives();
  for (const item of secondaryItems) {
    if (!targets.some(t => t.path.toLowerCase() === item.path.toLowerCase())) {
      targets.push(item);
    }
  }

  return withDockerTrappedSpace(targets);
}

/**
 * The Docker disk file never shrinks on its own, so its size says nothing about
 * what's in it. Report the gap between the file and what Docker stores — the
 * space a compact hands back to Windows. Only when Docker answers; no guessing.
 */
async function withDockerTrappedSpace(items: AICacheItem[]): Promise<AICacheItem[]> {
  if (!items.some(i => i.id === 'docker-wsl-disk')) return items;
  const stored = await dockerStoredBytes();
  if (stored === null) return items;
  return items.map(i => i.id === 'docker-wsl-disk'
    ? { ...i, trappedBytes: Math.max(0, i.sizeBytes - stored) }
    : i);
}
