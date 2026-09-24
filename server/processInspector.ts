import type { AIProcessItem } from '../src/types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import pidusage from 'pidusage';

const execFileAsync = promisify(execFile);

const AI_PROCESS = /node|python|ollama|cursor|antigravity|claude|electron|codex|tsx|vite/i;

/** Idle must hold this long across scans before a process is flagged. */
const IDLE_AFTER_MS = 10 * 60_000;
/** CPU seconds a process may burn between scans and still count as quiet. */
const QUIET_CPU_SECONDS = 0.5;
const IDLE_MIN_MB = 150;

// CPU seconds at the start of each process's quiet period. A single snapshot
// can't tell "idle" from "between bursts"; history across scans can. Keyed by
// pid + start time so a reused PID never inherits another process's history.
const cpuHistory = new Map<string, { baseCpu: number; quietSince: number }>();
// Only processes from the latest scan may be stopped, and only while the PID
// still belongs to the same process (Windows reuses PIDs quickly).
let lastScanned = new Map<number, { name: string; created: number }>();

interface WinProc { pid: number; ppid: number; name: string; exe: string; cmd: string; memMb: number; cpuSec: number; created: number }

// One CIM query gives parent, command line and cumulative CPU; windowed PIDs
// come from Get-Process. tasklist gave none of these.
const PS_QUERY = `
$w = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })
$all = Get-CimInstance Win32_Process
$p = $all | Where-Object { $_.Name -match '${AI_PROCESS.source}' } | ForEach-Object {
  [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=$_.Name; exe=[string]$_.ExecutablePath;
    cmd=[string]$_.CommandLine; memMb=[math]::Round($_.WorkingSetSize/1MB); cpuSec=($_.KernelModeTime+$_.UserModeTime)/1e7;
    created=$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) } }
@{ procs=@($p); windowed=$w; alive=@($all | ForEach-Object { [int]$_.ProcessId }) } | ConvertTo-Json -Depth 3 -Compress`;

