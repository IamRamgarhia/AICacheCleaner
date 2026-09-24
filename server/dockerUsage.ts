import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Docker prints sizes with decimal units (go-units HumanSize: 1 GB = 1e9 B).
const UNIT: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** "5.581GB" -> 5581000000. Unparseable input -> 0. */
export function parseDockerSize(text: string): number {
  const m = /^([\d.]+)\s*([kKMGT]?B)/.exec(text.trim());
  return m ? Math.round(parseFloat(m[1]) * (UNIT[m[2].toUpperCase()] ?? 0)) : 0;
}

/**
 * Bytes Docker actually stores (images + containers + volumes + build cache),
 * from `docker system df`. Null when Docker isn't running — we then don't
 * guess how much of the virtual disk is empty.
 */
export async function dockerStoredBytes(): Promise<number | null> {
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
