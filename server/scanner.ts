import fs from 'fs';
import path from 'path';
import os from 'os';
import { AICacheItem, SafetyTier } from '../src/types';

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

// Iterative Stack-Based Directory Size Calculation
export function getDirectorySize(dirPath: string): number {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;

  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    const stack: string[] = [dirPath];

    while (stack.length > 0) {
      const current = stack.pop()!;
      try {
        const files = fs.readdirSync(current, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.join(current, file.name);
          if (file.isDirectory()) {
            stack.push(filePath);
          } else if (file.isFile()) {
            try {
              const fileStats = fs.statSync(filePath);
              totalSize += fileStats.size;
            } catch (e) {
              // Skip locked files
            }
          }
        }
      } catch (e) {
        // Skip unreadable directories
      }
    }
  } catch (e) {
    // Skip unreadable root
  }
  return totalSize;
}

// Strict AI / Software Project Fingerprint Verifier
export function isGenuineAIProject(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return false;

    const folderName = path.basename(dirPath).toLowerCase();
    const fullPathLower = dirPath.toLowerCase();

    // REJECT dot folders, hidden system folders, download directories, or file extensions
    if (folderName.startsWith('.')) return false;
    if (fullPathLower.includes('\\downl') || fullPathLower.includes('\\downloads') || fullPathLower.includes('\\temp') || fullPathLower.includes('$recycle')) return false;

    const junkExtensions = [
      '.avif', '.crdownload', '.doc', '.docx', '.exe', '.gz', '.jpeg', '.jpg',
      '.png', '.gif', '.svg', '.webp', '.psd', '.ai', '.pdf', '.xlsx', '.pptx',
      '.zip', '.rar', '.7z', '.tar', '.dll', '.iso', '.mp4', '.avi', '.mov', '.mp3'
    ];

    if (junkExtensions.some(ext => folderName.endsWith(ext) || folderName.includes(ext))) {
      return false;
    }

    // REQUIRE AI / Code Project Fingerprint Files
    const subFiles = fs.readdirSync(dirPath).map(f => f.toLowerCase());
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

export function isLocalhostRunnable(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return false;

    const files = fs.readdirSync(dirPath).map(f => f.toLowerCase());
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

function scanSecondaryDrives(): AICacheItem[] {
  const items: AICacheItem[] = [];
  const secondaryDriveRoots = ['D:\\', 'E:\\', 'F:\\'];

  for (const root of secondaryDriveRoots) {
    if (!fs.existsSync(root)) continue;

    try {
      const topEntries = fs.readdirSync(root, { withFileTypes: true });

      for (const entry of topEntries) {
        if (!entry.isDirectory()) continue;
        const entryNameLower = entry.name.toLowerCase();

        if (
          entryNameLower.startsWith('$') ||
          entryNameLower.includes('system') ||
          entryNameLower === 'windows' ||
          entryNameLower.startsWith('.') ||
          entryNameLower.includes('downl') ||
          entryNameLower.includes('temp')
        ) continue;

        const firstLevelPath = path.join(root, entry.name);

        if (isGenuineAIProject(firstLevelPath)) {
          const size = getDirectorySize(firstLevelPath);
          if (size > 0) {
            const stat = fs.statSync(firstLevelPath);
            const runnable = isLocalhostRunnable(firstLevelPath);

            items.push({
              id: `secondary-${root.charAt(0)}-top-${entry.name}`,
              name: `AI Root Workspace: ${entry.name} (${root.substring(0, 2)})`,
              category: 'Antigravity',
              path: firstLevelPath,
              sizeBytes: size,
              formattedSize: formatBytes(size),
              tier: 'YELLOW',
              canDelete: true,
              impactDescription: `Verified top-level AI coding project on Drive ${root.substring(0, 2)}.${runnable ? ' Runnable on Localhost.' : ''}`,
              lastModified: stat.mtime.toISOString().split('T')[0],
              safeReason: `Root AI project workspace located on Drive ${root.substring(0, 2)}. Contains AI code, node_modules, and git history.`
            });
          }
        }

        try {
          const childEntries = fs.readdirSync(firstLevelPath, { withFileTypes: true });

          for (const child of childEntries) {
            if (!child.isDirectory()) continue;
            const childPath = path.join(firstLevelPath, child.name);

            if (!isGenuineAIProject(childPath)) continue;

            const size = getDirectorySize(childPath);
            if (size > 0) {
              const stat = fs.statSync(childPath);
              const runnable = isLocalhostRunnable(childPath);

              items.push({
                id: `secondary-${root.charAt(0)}-${entry.name}-${child.name}`,
                name: `AI Project: ${entry.name}/${child.name} (${root.substring(0, 2)})`,
                category: 'Antigravity',
                path: childPath,
                sizeBytes: size,
                formattedSize: formatBytes(size),
                tier: 'YELLOW',
                canDelete: true,
                impactDescription: `Verified AI coding project on Drive ${root.substring(0, 2)}.${runnable ? ' Runnable on Localhost.' : ''}`,
                lastModified: stat.mtime.toISOString().split('T')[0],
                safeReason: `Project folder located on Drive ${root.substring(0, 2)}. Contains AI project files, node_modules, or code transcripts.`
              });
            }
          }
        } catch (e) {
          // Skip unreadable subfolders
        }
      }
    } catch (e) {
      // Skip unreadable drive
    }
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
    {
      id: 'pip-cache',
      name: 'Pip Python AI Package Cache (C:)',
      category: 'Ollama' as const,
      path: path.join(homeDir, '.cache', 'pip'),
      tier: 'YELLOW' as SafetyTier,
      canDelete: true,
      impactDescription: 'Downloaded Python AI packages, wheel caches, and build binaries.',
      safeReason: 'Python pip package cache directory.'
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

  for (const def of scanDefinitions) {
    if (fs.existsSync(def.path)) {
      const size = getDirectorySize(def.path);
      const stat = fs.statSync(def.path);
      targets.push({
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
      });
    }
  }

  const secondaryItems = scanSecondaryDrives();
  for (const item of secondaryItems) {
    if (!targets.some(t => t.path.toLowerCase() === item.path.toLowerCase())) {
      targets.push(item);
    }
  }

  return targets;
}
