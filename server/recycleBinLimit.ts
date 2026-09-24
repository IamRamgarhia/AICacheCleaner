import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Windows only keeps a deleted item in the Recycle Bin if it fits the bin's
 * per-drive size limit; anything that doesn't fit is deleted permanently, and
 * filling the bin silently purges the user's OLDEST recycled files. Removable,
 * network and UNC paths have no bin at all. So before any delete we read each
 * drive's limit and current usage, and refuse anything that would not land in
 * the bin intact.
 */
const PS_BIN_STATE = `
$vols = @{}; Get-CimInstance Win32_Volume | Where-Object DriveLetter | ForEach-Object { $vols[$_.DeviceID] = $_.DriveLetter }
$out = @{}
Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume' -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  $letter = $vols["\\\\?\\Volume$($_.PSChildName)\\"]
  if ($letter) {
    $used = (Get-ChildItem -LiteralPath ($letter + '\\$Recycle.Bin') -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    $out[$letter.ToUpper()] = @{ mb = [int64]$p.MaxCapacity; nuke = [int]$p.NukeOnDelete; used = [int64]$used }
  }
}
$out | ConvertTo-Json -Compress`;

export interface BinLimit { bytes: number; usedBytes: number; nukeOnDelete: boolean }

/**
 * Read fresh on every delete (settings can change while the app is open).
 * Throws when the state can't be read — callers must treat that as "refuse",
 * never as "no limit".
 */
export async function recycleBinLimits(): Promise<Map<string, BinLimit>> {
  const limits = new Map<string, BinLimit>();
  if (process.platform !== 'win32') return limits;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_BIN_STATE],
    { windowsHide: true, timeout: 30_000 }
  );
  const parsed = JSON.parse(stdout || '{}') as Record<string, { mb: number; nuke: number; used: number }>;
  for (const [drive, v] of Object.entries(parsed)) {
    limits.set(drive, { bytes: v.mb * 1024 * 1024, usedBytes: v.used || 0, nukeOnDelete: v.nuke === 1 });
  }
  if (limits.size === 0) throw new Error('No Recycle Bin settings found');
  return limits;
}

/** "C:" for a normal drive path; null for UNC, \\?\ and anything else. */
function driveOf(p: string): string | null {
  const m = /^([a-zA-Z]):[\\/]/.exec(p);
  return m ? `${m[1].toUpperCase()}:` : null;
}

/**
 * Items that would NOT land in the Recycle Bin intact. Checked per drive on
 * the TOTAL selection plus what the bin already holds, keeping 10% headroom,
 * so one big clean can't push the user's earlier deletions out of the bin.
 */
export function itemsThatSkipRecycleBin<T extends { path: string; sizeBytes: number }>(
  items: T[],
  limits: Map<string, BinLimit>
): { item: T; reason: string }[] {
  if (process.platform !== 'win32' && limits.size === 0) return [];

  const refused: { item: T; reason: string }[] = [];
  const byDrive = new Map<string, T[]>();
  for (const item of items) {
    const drive = driveOf(path.normalize(item.path));
    const limit = drive ? limits.get(drive) : undefined;
    if (!drive || !limit) {
      refused.push({ item, reason: 'this location has no Recycle Bin (network, removable or unknown drive), so Windows would delete it permanently' });
    } else if (limit.nukeOnDelete) {
      refused.push({ item, reason: `the Recycle Bin is turned off on ${drive}` });
    } else {
      byDrive.set(drive, [...(byDrive.get(drive) ?? []), item]);
    }
  }

  for (const [drive, group] of byDrive) {
    const limit = limits.get(drive)!;
    const room = limit.bytes * 0.9 - limit.usedBytes;
    const total = group.reduce((acc, i) => acc + i.sizeBytes, 0);
    if (total > room) {
      const gb = (n: number) => (Math.max(0, n) / 1024 ** 3).toFixed(1);
      for (const item of group) {
        refused.push({
          item,
          reason: `the selection on ${drive} is ${gb(total)} GB but its Recycle Bin only has room for ${gb(room)} GB — Windows would delete permanently or purge older recycled files`
        });
      }
    }
  }
  return refused;
}
