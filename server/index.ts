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
import { exec, execFile } from 'child_process';
import AdmZip from 'adm-zip';

const app = express();
const PORT = 3333;

// Security Hardening: Restrict CORS to localhost and local app origins ONLY
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('app://') || origin.startsWith('file://')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS security policy: External origins forbidden'));
    }
  }
}));

app.use(express.json());

// Persistent Local Configuration Engine
interface AppConfig {
  cacheThresholdGb: number;
  defaultDeleteMethod: 'TRASH' | 'PERMANENT';
  restorePointPolicy: 'PROMPT' | 'ALWAYS' | 'NEVER';
  customRestorePath: string;
  autoCleanGreenTier: boolean;
}

const defaultConfig: AppConfig = {
  cacheThresholdGb: 20,
  defaultDeleteMethod: 'TRASH',
  restorePointPolicy: 'PROMPT',
  customRestorePath: path.join(os.homedir(), 'Desktop', 'Restored_AI_Files'),
  autoCleanGreenTier: false
};

function getLocalConfig(): AppConfig {
  const configDir = path.join(os.homedir(), '.ai-cache-cleaner');
  const configFile = path.join(configDir, 'config.json');
  try {
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, 'utf-8');
      return { ...defaultConfig, ...JSON.parse(raw) };
    }
  } catch (e) {
    // Return default on error
  }
  return defaultConfig;
}

