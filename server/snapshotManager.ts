import fs from 'fs';
import path from 'path';
import os from 'os';
import trash from 'trash';
import { AICacheItem, SnapshotItem } from '../src/types';
import { formatBytes } from './scanner';

const snapshotDir = path.join(os.homedir(), '.ai-cache-cleaner', 'snapshots');

export function ensureDirs() {
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }
}

export async function createSnapshot(items: AICacheItem[], note?: string): Promise<SnapshotItem> {
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
    note
  };

  const snapshotJsonPath = path.join(snapshotDir, `${snapshotId}.json`);
  fs.writeFileSync(snapshotJsonPath, JSON.stringify(snapshot, null, 2), 'utf-8');

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

  return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function restoreSnapshot(snapshotId: string, customDestinationPath?: string): Promise<{ success: boolean; restoredPaths: string[]; recoverableFromTrash: boolean; error?: string }> {
  ensureDirs();
  const snapshotJsonPath = path.join(snapshotDir, `${snapshotId}.json`);

  if (!fs.existsSync(snapshotJsonPath)) {
    return { success: false, restoredPaths: [], recoverableFromTrash: false, error: 'Snapshot record not found' };
  }

  try {
    const snapshot: SnapshotItem = JSON.parse(fs.readFileSync(snapshotJsonPath, 'utf-8'));

    // Items were soft-deleted to the OS Recycle Bin / Trash, not physically copied here.
    // A "restore" therefore means: verify whether each original path already exists again
    // (user may have already restored it from Trash), and report the paths to recover.
    const restoredPaths: string[] = [];
    for (const item of snapshot.items) {
      const targetPath = customDestinationPath
        ? path.join(customDestinationPath, item.name.replace(/[^a-zA-Z0-9_-]/g, '_'))
        : item.path;
      if (fs.existsSync(item.path) || (customDestinationPath && fs.existsSync(targetPath))) {
        restoredPaths.push(targetPath);
      }
    }

    return {
      success: true,
      restoredPaths,
      recoverableFromTrash: true,
      error: restoredPaths.length === snapshot.items.length
        ? undefined
        : 'Items were soft-deleted to your Recycle Bin / Trash. Open the Recycle Bin / Trash to restore remaining items to their original locations.'
    };
  } catch (e) {
    return { success: false, restoredPaths: [], recoverableFromTrash: false, error: (e as Error).message };
  }
}

export async function deleteItemsSafely(targetPaths: string[]): Promise<{ success: boolean; movedToTrash: string[]; errors: string[] }> {
  const movedToTrash: string[] = [];
  const errors: string[] = [];

  for (const targetPath of targetPaths) {
    if (!fs.existsSync(targetPath)) continue;

    try {
      // Soft-delete: Send to OS Recycle Bin / Trash
      await trash(targetPath);
      movedToTrash.push(targetPath);
    } catch (e) {
      errors.push(`Failed to delete ${targetPath}: ${(e as Error).message}`);
    }
  }

  return {
    success: errors.length === 0,
    movedToTrash,
    errors
  };
}
