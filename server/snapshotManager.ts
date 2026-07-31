import fs from 'fs';
import path from 'path';
import os from 'os';
import { moveToTrash } from './trashBridge';
import { restoreFromRecycleBin } from './restoreEngine';
import type { AICacheItem, SnapshotItem } from '../src/types';
import { formatBytes } from './scanner';

const snapshotDir = path.join(os.homedir(), '.ai-cache-cleaner', 'snapshots');

export function ensureDirs() {
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }
}

export async function createSnapshot(
  items: AICacheItem[],
  note?: string,
  customRestoreFolderPath?: string
): Promise<SnapshotItem> {
  ensureDirs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotId = `snapshot_${timestamp}`;
  const totalSizeBytes = items.reduce((acc, item) => acc + item.sizeBytes, 0);

  // IMPORTANT: We do NOT physically copy files into backupStorageDir.
  // deleteItemsSafely() below soft-deletes to the OS Recycle Bin / Trash, which is
  // itself the recovery path. Copying would double disk usage (e.g. cleaning a 15 GB
  // cache would immediately re-consume 15 GB), defeating the product's purpose.
  // Instead we record a lightweight metadata manifest (path + size + tier) so a
  // restore is a guided operation: the user restores from their Recycle Bin / Trash
  // to the recorded original path, or to a custom destination once recovered.
  const snapshot: SnapshotItem = {
    snapshotId,
    timestamp: new Date().toLocaleString(),
    itemCount: items.length,
    totalSizeBytes,
    formattedSize: formatBytes(totalSizeBytes),
    items,
    note,
    restoreFolderPath: customRestoreFolderPath
  };

  // Atomic write: stage to a temp file then rename, so a crash mid-write cannot
  // leave a corrupt .json that listSnapshots() would silently drop.
  const snapshotJsonPath = path.join(snapshotDir, `${snapshotId}.json`);
  const tmpPath = `${snapshotJsonPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  fs.renameSync(tmpPath, snapshotJsonPath);

  return snapshot;
}

export async function listSnapshots(): Promise<SnapshotItem[]> {
  ensureDirs();
  const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json'));
  const snapshots: SnapshotItem[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(snapshotDir, file), 'utf-8');
      snapshots.push(JSON.parse(content));
    } catch (e) {
      // Skip invalid JSON
    }
  }

  // Sort by snapshotId, which embeds an ISO timestamp and therefore sorts
  // chronologically. `timestamp` is toLocaleString() output ("7/31/2026, 5:35:17 PM"),
  // so comparing it lexicographically listed restore points in the wrong order.
  return snapshots.sort((a, b) => b.snapshotId.localeCompare(a.snapshotId));
}

export async function restoreSnapshot(
  snapshotId: string,
  customDestinationPath?: string
): Promise<{
  success: boolean;
  restoredPaths: string[];
  alreadyInPlace: string[];
  failed: { path: string; reason: string }[];
  recoverableFromTrash: boolean;
  error?: string;
}> {
  ensureDirs();
  const snapshotJsonPath = path.join(snapshotDir, `${snapshotId}.json`);

  if (!fs.existsSync(snapshotJsonPath)) {
    return { success: false, restoredPaths: [], alreadyInPlace: [], failed: [], recoverableFromTrash: false, error: 'Restore point not found' };
  }

  try {
    const snapshot: SnapshotItem = JSON.parse(fs.readFileSync(snapshotJsonPath, 'utf-8'));

    // Anything already back on disk needs no work — the user may have restored
    // it by hand, or the clean may have failed for that item in the first place.
    const alreadyInPlace: string[] = [];
    const toRestore: string[] = [];
    for (const item of snapshot.items) {
      if (fs.existsSync(item.path)) alreadyInPlace.push(item.path);
      else toRestore.push(item.path);
    }

    // This used to stop here and merely report "open your Recycle Bin yourself".
    // Now the files are actually moved back.
    const outcomes = await restoreFromRecycleBin(toRestore, customDestinationPath);

    const restoredPaths = outcomes.filter(o => o.restored).map(o => o.path);
    const failed = outcomes
      .filter(o => !o.restored)
      .map(o => ({ path: o.path, reason: o.reason || 'Unknown error' }));

    return {
      success: failed.length === 0,
      restoredPaths,
      alreadyInPlace,
      failed,
      recoverableFromTrash: failed.length > 0,
      error:
        failed.length > 0
          ? `${failed.length} item(s) could not be restored automatically — they may have been emptied from the Recycle Bin.`
          : undefined
    };
  } catch (e) {
    return { success: false, restoredPaths: [], alreadyInPlace: [], failed: [], recoverableFromTrash: false, error: (e as Error).message };
  }
}

export async function deleteItemsSafely(targetPaths: string[]): Promise<{ success: boolean; movedToTrash: string[]; skipped: string[]; errors: string[] }> {
  const movedToTrash: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const targetPath of targetPaths) {
    // A path that vanished between scan and clean is not a success. Report it
    // separately so the UI can never claim "cleaned N items" for a no-op.
    if (!fs.existsSync(targetPath)) {
      skipped.push(targetPath);
      continue;
    }

    try {
      // Soft-delete: Send to OS Recycle Bin / Trash
      await moveToTrash(targetPath);
      movedToTrash.push(targetPath);
    } catch (e) {
      errors.push(`Failed to delete ${targetPath}: ${(e as Error).message}`);
    }
  }

  return {
    success: errors.length === 0,
    movedToTrash,
    skipped,
    errors
  };
}