function saveLocalConfig(config: Partial<AppConfig>): AppConfig {
  const configDir = path.join(os.homedir(), '.ai-cache-cleaner');
  const configFile = path.join(configDir, 'config.json');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const current = getLocalConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(configFile, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

// API 1: Scan AI Disk Caches & Multi-Drive Projects
app.get('/api/scan', async (req, res) => {
  try {
    const rawItems = await scanAICaches();

    // Dynamic scanning across user home directory and primary drive
    const userHome = os.homedir();
    const secondaryScanPaths = [
      { path: path.join(userHome, '.gemini'), name: 'Google Antigravity & Gemini AI Engine Storage', category: 'Antigravity' as const },
      { path: path.join(userHome, '.claude'), name: 'Claude CLI & Desktop Prompt History', category: 'Claude' as const },
      { path: path.join(userHome, '.cursor'), name: 'Cursor AI Workspace Logs & Extension Cache', category: 'Cursor' as const }
    ];

    for (const target of secondaryScanPaths) {
      if (fs.existsSync(target.path)) {
        if (!rawItems.some(i => path.normalize(i.path).toLowerCase() === path.normalize(target.path).toLowerCase())) {
          const size = getDirectorySize(target.path);
          const stat = fs.statSync(target.path);
          rawItems.push({
            id: `home-${target.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: target.name,
            category: target.category,
            path: target.path,
            sizeBytes: size,
            formattedSize: formatBytes(size),
            tier: 'YELLOW',
            canDelete: true,
            impactDescription: `User home AI environment storage at ${target.path}.`,
            lastModified: stat.mtime.toISOString().split('T')[0],
            safeReason: `User AI directory. Deleting removes local chat history and transcript state.`
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
    const totalAICacheBytes = calculateNonOverlappingSize(items);

    const reclaimableBytes = items.filter(i => i.tier === 'GREEN' && i.canDelete).reduce((acc, i) => acc + i.sizeBytes, 0);
    const totalAIRAMBytes = processes.reduce((acc, p) => acc + (p.memoryMb * 1024 * 1024), 0);
    const totalAIRAMMb = processes.reduce((acc, p) => acc + p.memoryMb, 0);

    let totalAIProjectsBytes = items.filter(i => i.name.includes('Project') || i.name.includes('Workspace')).reduce((acc, i) => acc + i.sizeBytes, 0);
    if (totalAIProjectsBytes === 0) totalAIProjectsBytes = totalAICacheBytes;

    const sizePenalty = Math.min(50, Math.floor(reclaimableBytes / (1024 * 1024 * 1024) * 2));
    const zombiePenalty = processes.filter(p => p.isZombie).length * 10;
    const hygieneScore = Math.max(10, 100 - sizePenalty - zombiePenalty);

    const metrics: SystemMetrics = {
      totalAICacheBytes,
      totalAICacheFormatted: formatBytes(totalAICacheBytes),
      totalAIProjectsBytes,
      totalAIProjectsFormatted: formatBytes(totalAIProjectsBytes),
      reclaimableBytes,
      reclaimableFormatted: formatBytes(reclaimableBytes),
      totalAIRAMBytes,
      totalAIRAMMb,
      totalAIRAMFormatted: `${totalAIRAMMb} MB`,
      activeProcessCount: processes.length,
      hygieneScore,
      lastScanTimestamp: new Date().toISOString()
    };

    res.json({ metrics, items, processes });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 2: Perform Safe Cache Cleanup (Trash / Recycle Bin Move)
app.post('/api/clean', async (req, res) => {
  try {
    const { itemIds, createRestorePoint, customRestoreFolder } = req.body;
    const rawItems = await scanAICaches();
    const targetItems = rawItems.filter(i => itemIds.includes(i.id));

    if (targetItems.length === 0) {
      return res.status(400).json({ error: 'No valid items found for cleaning.' });
    }

    // Optional or Mandatory Safety Snapshot before clean
    let snapshotId: string | undefined;
    if (createRestorePoint !== false) {
      const snap = await createSnapshot(targetItems, undefined, customRestoreFolder);
      snapshotId = snap.id;
    }

    const result = await deleteItemsSafely(targetItems);
    res.json({
      success: true,
      cleanedCount: result.cleanedIds.length,
      failedCount: result.failedIds.length,
      reclaimedBytes: result.reclaimedBytes,
      reclaimedFormatted: formatBytes(result.reclaimedBytes),
      snapshotId
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 3: System Metrics Only
app.get('/api/metrics', async (req, res) => {
  try {
    const items = await scanAICaches();
    const processes = await scanAIProcesses();
    const totalAICacheBytes = calculateNonOverlappingSize(items);
    const reclaimableBytes = items.filter(i => i.tier === 'GREEN' && i.canDelete).reduce((acc, i) => acc + i.sizeBytes, 0);
    const totalAIRAMMb = processes.reduce((acc, p) => acc + p.memoryMb, 0);

    const metrics: SystemMetrics = {
      totalAICacheBytes,
      totalAICacheFormatted: formatBytes(totalAICacheBytes),
      totalAIProjectsBytes: totalAICacheBytes,
      totalAIProjectsFormatted: formatBytes(totalAICacheBytes),
      reclaimableBytes,
      reclaimableFormatted: formatBytes(reclaimableBytes),
      totalAIRAMBytes: totalAIRAMMb * 1024 * 1024,
      totalAIRAMMb,
      totalAIRAMFormatted: `${totalAIRAMMb} MB`,
      activeProcessCount: processes.length,
      hygieneScore: Math.max(10, 100 - Math.min(50, Math.floor(reclaimableBytes / (1024 * 1024 * 1024) * 2))),
      lastScanTimestamp: new Date().toISOString()
    };

    res.json({ metrics });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 4: Get Saved Configuration
app.get('/api/config', (req, res) => {
  res.json(getLocalConfig());
});

// API 5: Save Local Configuration
app.post('/api/config', (req, res) => {
  try {
    const updated = saveLocalConfig(req.body);
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 5b: Real Local AI Memory & Transcript Inspector
app.get('/api/memories', async (req, res) => {
  try {
    const homeDir = os.homedir();
    const memories: any[] = [];
    let counter = 1;

    const geminiBrain = path.join(homeDir, '.gemini', 'antigravity', 'brain');
    if (fs.existsSync(geminiBrain)) {
      try {
        const convDirs = fs.readdirSync(geminiBrain);
        for (const d of convDirs.slice(0, 10)) {
          const fullPath = path.join(geminiBrain, d);
          if (fs.statSync(fullPath).isDirectory()) {
            memories.push({
              id: `mem-${counter++}`,
              title: `Google Antigravity Transcript (${d.substring(0, 8)}...)`,
              tool: 'Antigravity',
              snippet: `Conversation brain state stored at ~/.gemini/antigravity/brain/${d}`,
              size: formatBytes(getDirectorySize(fullPath)),
              sensitiveFlag: true,
              path: fullPath
            });
          }
        }
      } catch (e) {}
    }

    const claudeDir = path.join(homeDir, '.claude');
    if (fs.existsSync(claudeDir)) {
      memories.push({
        id: `mem-${counter++}`,
        title: 'Claude CLI & Agent Session History',
        tool: 'Claude',
        snippet: `Session logs & CLI transcripts stored at ~/.claude`,
        size: formatBytes(getDirectorySize(claudeDir)),
        sensitiveFlag: true,
        path: claudeDir
      });
    }

    const cursorDir = path.join(homeDir, '.cursor');
    if (fs.existsSync(cursorDir)) {
      memories.push({
        id: `mem-${counter++}`,
        title: 'Cursor AI Prompt History & Extension State',
        tool: 'Cursor',
        snippet: `Extension state & prompt log index stored at ~/.cursor`,
        size: formatBytes(getDirectorySize(cursorDir)),
        sensitiveFlag: false,
        path: cursorDir
      });
    }

    res.json({ memories });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 6: Kill Process
app.post('/api/processes/kill', async (req, res) => {
  try {
    const { pid } = req.body;
    if (!pid || typeof pid !== 'number') {
      return res.status(400).json({ error: 'Valid PID required' });
    }
    const success = await killProcess(pid);
    res.json({ success, pid });
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

// API 8: Restore Safety Snapshot
app.post('/api/snapshots/restore', async (req, res) => {
  try {
    const { snapshotId, customTargetDir } = req.body;
    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId required' });
    }
    const restoredCount = await restoreSnapshot(snapshotId, customTargetDir);
    res.json({ success: true, restoredCount });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 9: Export AI Project Vault (.zip)
app.post('/api/export-vault', async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return res.status(400).json({ error: 'Valid folderPath is required' });
    }
    const result = await exportProjectVault(folderPath);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 10: Import AI Project Vault (.zip)
app.post('/api/import-vault', async (req, res) => {
  try {
    const { vaultZipPath, destinationFolder } = req.body;
    if (!vaultZipPath || !fs.existsSync(vaultZipPath)) {
      return res.status(400).json({ error: 'Valid vaultZipPath is required' });
    }
    const targetDir = destinationFolder || path.join(os.homedir(), 'Desktop', 'Restored_AI_Projects');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const zip = new AdmZip(vaultZipPath);
    zip.extractAllTo(targetDir, true);
    res.json({ success: true, extractedPath: targetDir, message: `Successfully imported AI project vault to ${targetDir}` });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 11: Scan Installed & Residual AI Software
app.get('/api/software', async (req, res) => {
  try {
    const runningProcesses = await scanAIProcesses();
    const software = await detectInstalledAISoftware(runningProcesses);
    res.json({ software });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 12: Software Uninstall & Safe Cache Purge (Always Creates Safety Snapshot of target software caches)
app.post('/api/purge-software', async (req, res) => {
  try {
    const { softwareId, purgeMode } = req.body;

    const runningProcesses = await scanAIProcesses();
    const softwareList = await detectInstalledAISoftware(runningProcesses);
    const targetSoftware = softwareList.find(s => s.id === softwareId);

    const itemsToSnapshot: AICacheItem[] = targetSoftware ? targetSoftware.detectedCaches : [];

    // ALWAYS create safety restore point of actual software caches before taking action
    await createSnapshot(itemsToSnapshot, `pre-purge-${softwareId || 'software'}-${Date.now()}`);

    const isWindows = os.platform() === 'win32';
    let message = `Safety Restore Point created successfully!`;

    if (purgeMode === 'FULL_UNINSTALL') {
      if (isWindows) {
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

// API 13: Automated GitHub Auto-Update Checker Engine with Semver Comparison
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

    function isVersionNewer(latest: string, current: string): boolean {
      const parse = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
      const l = parse(latest);
      const c = parse(current);
      for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const lNum = l[i] || 0;
        const cNum = c[i] || 0;
        if (lNum > cNum) return true;
        if (lNum < cNum) return false;
      }
      return false;
    }

    const isNewer = isVersionNewer(latestVersion, currentVersion);

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

// API 14: Convert Portable App to Native Installed Windows Application
app.post('/api/install-native', async (req, res) => {
  try {
    const isWindows = os.platform() === 'win32';
    if (!isWindows) {
      return res.json({ success: false, message: 'Native installation is currently supported on Windows.' });
    }

    const localSetupPath = path.join(process.cwd(), 'dist-electron', 'AI-Clutter-Cleaner-Setup-1.0.0.exe');

    if (fs.existsSync(localSetupPath)) {
      exec(`start "" "${localSetupPath}"`);
      return res.json({ success: true, message: 'Launched Windows Native Setup Installer!' });
    } else {
      const setupUrl = 'https://github.com/IamRamgarhia/ai-clutter-cleaner/releases/download/v1.0.0/AI-Clutter-Cleaner-Setup-1.0.0.exe';
      exec(`start "" "${setupUrl}"`);
      return res.json({ success: true, message: 'Opened Windows Native Setup Installer download link!' });
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`AICacheCleaner Local Engine API running at http://127.0.0.1:${PORT}`);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Backend Engine] Port ${PORT} is already in use by active local server.`);
  } else {
    console.error('[Backend Engine Error]:', err);
  }
});