/** First non-flag argument after `marker` in a command line, unquoted. */
function argAfter(cmd: string, marker: string): string {
  const rest = cmd.slice(cmd.toLowerCase().indexOf(marker) + marker.length).replace(/"/g, ' ');
  return rest.split(/\s+/).filter(t => t && !t.startsWith('-')).join(' ');
}

/** Human label from the real command line instead of guessing by exe name. */
export function describeProcess(name: string, exe: string, cmd: string): string {
  const n = name.toLowerCase();
  const c = `${exe} ${cmd}`.toLowerCase().replace(/\\/g, '/');
  const helper = /--type=/.test(c) ? ' (helper)' : '';
  const ext = c.match(/extensions\/(?:node_modules\/)?([^/"\s]+)/)?.[1];

  if (n.startsWith('claude') && (c.includes('--output-format stream-json') || c.includes('claude-code'))) {
    return c.includes('antigravity') ? 'Claude Code (in Antigravity)' : 'Claude Code session';
  }
  const app = n.startsWith('claude') ? 'Claude Desktop' : n.startsWith('antigravity') ? 'Antigravity IDE' : n.startsWith('cursor') ? 'Cursor' : '';
  if (app) {
    if (helper) return `${app}${helper}`;
    if (ext) return `${app} extension: ${ext}`;
    return c.includes('--max-old-space-size') ? `${app} extension host` : app;
  }
  if (n.startsWith('ollama')) return 'Ollama model runner';
  if (c.includes('npx-cli.js')) return `npx launcher: ${argAfter(cmd, 'npx-cli.js').split(' ')[0].replace(/@latest$/, '')}`;
  if (c.includes('npm-cli.js')) return `npm ${argAfter(cmd, 'npm-cli.js')}`.trim();
  if (c.includes('vite')) return c.includes(' build') ? 'Vite build' : 'Vite dev server';
  if (n.startsWith('node')) {
    // Last node_modules package on the line is the thing actually running.
    const pkgs = [...c.matchAll(/node_modules\/(?:\.bin\/+\.\.\/+)?(@[^/"\s]+\/[^/"\s]+|[^/"\s]+)/g)].map(m => m[1]);
    const pkg = pkgs.filter(p => p !== 'npm').pop();
    const script = cmd.match(/[^\s"\\/]+\.(?:c|m)?js\b/i)?.[0];
    const what = pkg ?? (c.includes('memorybridge') ? 'memorybridge' : script);
    if (!what) return 'Node.js process';
    return /mcp|memorybridge/.test(what) ? `MCP server: ${what}` : `Node.js: ${what}`;
  }
  if (n.startsWith('python')) {
    const mod = cmd.match(/-m\s+([\w.-]+)(.*)$/)?.[0].replace(/^-m\s+/, '') ?? argAfter(cmd, 'python.exe').split(/[\\/]/).pop();
    return `Python: ${(mod || '').replace(/\.exe\b/i, '').trim() || 'process'}`;
  }
  return name;
}

/**
 * Idle = no window, parent gone (orphaned), holding memory, and no CPU work
 * across scans for IDLE_AFTER_MS. The old rule (>300 MB, <0.2% CPU in one
 * sample) flagged an open-but-untouched editor window as idle.
 */
export function isIdleProcess(p: { memMb: number; hasWindow: boolean; parentAlive: boolean; quietMs: number; isSelf: boolean }): boolean {
  return !p.isSelf && !p.hasWindow && !p.parentAlive && p.memMb >= IDLE_MIN_MB && p.quietMs >= IDLE_AFTER_MS;
}

/**
 * Quiet-period bookkeeping for one process. CPU is measured from a fixed
 * baseline taken when the quiet period began, so slow steady work (4% CPU)
 * adds up and resets it instead of hiding under a per-scan delta.
 */
export function nextQuietEntry(
  prev: { baseCpu: number; quietSince: number } | undefined,
  cpuSec: number,
  now: number
): { baseCpu: number; quietSince: number } {
  const stillQuiet = prev !== undefined && cpuSec >= prev.baseCpu && cpuSec - prev.baseCpu <= QUIET_CPU_SECONDS;
  return stillQuiet ? prev : { baseCpu: cpuSec, quietSince: now };
}

export async function scanAIProcesses(): Promise<AIProcessItem[]> {
  const isWindows = os.platform() === 'win32';
  const processes: AIProcessItem[] = [];

  try {
    if (isWindows) {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY], { maxBuffer: 32 * 1024 * 1024 });
      const data = JSON.parse(stdout) as { procs: WinProc[]; windowed: number[] | null; alive: number[] };
      const windowed = new Set(data.windowed ?? []);
      const alive = new Set(data.alive);
      const selfPids = new Set([process.pid, process.ppid]);
      const now = Date.now();

      const pidsToQuery = data.procs.map(p => p.pid);
      let realStats: { [key: number]: any } = {};
      try {
        if (pidsToQuery.length > 0) realStats = await pidusage(pidsToQuery);
      } catch (e) {
        // A PID that exited mid-query rejects the batch; fall back to 0% CPU.
      } finally {
        try { pidusage.clear(); } catch (e) { /* noop */ }
      }

      const nextHistory = new Map<string, { baseCpu: number; quietSince: number }>();
      for (const p of data.procs) {
        const key = `${p.pid}:${p.created}`;
        const entry = nextQuietEntry(cpuHistory.get(key), p.cpuSec, now);
        nextHistory.set(key, entry);
        const quietSince = entry.quietSince;

        const stat = realStats[p.pid];
        const memoryMb = stat ? Math.round(stat.memory / (1024 * 1024)) : p.memMb;
        const isZombie = isIdleProcess({
          memMb: memoryMb,
          hasWindow: windowed.has(p.pid),
          parentAlive: alive.has(p.ppid),
          quietMs: now - quietSince,
          isSelf: selfPids.has(p.pid)
        });

        processes.push({
          pid: p.pid,
          ppid: p.ppid,
          name: p.name,
          tool: describeProcess(p.name, p.exe, p.cmd),
          cpuPercent: stat ? parseFloat(stat.cpu.toFixed(1)) : 0,
          memoryMb,
          formattedMemory: `${memoryMb} MB`,
          isZombie,
          command: (p.cmd || p.exe || p.name).slice(0, 200)
        });
      }
      cpuHistory.clear();
      for (const [k, v] of nextHistory) cpuHistory.set(k, v);
      lastScanned = new Map(data.procs.map(p => [p.pid, { name: p.name, created: p.created }]));
    } else {
      // macOS / Linux ps query (execFile, no shell)
      const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid,ppid,%cpu,rss,command']);
      const lines = stdout.split('\n').filter(Boolean);

      for (const line of lines.slice(1)) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length >= 5) {
          const pid = parseInt(tokens[0], 10);
          const ppid = parseInt(tokens[1], 10);
          const cpuPercent = parseFloat(tokens[2]) || 0;
          const rssKb = parseInt(tokens[3], 10) || 0;
          const command = tokens.slice(4).join(' ');
          const memMb = Math.round(rssKb / 1024);

          const lowerCmd = command.toLowerCase();
          if (
            lowerCmd.includes('node') ||
            lowerCmd.includes('python') ||
            lowerCmd.includes('ollama') ||
            lowerCmd.includes('mcp') ||
            lowerCmd.includes('claude') ||
            lowerCmd.includes('cursor') ||
            lowerCmd.includes('antigravity')
          ) {
            let toolName = 'AI Sidecar Process';
            if (lowerCmd.includes('ollama')) toolName = 'Ollama Engine';
            if (lowerCmd.includes('mcp')) toolName = 'MCP Server Process';
            if (lowerCmd.includes('antigravity')) toolName = 'Antigravity Worker';

            processes.push({
              pid,
              ppid,
              name: tokens[4],
              tool: toolName,
              cpuPercent,
              memoryMb: memMb,
              formattedMemory: `${memMb} MB`,
              // Idle needs CPU history across scans, implemented on Windows only.
              isZombie: false,
              command: command.length > 60 ? command.substring(0, 60) + '...' : command
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Error scanning AI processes:', e);
  }

  if (!isWindows) lastScanned = new Map(processes.map(p => [p.pid, { name: p.name, created: 0 }]));
  return processes;
}

export async function killProcess(pid: number): Promise<boolean> {
  // Only processes this app listed may be stopped, and never itself. The
  // endpoint previously accepted any PID on the machine.
  const listed = lastScanned.get(pid);
  if (!Number.isInteger(pid) || !listed || pid === process.pid || pid === process.ppid) return false;
  if (os.platform() === 'win32') {
    // Re-check the PID still belongs to the process the user saw; if it exited
    // and Windows handed the number to another program, refuse.
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.Name + '|' + $p.CreationDate.ToFileTimeUtc() }`
    ], { windowsHide: true, timeout: 15_000 }).catch(() => ({ stdout: '' }));
    if (stdout.trim() !== `${listed.name}|${listed.created}`) return false;
  }
  try {
    // execFile with discrete args — no shell, so the numeric pid cannot be
    // misinterpreted as command syntax even if the caller-side guard regresses.
    if (os.platform() === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
    } else {
      await execFileAsync('kill', ['-9', String(pid)]);
    }
    return true;
  } catch (e) {
    console.error(`Failed to kill process ${pid}:`, e);
    return false;
  }
}
