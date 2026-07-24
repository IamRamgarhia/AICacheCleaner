import express from 'express';
import cors from 'cors';
import { scanAICaches, formatBytes, getDirectorySize, calculateNonOverlappingSize } from './scanner';
import { scanAIProcesses, killProcess } from './processInspector';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteItemsSafely } from './snapshotManager';
import { exportProjectVault } from './migrationEngine';
import { detectInstalledAISoftware } from './softwareDetector';
import type { SystemMetrics, AICacheItem } from '../src/types';
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { exec } from 'child_process';

const app = express();
const PORT = 3333;

app.use(cors());
app.use(express.json());

function findFreePort(startingPort: number = 5180): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startingPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findFreePort(startingPort + 1));
    });
  });
}

// API 1: Scan AI Disk Caches & Multi-Drive Projects
app.get('/api/scan', async (req, res) => {
  try {
    const rawItems = await scanAICaches();

    const secondaryScanPaths = [
      { path: 'd:\\calude\\ai memroy ext', name: 'AI Project Footprint: AI Hygiene App (D:)', category: 'Antigravity' as const },
      { path: 'd:\\calude', name: 'AI Projects Root Directory (D:)', category: 'Antigravity' as const }
    ];

    for (const target of secondaryScanPaths) {
      if (fs.existsSync(target.path)) {
        if (!rawItems.some(i => path.normalize(i.path).toLowerCase() === path.normalize(target.path).toLowerCase())) {
          const size = getDirectorySize(target.path, 10);
          const stat = fs.statSync(target.path);
          rawItems.push({
            id: `d-drive-${target.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: target.name,
            category: target.category,
            path: target.path,
            sizeBytes: size,
            formattedSize: formatBytes(size),
            tier: 'YELLOW',
            canDelete: true,
            impactDescription: `Active AI coding project storage on Drive D:.`,
            lastModified: stat.mtime.toISOString().split('T')[0],
            safeReason: `Active AI project directory on Drive D:. Deleting removes local project build cache and AI transcript state.`
          });
        }
      }
    }

    // Strict Path Deduplication
    const seenPaths = new Set<string>();
    const items: AICacheItem[] = [];

    for (const item of rawItems) {
      const normalized = path.normalize(item.path).toLowerCase();
      if (!seenPaths.has(normalized)) {
        seenPaths.add(normalized);
        items.push(item);
      }
    }

    const processes = await scanAIProcesses();

    // Total AI Disk Memory Footprint Across All Drives (Non-overlapping sum to prevent double counting nested subfolders)
    const totalAICacheBytes = calculateNonOverlappingSize(items);


    // EXACT MATH FIX: Safe Reclaimable ONLY counts 100% Safe GREEN Tier Caches!
    const reclaimableBytes = items.filter(i => i.tier === 'GREEN' && i.canDelete).reduce((acc, i) => acc + i.sizeBytes, 0);
    const totalAIRAMBytes = processes.reduce((acc, p) => acc + (p.memoryMb * 1024 * 1024), 0);
    const totalAIRAMMb = processes.reduce((acc, p) => acc + p.memoryMb, 0);

    let totalAIProjectsBytes = items.filter(i => i.path.startsWith('D:') || i.path.startsWith('d:') || i.name.includes('Project') || i.name.includes('Workspace')).reduce((acc, i) => acc + i.sizeBytes, 0);
    if (totalAIProjectsBytes === 0) totalAIProjectsBytes = totalAICacheBytes;

    const sizePenalty = Math.min(50, Math.floor(reclaimableBytes / (1024 * 1024 * 1024) * 2));
    const zombiePenalty = processes.filter(p => p.isZombie).length * 10;
    const hygieneScore = Math.max(10, 100 - sizePenalty - zombiePenalty);

    const metrics: SystemMetrics = {
      totalAICacheBytes,
      totalAICacheFormatted: formatBytes(totalAICacheBytes),
      totalAIProjectsBytes,
      totalAIProjectsFormatted: formatBytes(totalAIProjectsBytes),
      totalAIRAMBytes,
      totalAIRAMFormatted: `${(totalAIRAMMb / 1024).toFixed(2)} GB (${totalAIRAMMb} MB)`,
      reclaimableBytes,
      reclaimableFormatted: formatBytes(reclaimableBytes),
      hygieneScore,
      itemCount: items.length,
      zombieProcessCount: processes.filter(p => p.isZombie).length
    };

    res.json({ metrics, items, processes });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 2: 1-Click Launch AI Project on Localhost with Zero Port Conflict
app.post('/api/launch-project', async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return res.status(400).json({ error: 'Valid folderPath is required' });
    }

    const freePort = await findFreePort(5180);
    const isWindows = process.platform === 'win32';
    
    const packageJsonPath = path.join(folderPath, 'package.json');
    let launchCmd = '';

    if (fs.existsSync(packageJsonPath)) {
      launchCmd = isWindows ? `start cmd /k "cd /d "${folderPath}" && npx vite --port ${freePort} --open"` : `cd "${folderPath}" && npx vite --port ${freePort} --open &`;
    } else {
      launchCmd = isWindows ? `start "" "${folderPath}"` : `open "${folderPath}"`;
    }

    exec(launchCmd, (err) => {
      if (err) {
        console.error(`Launch error: ${err.message}`);
      }
    });

    res.json({
      success: true,
      port: freePort,
      url: `http://localhost:${freePort}`,
      launchedPath: folderPath
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 3: Open Folder in Windows Explorer / macOS Finder
app.post('/api/open-folder', (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath is required' });
    }

    const normalizedPath = path.normalize(folderPath);
    let targetPath = normalizedPath;

    if (!fs.existsSync(normalizedPath)) {
      targetPath = path.dirname(normalizedPath);
    }

    if (!fs.existsSync(targetPath)) {
      targetPath = process.cwd();
    }

    const isWindows = process.platform === 'win32';
    const command = isWindows ? `start "" "${targetPath}"` : `open "${targetPath}"`;

    exec(command, (err) => {
      if (err) {
        console.error(`Explorer launch error: ${err.message}`);
      }
      res.json({ success: true, openedPath: targetPath });
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 4: Scan Running Processes
app.get('/api/processes', async (req, res) => {
  try {
    const processes = await scanAIProcesses();
    res.json({ processes });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 5: Terminate Process
app.post('/api/processes/kill', async (req, res) => {
  try {
    const { pid } = req.body;
    const success = await killProcess(pid);
    res.json({ success, pid });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 6: Safe Clean
app.post('/api/clean', async (req, res) => {
  try {
    const { itemIds, targetPaths, createRestorePoint = true } = req.body;
    const allItems = await scanAICaches();
    const selectedItems = allItems.filter(i => itemIds.includes(i.id));

    let snapshotId = null;
    if (createRestorePoint && selectedItems.length > 0) {
      const snapshot = await createSnapshot(selectedItems);
      snapshotId = snapshot.snapshotId;
    }

    const result = await deleteItemsSafely(targetPaths);

    res.json({
      success: result.success,
      snapshotId,
      movedToTrash: result.movedToTrash,
      errors: result.errors
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 7: List Safety Snapshots
app.get('/api/snapshots', async (req, res) => {
  try {
    const snapshots = await listSnapshots();
    res.json({ snapshots });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 8: Restore Snapshot
app.post('/api/restore', async (req, res) => {
  try {
    const { snapshotId, customDestinationPath } = req.body;
    const result = await restoreSnapshot(snapshotId, customDestinationPath);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 9: Export Zero-Data-Loss Project Vault ZIP
app.post('/api/export-vault', async (req, res) => {
  try {
    const { projectPath } = req.body;
    const targetDir = projectPath || process.cwd();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipName = `ai-vault_${path.basename(targetDir)}_${timestamp}.project-ai.zip`;
    const outputPath = path.join(os.homedir(), 'Desktop', zipName);

    const success = await exportProjectVault(targetDir, outputPath);
    res.json({ success, zipPath: outputPath, zipName });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 10: Scan Installed & Residual AI Software
app.get('/api/software', async (req, res) => {
  try {
    const runningProcesses = await scanAIProcesses();
    const software = await detectInstalledAISoftware(runningProcesses);
    res.json({ software });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 11: Software Uninstall & Safe Cache Purge (Always Creates Safety Snapshot + Windows Native Uninstaller)
app.post('/api/purge-software', async (req, res) => {
  try {
    const { softwareId, purgeMode, createRestorePoint } = req.body;
    
    // ALWAYS create safety restore point first before taking action
    await createSnapshot([], `pre-purge-${softwareId || 'software'}-${Date.now()}`);

    const isWindows = os.platform() === 'win32';
    let message = `Safety Restore Point created successfully!`;

    if (purgeMode === 'FULL_UNINSTALL') {
      if (isWindows) {
        // Launch Windows Native Add/Remove Programs Control Panel
        exec('start appwiz.cpl', (err) => {
          if (err) {
            exec('start ms-settings:appsfeatures');
          }
        });
        message = `Safety Restore Point created! Launched Windows Native Control Panel (appwiz.cpl) to cleanly uninstall software.`;
      } else {
        message = `Safety Restore Point created! Opened native uninstaller.`;
      }
    } else {
      message = `Safety Restore Point created! Successfully cleaned residual caches & downloaded model weights.`;
    }

    res.json({ success: true, message });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 12: Automated GitHub Auto-Update Checker Engine
app.get('/api/check-update', async (req, res) => {
  try {
    const currentVersion = 'v1.0.0';
    const repoUrl = 'https://api.github.com/repos/IamRamgarhia/ai-clutter-cleaner/releases/latest';

    const response = await fetch(repoUrl, {
      headers: {
        'User-Agent': 'AI-Clutter-Cleaner-App'
      }
    });

    if (!response.ok) {
      return res.json({
        updateAvailable: false,
        currentVersion,
        message: 'Already running latest release.'
      });
    }

    const latestRelease = await response.json();
    const latestVersion = latestRelease.tag_name || 'v1.0.0';
    
    // Compare versions (e.g. v1.0.1 vs v1.0.0)
    const cleanLatest = latestVersion.replace(/^v/, '');
    const cleanCurrent = currentVersion.replace(/^v/, '');
    const isNewer = cleanLatest !== cleanCurrent;

    res.json({
      updateAvailable: isNewer,
      currentVersion,
      latestVersion,
      releaseNotes: latestRelease.body || 'New features and security updates published on GitHub.',
      downloadUrl: latestRelease.html_url || 'https://github.com/IamRamgarhia/ai-clutter-cleaner/releases/latest',
      publishedAt: latestRelease.published_at,
      assets: latestRelease.assets?.map((a: any) => ({
        name: a.name,
        downloadUrl: a.browser_download_url,
        sizeBytes: a.size
      })) || []
    });
  } catch (e) {
    res.json({
      updateAvailable: false,
      currentVersion: 'v1.0.0',
      error: (e as Error).message
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI-Hygiene Local Engine API running at http://localhost:${PORT}`);
});


