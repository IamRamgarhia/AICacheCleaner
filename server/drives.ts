import fs from 'fs';
import os from 'os';

export interface DriveInfo { root: string; freeBytes: number; totalBytes: number }

/** Mounted drives with free/total space. Windows: every lettered drive that answers. */
export async function listDrives(): Promise<DriveInfo[]> {
  const roots = process.platform === 'win32'
    ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `${l}:\\`)
    : ['/', os.homedir()];
  const infos = await Promise.all(roots.map(async root => {
    try {
      const s = await Promise.race([
        fs.promises.statfs(root),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000))
      ]);
      return { root, freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
    } catch {
      return null;
    }
  }));
  // Drop missing letters and duplicates (home is usually on "/").
  return infos.filter((d): d is DriveInfo => d !== null && d.totalBytes > 0)
    .filter((d, i, all) => all.findIndex(o => o.totalBytes === d.totalBytes && o.freeBytes === d.freeBytes) === i);
}
