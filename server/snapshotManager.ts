import fs from 'fs';
import path from 'path';
import os from 'os';
import trash from 'trash';
import { AICacheItem, SnapshotItem } from '../src/types';
import { formatBytes } from './scanner';

const snapshotDir = path.join(os.homedir(), '.ai-cache-cleaner', 'snapshots');
const backupStorageDir = path.join(os.homedir(), '.ai-cache-cleaner', 'backups');

export function ensureDirs() {
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }
  if (!fs.existsSync(backupStorageDir)) {
    fs.mkdirSync(backupStorageDir, { recursive: true });
  }
}

export async function createSnapshot(items: AICacheItem[]): Promise<SnapshotItem> {
  ensureDirs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotId = `snapshot_${timestamp}`;
  const totalSizeBytes = items.reduce((acc, item) => acc + item.sizeBytes, 0);

  // Backup files into local snapshot storage before soft-delete
  const snapshotBackupPath = path.join(backupStorageDir, snapshotId);
  fs.mkdirSync(snapshotBackupPath, { recursive: true });

  for (const item of items) {
    if (fs.existsSync(item.path)) {
      try {
        const dest = path.join(snapshotBackupPath, item.id);
        fs.cpSync(item.path, dest, { recursive: true });
      } catch (e) {
        // Skip uncopyable files
      }
    }
  }

  const snapshot: SnapshotItem = {
    snapshotId,
    timestamp: new Date().toLocaleString(),
    itemCount: items.length,
    totalSizeBytes,
    formattedSize: formatBytes(totalSizeBytes),
    items
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

export async function restoreSnapshot(snapshotId: string, customDestinationPath?: string): Promise<{ success: boolean; restoredPaths: string[]; error?: string }> {
  ensureDirs();
  const snapshotJsonPath = path.join(snapshotDir, `${snapshotId}.json`);
  const snapshotBackupPath = path.join(backupStorageDir, snapshotId);

  if (!fs.existsSync(snapshotJsonPath)) {
    return { success: false, restoredPaths: [], error: 'Snapshot record not found' };
  }

  try {
    const snapshot: SnapshotItem = JSON.parse(fs.readFileSync(snapshotJsonPath, 'utf-8'));
    const restoredPaths: string[] = [];

    for (const item of snapshot.items) {
      const backupItemPath = path.join(snapshotBackupPath, item.id);
      if (fs.existsSync(backupItemPath)) {
        const targetPath = customDestinationPath
          ? path.join(customDestinationPath, item.name.replace(/[^a-zA-Z0-9_-]/g, '_'))
          : item.path;

        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.cpSync(backupItemPath, targetPath, { recursive: true });
        restoredPaths.push(targetPath);
      }
    }

    return { success: true, restoredPaths };
  } catch (e) {
    return { success: false, restoredPaths: [], error: (e as Error).message };
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
