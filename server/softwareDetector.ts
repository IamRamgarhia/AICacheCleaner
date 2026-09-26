import path from 'path';
import os from 'os';
import type { AISoftwareAppItem, AIProcessItem, AICacheItem } from '../src/types';
import { getDirectorySize, formatBytes } from './scanner';
import { mapLimit, pathExists, statSafe } from './fsAsync';
import { discoverAITools } from './aiToolRegistry';
import type { InstalledProgram } from './installedPrograms';
import { isOwnFolder } from './catalogDetector';

/**
 * How each curated tool is recognised beyond its folders.
 *   program — its name in Windows' installed-programs list (proves it's installed)
 *   running — matched against the process name AND command line; only counted
 *             when the tool is actually on disk, so a random python.exe no
 *             longer marks OpenHands or Crawl4AI as running
 *   dataOnly — caches/weights rather than an app: present means installed
 */
const RECOGNISE: Record<string, { program?: RegExp; running?: RegExp; dataOnly?: boolean }> = {
  'sw-antigravity': { program: /^antigravity/i, running: /^antigravity/i },
  'sw-cursor': { program: /^cursor/i, running: /^cursor/i },
  'sw-claude': { program: /^claude/i, running: /^claude(\.exe)?$/i },
  'sw-ollama': { program: /^ollama/i, running: /^ollama/i },
  // VS Code itself is the "Visual Studio Code" toolchain row; this row is only
  // the AI extensions' data, so it neither adopts the install nor Code.exe.
  'sw-vscode-mcp': { dataOnly: true },
  // Matched on how the tool is launched, not any path that mentions the word.
  'sw-opendevin': { running: /-m\s+(openhands|opendevin)\b|[\\/](openhands|opendevin)(\.exe)?(\s|"|$)/i },
  'sw-crawl4ai': { running: /-m\s+crawl4ai\b|[\\/]crwl(\.exe)?(\s|"|$)/i, dataOnly: true },
  'sw-playwright': { dataOnly: true },
  'sw-jan': { program: /^jan\b/i, running: /^jan(\.exe)?$/i },
  'sw-anythingllm': { program: /^anythingllm/i, running: /^anythingllm/i },
  'sw-huggingface-torch': { dataOnly: true },
  'sw-continue': { dataOnly: true }
};

/** The installed program whose name starts with this tool's name, if any. */
function programNamed(programs: InstalledProgram[], name: string): InstalledProgram | undefined {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (key.length < 3) return undefined;
  return programs.find(p => p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().startsWith(key));
}

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

export async function detectInstalledAISoftware(runningProcesses: AIProcessItem[], programs: InstalledProgram[] = []): Promise<AISoftwareAppItem[]> {
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
        path.join(appDataLocal, 'Programs', 'Ollama'),
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
  // The installed program tells us where the app itself lives; add that
  // folder so its size and version come from the real install.
  for (const sw of softwareList) {
    const rule = RECOGNISE[sw.id];
    // Data-only entries (caches, weights) have no program; a loose name match
    // there could adopt an unrelated app's folder.
    const program = rule?.program ? programs.find(p => rule.program!.test(p.name)) : rule ? undefined : programNamed(programs, sw.name);
    if (!program) continue;
    const loc = program.installLocation ?? (program.iconPath ? path.dirname(program.iconPath) : undefined);
    // The registry is user-writable and some installers write broad folders;
    // a folder here becomes a size AND a "clean caches" root, so it must be the app's own.
    if (loc && isOwnFolder(loc) && !sw.detectionPaths.some(d => path.resolve(d).toLowerCase() === path.resolve(loc).toLowerCase())) sw.detectionPaths.push(loc);
    sw.iconPath = program.iconPath;
    sw.publisher = program.publisher;
    if (program.version) sw.version = `v${program.version.replace(/^v/i, '')}`;
  }
  const hasProgram = new Set(softwareList.filter(sw => sw.iconPath || sw.publisher).map(sw => sw.id));

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

    if (anyPathExists && !sw.version) {
      sw.version = await detectVersion(sw.detectionPaths);
    }

    const rule = RECOGNISE[sw.id];
    const installed = hasProgram.has(sw.id);
    const present = anyPathExists || installed;
    const exe = sw.executableName?.toLowerCase();
    const running = present
      ? runningProcesses.filter(proc =>
          (rule?.running ? rule.running.test(proc.name) || rule.running.test(proc.command) : false) ||
          (!!exe && proc.name.toLowerCase() === exe))
      : [];

    if (running.length > 0) {
      sw.status = 'ACTIVE IN RAM';
      sw.pid = running[0].pid;
      sw.ramMb = running.reduce((a, p) => a + p.memoryMb, 0);
      sw.cpuPercent = Math.round(running.reduce((a, p) => a + p.cpuPercent, 0) * 10) / 10;
      sw.processCount = running.length;
    } else if (!present) {
      sw.status = 'NOT INSTALLED';
    } else {
      // Installed = Windows lists it, or its executable is in one of its folders.
      // Settings and caches alone are what an uninstall leaves behind.
      const exeFound = !!exe && (await Promise.all(sw.detectionPaths.map(d => pathExists(path.join(d, exe))))).some(Boolean);
      // Only tools we know the executable of can be called left behind; a
      // folder found by name (skills, MCP servers, CLI data) is just on disk.
      const knowsInstall = !!exe || !!rule?.program;
      sw.status = installed || exeFound || rule?.dataOnly || !knowsInstall ? 'INSTALLED ON DISK' : 'LAYING ON DISK (RESIDUAL)';
    }
  });

  return softwareList;
}
