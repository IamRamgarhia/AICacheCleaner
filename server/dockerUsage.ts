import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

// Docker prints sizes with decimal units (go-units HumanSize: 1 GB = 1e9 B).
const UNIT: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** "5.581GB" -> 5581000000. Unparseable input -> 0. */
export function parseDockerSize(text: string): number {
  const m = /^([\d.]+)\s*([kKMGT]?B)/.exec(text.trim());
  return m ? Math.round(parseFloat(m[1]) * (UNIT[m[2].toUpperCase()] ?? 0)) : 0;
}

const CACHE_FILE = path.join(os.homedir(), '.ai-cache-cleaner', 'docker-usage.json');

async function liveStoredBytes(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['system', 'df', '--format', '{{json .}}'], {
      windowsHide: true,
      timeout: 15_000
    });
    const rows = stdout.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as { Size: string });
    return rows.length ? rows.reduce((acc, r) => acc + parseDockerSize(r.Size), 0) : null;
  } catch {
    return null;
  }
}

/**
 * Pure rule for reusing a remembered reading: only while the disk file is
 * byte-for-byte the same file it was when Docker reported (not modified since).
 */
export function reusableReading(saved: { bytes: number; at: number } | null, diskMtimeMs: number): number | null {
  return saved && diskMtimeMs > 0 && diskMtimeMs <= saved.at ? saved.bytes : null;
}

/**
 * Bytes Docker actually stores (images + containers + volumes + build cache).
 * Asks Docker when it's running and remembers the answer. When Docker is
 * stopped — which is exactly when you'd compact — the remembered answer is
 * reused only if the disk file hasn't changed since; otherwise null (no guess).
 */
export async function dockerStoredBytes(diskMtimeMs = 0): Promise<number | null> {
  const live = await liveStoredBytes();
  if (live !== null) {
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ bytes: live, at: Date.now() }), 'utf-8');
    } catch { /* remembering is best-effort */ }
    return live;
  }
  try {
    return reusableReading(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')), diskMtimeMs);
  } catch {
    return null;
  }
}
