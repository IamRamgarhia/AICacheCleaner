import path from 'path';
import os from 'os';
import type { AISoftwareAppItem, AIProcessItem, AICacheItem } from '../src/types';
import { getDirectorySize, formatBytes } from './scanner';
import { mapLimit, pathExists, statSafe } from './fsAsync';
import { discoverAITools } from './aiToolRegistry';

// Maps a software id to the AICacheItem category union. Keeps detected cache
// items type-safe without per-call string juggling.
function swIdToCategory(id: string): AICacheItem['category'] {
  switch (id) {
    case 'sw-antigravity': return 'Antigravity';
    case 'sw-cursor': return 'Cursor';
    case 'sw-claude': return 'Claude';
    case 'sw-ollama': return 'Ollama';
    case 'sw-huggingface-torch': return 'HuggingFace';
    case 'sw-vscode-mcp': return 'VS Code Extension';
    case 'sw-continue': return 'Vector DB';
    default: return 'Cursor';
  }
}

const homeDir = os.homedir();
const appDataLocal = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
const appDataRoaming = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';

// Best-effort real version detection.
//
// Every entry below used to carry a hardcoded string ("v2.4.0", "v0.45.2", ...)
// that was displayed to the user as if it had been detected. It was never read
// from the installed application and drifted from reality the moment any tool
// updated. Now the version is only shown when we can actually read it from a
// package.json in one of the detection paths; otherwise it stays undefined and
// the UI simply omits it.
async function detectVersion(detectionPaths: string[]): Promise<string | undefined> {
  const fsp = await import('fs/promises');
  for (const base of detectionPaths) {
    for (const candidate of [path.join(base, 'package.json'), path.join(base, 'resources', 'app', 'package.json')]) {
      try {
        const raw = await fsp.readFile(candidate, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === 'string' && parsed.version.trim()) {
          return `v${parsed.version.trim()}`;
        }
      } catch {
        // Not present or not readable — try the next candidate.
      }
    }
  }
  return undefined;
}

