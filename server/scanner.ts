import path from 'path';
import os from 'os';
import type { AICacheItem, SafetyTier } from '../src/types';
import { mapLimit, pathExists, readdirSafe, statSafe } from './fsAsync';

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

// Breadth-first, bounded-concurrency directory size calculation.
//
// This was previously a synchronous readdirSync/statSync walk. Because the
// Express server runs inside the Electron main process, a single scan pegged
// the event loop for the whole walk — measured at 43 s on a normal dev machine,
// during which a trivial GET /api/config took 15.7 s to answer and the window
// stopped responding. Every await below is a yield point, so the server stays
// responsive while the disk work happens.
export async function getDirectorySize(dirPath: string): Promise<number> {
  const rootStat = await statSafe(dirPath);
  if (!rootStat) return 0;
  if (!rootStat.isDirectory()) return rootStat.size;

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
      for (const s of stats) if (s) size += s.size;

      return { size, childDirs };
    });

    const nextFrontier: string[] = [];
    for (const result of levelResults) {
      totalSize += result.size;
      nextFrontier.push(...result.childDirs);
    }
    frontier = nextFrontier;
  }

  return totalSize;
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
    category: 'Antigravity',
    path: projectPath,
    sizeBytes: size,
    formattedSize: formatBytes(size),
    tier: 'YELLOW',
    canDelete: true,
    impactDescription: `Verified ${descriptor} on Drive ${drive}.${runnable ? ' Runnable on Localhost.' : ''}`,
    lastModified: stat.mtime.toISOString().split('T')[0],
    safeReason: `Project folder located on Drive ${drive}. Contains AI project files, node_modules, or code transcripts.`,
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
    }
  ];

  const scanned = await mapLimit(scanDefinitions, 4, async (def) => {
    const stat = await statSafe(def.path);
    if (!stat) return null;

    const size = await getDirectorySize(def.path);
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
      safeReason: def.safeReason
    };
    return item;
  });

  for (const item of scanned) if (item) targets.push(item);

  const secondaryItems = await scanSecondaryDrives();
  for (const item of secondaryItems) {
    if (!targets.some(t => t.path.toLowerCase() === item.path.toLowerCase())) {
      targets.push(item);
    }
  }

  return targets;
}
