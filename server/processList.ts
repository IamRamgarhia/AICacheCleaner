import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface LightProcess { pid: number; name: string; memoryMb: number }

/**
 * Every running process, name and memory only. The detailed AI process scan
 * deliberately looks at a few names (node, python, claude…); telling whether
 * Docker Desktop, ZCode or Wispr Flow is running needs the full list.
 */
export async function listAllProcesses(): Promise<LightProcess[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-Process | ForEach-Object { [pscustomobject]@{ p=$_.Id; n=$_.ProcessName; m=[math]::Round($_.WorkingSet64/1MB) } }) | ConvertTo-Json -Compress'
      ], { windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
      const rows = JSON.parse(stdout || '[]');
      return (Array.isArray(rows) ? rows : [rows]).map(r => ({ pid: Number(r.p), name: String(r.n), memoryMb: Number(r.m) || 0 }));
    }
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,rss=,comm='], { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout.split('\n').flatMap(line => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return m ? [{ pid: Number(m[1]), memoryMb: Math.round(Number(m[2]) / 1024), name: path.basename(m[3]) }] : [];
    });
  } catch {
    return [];
  }
}