export async function detectInstalledAISoftware(runningProcesses: AIProcessItem[]): Promise<AISoftwareAppItem[]> {
  const softwareList: AISoftwareAppItem[] = [
    {
      id: 'sw-antigravity',
      name: 'Antigravity',
      category: 'Agentic IDE · Google',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.gemini'),
        path.join(appDataLocal, 'Programs', 'Antigravity'),
        path.join(appDataRoaming, 'antigravity')
      ],
      executableName: 'antigravity.exe',
      description: 'Google DeepMind agentic pair-programming assistant, AGY CLI, and multi-agent engine.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-cursor',
      name: 'Cursor',
      category: 'AI code editor · Anysphere',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.cursor'),
        path.join(appDataLocal, 'Programs', 'cursor'),
        path.join(appDataRoaming, 'Cursor')
      ],
      executableName: 'cursor.exe',
      description: 'AI-first code editor with local codebase indexing, prompt caching, and tab completion.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-claude',
      name: 'Claude',
      category: 'Assistant & agent CLI · Anthropic',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.claude'),
        path.join(appDataRoaming, 'Claude'),
        path.join(appDataLocal, 'AnthropicClaude')
      ],
      executableName: 'claude.exe',
      description: 'Anthropic Claude desktop application, session transcripts, and terminal agent runner.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-ollama',
      name: 'Ollama',
      category: 'Local model runner · Ollama',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.ollama'),
        path.join(appDataLocal, 'Ollama'),
        path.join(programFiles, 'Ollama')
      ],
      executableName: 'ollama.exe',
      description: 'Runs open-weight LLMs (Llama 3, Qwen 2.5, DeepSeek R1) 100% locally on GPU/CPU.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-vscode-mcp',
      name: 'VS Code AI extensions',
      category: 'Extensions & tool servers · Microsoft',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.vscode'),
        path.join(appDataRoaming, 'Code')
      ],
      executableName: 'code.exe',
      description: 'Model Context Protocol (MCP) stdio sidecars, language servers, and extension caches.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-opendevin',
      name: 'OpenHands',
      category: 'Autonomous agent · OpenHands',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.opendevin'),
        path.join(appDataLocal, 'OpenDevin')
      ],
      executableName: 'python.exe',
      description: 'Autonomous open-source AI software engineer clawbot and containerized worker.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-crawl4ai',
      name: 'Crawl4AI',
      category: 'Crawler · Crawl4AI',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.crawl4ai'),
        path.join(appDataLocal, 'Crawl4AI')
      ],
      executableName: 'python.exe',
      description: 'LLM-friendly web crawler bot engine for markdown extraction and RAG pipelines.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-playwright',
      name: 'Playwright & Puppeteer',
      category: 'Headless browsers · Microsoft',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(appDataLocal, 'ms-playwright'),
        path.join(homeDir, '.cache', 'puppeteer')
      ],
      description: 'Automated headless Chromium / Firefox binaries used by AI agents and scraping bots.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-jan',
      name: 'Jan',
      category: 'Local model runner · Jan',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.jan'),
        path.join(appDataRoaming, 'Jan')
      ],
      executableName: 'jan.exe',
      description: 'Open-source offline ChatGPT alternative with local model weights.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-anythingllm',
      name: 'AnythingLLM',
      category: 'RAG workspace · Mintplex',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(appDataRoaming, 'AnythingLLM'),
        path.join(appDataLocal, 'Programs', 'AnythingLLM')
      ],
      executableName: 'anythingllm.exe',
      description: 'Desktop AI suite with built-in RAG vector database and local LLM connectors.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-huggingface-torch',
      name: 'Hugging Face & PyTorch',
      category: 'Model weights · Hugging Face',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.cache', 'huggingface'),
        path.join(homeDir, '.cache', 'torch'),
        path.join(homeDir, '.cache', 'pip')
      ],
      description: 'Downloaded transformer weights, GGUF models, and PyTorch model checkpoints.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-continue',
      name: 'Continue',
      category: 'Code assistant · Continue',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.continue')
      ],
      description: 'Open-source AI code assistant vector embeddings and SQLite session database.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    }
  ];

  // Merge in anything DISCOVERED on disk that the curated list above misses.
  // Without this, a 1.2 GB ~/.antigravity directory, ~/.codex, Antigravity IDE,
  // GLM, Kimi and similar were simply invisible.
  const discovered = await discoverAITools();
  const knownPaths = new Set(
    softwareList.flatMap(sw => sw.detectionPaths.map(p => path.normalize(p).toLowerCase()))
  );

  for (const tool of discovered) {
    const newPaths = tool.paths.filter(p => !knownPaths.has(path.normalize(p).toLowerCase()));
    if (newPaths.length === 0) continue;

    // Fold extra paths into an existing entry when the product already appears
    // in the curated list, so Antigravity doesn't show up twice. Compare on the
    // first significant word: "Playwright browsers" and "Playwright & Puppeteer"
    // are the same product, and a whole-string `includes` missed that.
    const firstWord = tool.name.toLowerCase().split(/[^a-z0-9]+/)[0];
    const existing = softwareList.find(sw => {
      const n = sw.name.toLowerCase();
      return n.includes(tool.name.toLowerCase()) || (firstWord.length > 3 && n.includes(firstWord));
    });
    if (existing) {
      existing.detectionPaths.push(...newPaths);
      newPaths.forEach(p => knownPaths.add(path.normalize(p).toLowerCase()));
      continue;
    }

    softwareList.push({
      id: tool.id,
      name: tool.name,
      category: `${tool.kind} · ${tool.vendor}`,
      status: 'INSTALLED ON DISK',
      detectionPaths: newPaths,
      description: `${tool.kind} by ${tool.vendor}, found on this machine.`,
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    });
    newPaths.forEach(p => knownPaths.add(path.normalize(p).toLowerCase()));
  }

  // Detection walks several multi-GB directories per tool. Doing it
  // concurrently (and asynchronously) keeps the API responsive; the previous
  // sequential sync version made /api/software take ~50 s with the UI frozen.
  await mapLimit(softwareList, 4, async (sw) => {
    let totalBytes = 0;
    let anyPathExists = false;

    // Build a real AICacheItem for every detection path that actually exists, so
    // the purge flow can snapshot the software's genuine caches instead of an
    // empty list.
    const detectedCaches: AICacheItem[] = [];
    const swCategory = swIdToCategory(sw.id);

    for (const p of sw.detectionPaths) {
      if (await pathExists(p)) {
        anyPathExists = true;
        const sizeBytes = await getDirectorySize(p);
        totalBytes += sizeBytes;

        const stat = await statSafe(p);

        detectedCaches.push({
          id: `${sw.id}-cache-${p.replace(/[^a-zA-Z0-9]/g, '-')}`,
          name: `${sw.name} — ${path.basename(p) || p}`,
          category: swCategory,
          path: p,
          sizeBytes,
          formattedSize: formatBytes(sizeBytes),
          // Conservative default: treat detected software data as user data
          // (review before cleaning) so the purge safety snapshot is honest.
          tier: 'YELLOW',
          canDelete: true,
          impactDescription: `Detected on-disk storage for ${sw.name} at ${p}.`,
          lastModified: stat ? stat.mtime.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          safeReason: `Software cache directory for ${sw.name}. Backed up by the pre-purge safety snapshot.`
        });
      }
    }

    sw.totalDiskSizeBytes = totalBytes;
    sw.formattedDiskSize = formatBytes(totalBytes);
    sw.detectedCaches = detectedCaches;

    if (anyPathExists) {
      sw.version = await detectVersion(sw.detectionPaths);
    }

    // Check if actively running in RAM. Parenthesized so precedence between
    // the executable-name match (which needs sw.executableName defined) and the
    // tool/id match is explicit — previously `&&`/`||` precedence silently
    // dropped several tools from ACTIVE detection.
    const swIdKey = sw.id.replace('sw-', '').toLowerCase();
    const runningProc = runningProcesses.find(proc =>
      (sw.executableName && proc.name.toLowerCase() === sw.executableName.toLowerCase()) ||
      proc.tool.toLowerCase().includes(swIdKey)
    );

    if (runningProc) {
      sw.status = 'ACTIVE IN RAM';
      sw.pid = runningProc.pid;
      sw.ramMb = runningProc.memoryMb;
      sw.cpuPercent = runningProc.cpuPercent;
    } else if (anyPathExists) {
      // `detectedCaches` already holds exactly the detection paths that exist,
      // so reuse it instead of a second round of existence checks.
      const hasExecutable = detectedCaches.some(
        c => c.path.includes('Programs') || c.path.includes('Program Files') || c.path.includes('AppData')
      );
      sw.status = hasExecutable ? 'INSTALLED ON DISK' : 'LAYING ON DISK (RESIDUAL)';
    } else {
      sw.status = 'NOT INSTALLED';
    }
  });

  return softwareList;
}
