import express from 'express';
import cors from 'cors';
import { scanAICaches, formatBytes, getDirectorySize, calculateNonOverlappingSize } from './scanner';
import { pathExists, readdirSafe } from './fsAsync';
import { scanAIProcesses, killProcess } from './processInspector';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteItemsSafely } from './snapshotManager';
import { exportProjectVault, importProjectVault, exportSingleProject } from './migrationEngine';
import { discoverProjects, findSourcesForProject, UNLINKABLE_TOOLS } from './projectLinker';
import { beginExport, finishExport, getExportProgress } from './exportProgress';
import { detectInstalledAISoftware } from './softwareDetector';
import { convertTranscripts, listAvailableTranscriptApps } from './transcriptConverter';
import type { SystemMetrics, AICacheItem, AISoftwareAppItem } from '../src/types';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawn } from 'child_process';

const app = express();
const PORT = 3333;

// Single source of truth for identity strings that were previously duplicated
// (and drifted) across endpoints.
export const APP_VERSION = '1.0.0';
const GITHUB_REPO = 'IamRamgarhia/AICacheCleaner';
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

// Security Hardening: Restrict CORS to a fixed allowlist of the real local
// origins (Vite dev server, the bundled API, and the Electron renderer).
// Previously any http://localhost:* origin — including unrelated local web
// apps — was accepted, which exposed delete/kill/export endpoints to them.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3333',
  'http://127.0.0.1:3333'
]);

// Host-header allowlist. CORS alone does NOT stop DNS rebinding: an attacker
// domain that re-resolves to 127.0.0.1 becomes same-origin, and CORS never
// applies. Since this server can delete files, kill processes and spawn
// programs, every request must also arrive addressed to a loopback name.
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

app.use((req, res, next) => {
  const rawHost = (req.headers.host || '').toLowerCase();
  // Strip the port; keep bracketed IPv6 literals intact.
  const hostname = rawHost.startsWith('[')
    ? rawHost.slice(0, rawHost.indexOf(']') + 1)
    : rawHost.split(':')[0];

  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    return res.status(403).json({
      error: 'Blocked: request was not addressed to localhost (possible DNS-rebinding attempt).'
    });
  }
  return next();
});

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = same-origin / Electron renderer / curl. Note that a
    // page loaded from file:// sends the literal string "null", which is NOT
    // treated as absent here — it used to be blanket-allowed via a
    // `startsWith('file://')` check that also let in every local HTML file.
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS security policy: External origins forbidden'));
    }
  }
}));

// Bound the request body. Nothing this API accepts is large, and an unbounded
// parser is a trivial memory-exhaustion vector.
app.use(express.json({ limit: '1mb' }));

// Persistent Local Configuration Engine
interface AppConfig {
  cacheThresholdGb: number;
  restorePointPolicy: 'PROMPT' | 'ALWAYS' | 'NEVER';
  customRestorePath: string;
}

// Two settings were removed rather than implemented, because implementing them
// would have contradicted guarantees the product makes everywhere else:
//
//  - `defaultDeleteMethod: 'PERMANENT'` contradicts "soft-deletes to Recycle
//    Bin / Trash (recoverable)", which is the core safety promise.
//  - `autoCleanGreenTier` (weekly auto-clean) contradicts the "100% On-Demand —
//    NEVER runs in the background, 0 background services" guarantee.
//
// Both were dead options in the UI. Deleting them is the honest fix; if either
// is ever genuinely wanted, the surrounding claims have to change first.
const defaultConfig: AppConfig = {
  cacheThresholdGb: 20,
  restorePointPolicy: 'PROMPT',
  customRestorePath: path.join(os.homedir(), 'Desktop', 'Restored_AI_Files')
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

// ---------------------------------------------------------------------------
// Scan cache + single-flight guard.
//
// A full scan walks tens of GB and previously ran on every request: the UI
// fires /api/scan twice on mount (React StrictMode), /api/software walks the
// same directories again, and /api/clean re-ran the WHOLE scan just to turn
// item ids back into paths. Caching the last result collapses all of that into
// one walk, and the in-flight promise makes concurrent callers share it.
// ---------------------------------------------------------------------------
const SCAN_CACHE_TTL_MS = 60_000;

let cachedScan: { at: number; items: AICacheItem[] } | null = null;
let scanInFlight: Promise<AICacheItem[]> | null = null;

// Same treatment for software detection. Discovery widened this from 13 fixed
// paths to every AI directory found across the search roots, so sizing them all
// takes real time — and /api/software is hit by three separate tabs.
let cachedSoftware: { at: number; list: AISoftwareAppItem[] } | null = null;
let softwareInFlight: Promise<AISoftwareAppItem[]> | null = null;

async function getDetectedSoftware(forceRefresh = false): Promise<AISoftwareAppItem[]> {
  if (!forceRefresh && cachedSoftware && Date.now() - cachedSoftware.at < SCAN_CACHE_TTL_MS) {
    return cachedSoftware.list;
  }
  if (softwareInFlight) return softwareInFlight;

  softwareInFlight = (async () => {
    try {
      const processes = await scanAIProcesses();
      const list = await detectInstalledAISoftware(processes);
      cachedSoftware = { at: Date.now(), list };
      return list;
    } finally {
      softwareInFlight = null;
    }
  })();

  return softwareInFlight;
}

async function getScannedItems(forceRefresh = false): Promise<AICacheItem[]> {
  if (!forceRefresh && cachedScan && Date.now() - cachedScan.at < SCAN_CACHE_TTL_MS) {
    return cachedScan.items;
  }
  if (scanInFlight) return scanInFlight;

  scanInFlight = (async () => {
    try {
      const items = await scanAICaches();
      cachedScan = { at: Date.now(), items };
      return items;
    } finally {
      scanInFlight = null;
    }
  })();

  return scanInFlight;
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
    // `?refresh=1` forces a fresh walk; the default reuses the short-lived cache
    // so a StrictMode double-mount doesn't trigger two full disk scans.
    const rawItems = [...(await getScannedItems(req.query.refresh === '1'))];

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
      itemCount: items.length,
      zombieProcessCount: processes.filter(p => p.isZombie).length,
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
    if (!Array.isArray(itemIds)) {
      return res.status(400).json({ error: 'itemIds must be an array of item ids.' });
    }
    // Reuse the cached scan: re-walking every drive here added ~40 s to a
    // click that the user had already confirmed.
    const rawItems = await getScannedItems();
    const targetItems = rawItems.filter((i: AICacheItem) => itemIds.includes(i.id));

    if (targetItems.length === 0) {
      return res.status(400).json({ error: 'No valid items found for cleaning.' });
    }

    // Surface ids the UI asked for that no longer exist in the scan, instead of
    // silently cleaning a subset and reporting the requested count as success.
    const resolvedIds = new Set(targetItems.map(i => i.id));
    const unresolvedIds = itemIds.filter((id: string) => !resolvedIds.has(id));

    // Honour the saved restore-point policy. These settings were previously
    // written to config.json and never read by anything.
    const config = getLocalConfig();
    const wantsSnapshot =
      config.restorePointPolicy === 'ALWAYS' ? true
      : config.restorePointPolicy === 'NEVER' ? false
      : createRestorePoint !== false; // 'PROMPT' — defer to the dialog

    let snapshotId: string | undefined;
    if (wantsSnapshot) {
      const snap = await createSnapshot(
        targetItems,
        undefined,
        customRestoreFolder || config.customRestorePath
      );
      snapshotId = snap.snapshotId;
    }

    // deleteItemsSafely expects the PATH STRINGS to delete, not the item objects.
    const result = await deleteItemsSafely(targetItems.map(i => i.path));

    // Map the helper's real return shape ({ movedToTrash, errors }) onto the
    // API response, computing reclaimed bytes from the items we actually moved.
    const movedPaths = new Set(result.movedToTrash);
    const reclaimedBytes = targetItems
      .filter(i => movedPaths.has(i.path))
      .reduce((acc, i) => acc + i.sizeBytes, 0);

    // The on-disk state just changed, so the cached scan is stale.
    cachedScan = null;

    res.json({
      success: result.success,
      requestedCount: itemIds.length,
      cleanedCount: result.movedToTrash.length,
      failedCount: result.errors.length,
      skippedCount: result.skipped.length + unresolvedIds.length,
      movedPaths: result.movedToTrash,
      skippedPaths: result.skipped,
      unresolvedIds,
      errors: result.errors,
      reclaimedBytes,
      reclaimedFormatted: formatBytes(reclaimedBytes),
      snapshotId
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 3: System Metrics Only
app.get('/api/metrics', async (_req, res) => {
  try {
    const items = await getScannedItems();
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
      itemCount: items.length,
      zombieProcessCount: processes.filter(p => p.isZombie).length,
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
app.get('/api/config', (_req, res) => {
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

// API 5a: Open Folder in Explorer
app.post('/api/open-folder', (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });
    
    const isWindows = os.platform() === 'win32';
    const cleanPath = path.normalize(folderPath);
    const targetDir = fs.existsSync(cleanPath) && fs.statSync(cleanPath).isFile() ? path.dirname(cleanPath) : cleanPath;

    if (isWindows) {
      const child = spawn('explorer.exe', [targetDir], { shell: false, detached: true, stdio: 'ignore' });
      child.on('error', () => { /* explorer missing — best effort */ });
      child.unref();
    } else if (os.platform() === 'darwin') {
      const child = spawn('open', [targetDir], { shell: false, detached: true, stdio: 'ignore' });
      child.on('error', () => { /* best effort */ });
      child.unref();
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 5b: Real Local AI Memory & Transcript Inspector
app.get('/api/memories', async (_req, res) => {
  try {
    const homeDir = os.homedir();
    const memories: any[] = [];
    let counter = 1;

    const geminiBrain = path.join(homeDir, '.gemini', 'antigravity', 'brain');
    if (await pathExists(geminiBrain)) {
      const convDirs = (await readdirSafe(geminiBrain)).filter(d => d.isDirectory()).slice(0, 10);
      for (const d of convDirs) {
        const fullPath = path.join(geminiBrain, d.name);
        memories.push({
          id: `mem-${counter++}`,
          title: `Google Antigravity Transcript (${d.name.substring(0, 8)}...)`,
          tool: 'Antigravity',
          snippet: `Conversation brain state stored at ~/.gemini/antigravity/brain/${d.name}`,
          size: formatBytes(await getDirectorySize(fullPath)),
          sensitiveFlag: true,
          path: fullPath
        });
      }
    }

    const claudeDir = path.join(homeDir, '.claude');
    if (await pathExists(claudeDir)) {
      memories.push({
        id: `mem-${counter++}`,
        title: 'Claude CLI & Agent Session History',
        tool: 'Claude',
        snippet: `Session logs & CLI transcripts stored at ~/.claude`,
        size: formatBytes(await getDirectorySize(claudeDir)),
        sensitiveFlag: true,
        path: claudeDir
      });
    }

    const cursorDir = path.join(homeDir, '.cursor');
    if (await pathExists(cursorDir)) {
      memories.push({
        id: `mem-${counter++}`,
        title: 'Cursor AI Prompt History & Extension State',
        tool: 'Cursor',
        snippet: `Extension state & prompt log index stored at ~/.cursor`,
        size: formatBytes(await getDirectorySize(cursorDir)),
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
app.get('/api/snapshots', async (_req, res) => {
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
    // The UI sends `customDestinationPath`; this handler used to destructure
    // `customTargetDir`, so the destination the user typed was always dropped.
    // Accept both names so older callers keep working.
    const { snapshotId, customDestinationPath, customTargetDir } = req.body;
    const destination = customDestinationPath || customTargetDir;
    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId required' });
    }
    // restoreSnapshot returns the full recovery status — surface all of it so
    // the UI can guide the user (items already in place vs. still in the
    // Recycle Bin / Trash).
    const result = await restoreSnapshot(snapshotId, destination);
    // A partial restore is not a server error — report 200 with the detail so
    // the UI can say exactly what came back and what didn't.
    res.json({
      success: result.success,
      restoredPaths: result.restoredPaths,
      restoredCount: result.restoredPaths.length,
      alreadyInPlace: result.alreadyInPlace,
      alreadyInPlaceCount: result.alreadyInPlace.length,
      failed: result.failed,
      failedCount: result.failed.length,
      recoverableFromTrash: result.recoverableFromTrash,
      error: result.error
    });
    // The restored files are back on disk, so the cached scan is stale.
    cachedScan = null;
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 9: Export AI Project Vault (.zip)
app.post('/api/export-vault', async (req, res) => {
  try {
    const { folderPath, outputZipPath, customZipPath, selectedSoftwareIds, includedAssets } = req.body;
    const cleanPath = folderPath && fs.existsSync(folderPath) ? folderPath : process.cwd();
    const targetZip = outputZipPath || customZipPath;

    const result = await exportProjectVault(cleanPath, targetZip, selectedSoftwareIds || [], includedAssets);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 10: Import AI Project Vault (.zip)
app.post('/api/import-vault', async (req, res) => {
  try {
    const { vaultZipPath, destinationFolder } = req.body;
    if (!vaultZipPath) {
      return res.status(400).json({ error: 'vaultZipPath is required' });
    }
    const result = await importProjectVault(vaultZipPath, destinationFolder);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 11: Scan Installed & Residual AI Software
app.get('/api/software', async (req, res) => {
  try {
    const software = await getDetectedSoftware(req.query.refresh === '1');
    res.json({ software });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 12: Software Uninstall & Safe Cache Purge (Always Creates Safety Snapshot of target software caches)
app.post('/api/purge-software', async (req, res) => {
  try {
    const { softwareId, purgeMode } = req.body;

    const softwareList = await getDetectedSoftware();
    const targetSoftware = softwareList.find(s => s.id === softwareId);

    if (!targetSoftware) {
      return res.status(400).json({ error: `Unknown software id: ${softwareId}` });
    }

    // Snapshot the software's GENUINE detected caches (now populated by the
    // detector) so the pre-purge restore point actually contains something.
    const itemsToSnapshot: AICacheItem[] = targetSoftware.detectedCaches || [];

    // ALWAYS create safety restore point of actual software caches before taking action
    await createSnapshot(itemsToSnapshot, `pre-purge-${softwareId || 'software'}-${Date.now()}`);

    const isWindows = os.platform() === 'win32';
    let message = `Safety Restore Point created successfully!`;

    if (purgeMode === 'FULL_UNINSTALL') {
      if (isWindows) {
        // Launch Windows native uninstaller. `start` is a cmd.exe builtin, so we
        // spawn cmd with discrete args rather than interpolating into a shell string.
        const child = spawn('cmd', ['/c', 'start', '', 'appwiz.cpl'], { shell: false, detached: true, stdio: 'ignore' });
        child.on('error', () => {
          const fallback = spawn('cmd', ['/c', 'start', '', 'ms-settings:appsfeatures'], { shell: false, detached: true, stdio: 'ignore' });
          fallback.on('error', () => { /* best effort */ });
          fallback.unref();
        });
        child.unref();
        message = `Safety Restore Point created! Launched Windows Native Control Panel (appwiz.cpl) to cleanly uninstall software.`;
      } else {
        message = `Safety Restore Point created! Opened native uninstaller.`;
      }
      return res.json({ success: true, message });
    }

    // CACHE_ONLY previously deleted nothing at all while reporting
    // "Successfully cleaned residual caches & downloaded model weights."
    // Now it really cleans — but only the GREEN, auto-rebuilding caches that
    // live under this software's detected paths. The detection paths as a whole
    // include chat databases and session keys, which "Clean Caches Only" must
    // never touch.
    const allItems = await getScannedItems();
    const roots = targetSoftware.detectionPaths.map(p => path.normalize(p).toLowerCase());

    const purgeable = allItems.filter(item => {
      if (item.tier !== 'GREEN' || !item.canDelete) return false;
      const normalized = path.normalize(item.path).toLowerCase();
      return roots.some(root => normalized === root || normalized.startsWith(root + path.sep));
    });

    if (purgeable.length === 0) {
      return res.json({
        success: true,
        cleanedCount: 0,
        reclaimedFormatted: '0 B',
        message:
          `Safety Restore Point created. No auto-rebuilding (GREEN) caches were found for ${targetSoftware.name}, ` +
          `so nothing was deleted. Its remaining data is user content — clean it deliberately from the Drive Footprint tab.`
      });
    }

    const purgeResult = await deleteItemsSafely(purgeable.map(i => i.path));
    const purgedSet = new Set(purgeResult.movedToTrash);
    const reclaimedBytes = purgeable
      .filter(i => purgedSet.has(i.path))
      .reduce((acc, i) => acc + i.sizeBytes, 0);

    cachedScan = null;

    return res.json({
      success: purgeResult.errors.length === 0,
      cleanedCount: purgeResult.movedToTrash.length,
      failedCount: purgeResult.errors.length,
      errors: purgeResult.errors,
      reclaimedBytes,
      reclaimedFormatted: formatBytes(reclaimedBytes),
      message:
        `Safety Restore Point created. Moved ${purgeResult.movedToTrash.length} cache folder(s) ` +
        `(${formatBytes(reclaimedBytes)}) to the Recycle Bin for ${targetSoftware.name}.`
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 13: Automated GitHub Auto-Update Checker Engine with Semver Comparison
app.get('/api/check-update', async (_req, res) => {
  try {
    const currentVersion = `v${APP_VERSION}`;
    // The repo is `AICacheCleaner`. The old lowercase `ai-cache-cleaner` slug
    // 404s, so the updater silently reported "check failed" on every launch.
    const repoUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

    const response = await fetch(repoUrl, {
      headers: {
        'User-Agent': 'AI-Clutter-Cleaner-App'
      }
    });

    if (!response.ok) {
      // Be honest: a non-ok response (rate limit, network error, 404) means the
      // check FAILED, not that we are "already running the latest release".
      return res.json({
        updateAvailable: false,
        currentVersion,
        message: `Update check failed (GitHub API returned ${response.status}). Try again later.`
      });
    }

    interface GithubRelease {
      tag_name?: string;
      body?: string;
      html_url?: string;
      published_at?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    }

    const latestRelease = (await response.json()) as GithubRelease;
    const latestVersion = latestRelease.tag_name || currentVersion;

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
      downloadUrl: latestRelease.html_url || RELEASES_URL,
      publishedAt: latestRelease.published_at,
      assets: latestRelease.assets?.map(a => ({
        name: a.name,
        downloadUrl: a.browser_download_url,
        sizeBytes: a.size
      })) || []
    });
  } catch (e) {
    res.json({
      updateAvailable: false,
      currentVersion: `v${APP_VERSION}`,
      error: (e as Error).message
    });
  }
});

// API 14a: Launch a project's dev server (Localhost) in a new terminal window
app.post('/api/launch-project', async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || typeof folderPath !== 'string') {
      return res.status(400).json({ error: 'folderPath is required' });
    }
    const resolved = path.resolve(folderPath);
    const pkgPath = path.join(resolved, 'package.json');

    // This endpoint runs an arbitrary package.json script, so it must not accept
    // arbitrary paths. Only folders the scanner itself surfaced as runnable
    // projects are eligible — that keeps the feature working from the UI while
    // removing it as a general "execute code in any directory" primitive.
    const scanned = await getScannedItems();
    const isKnownRunnableProject = scanned.some(
      item =>
        item.isRunnableProject === true &&
        path.resolve(item.path).toLowerCase() === resolved.toLowerCase()
    );

    if (!isKnownRunnableProject) {
      return res.status(403).json({
        error:
          'Refused: only projects detected by a scan can be launched. ' +
          'Run a scan and start the project from its row in the Drive Footprint tab.'
      });
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(400).json({ error: `Folder not found: ${resolved}` });
    }
    if (!fs.existsSync(pkgPath)) {
      return res.status(400).json({ error: 'No package.json found in that folder — cannot detect a dev script.' });
    }

    // Pick the script to run: prefer "dev", then "start".
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = (pkg && pkg.scripts) || {};
    const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
    if (!scriptName) {
      return res.status(400).json({ error: 'package.json has no "dev" or "start" script to launch.' });
    }

    const runCmd = `npm run ${scriptName}`;
    const isWindows = os.platform() === 'win32';

    if (isWindows) {
      // Open a new persistent terminal window running the dev server (detached).
      const child = spawn('cmd', ['/c', 'start', '"AI Project Dev Server"', 'cmd', '/k', runCmd], {
        cwd: resolved,
        shell: false,
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', () => { /* best effort */ });
      child.unref();
    } else {
      // macOS: open Terminal and run the command there.
      const script = `cd "${resolved}" && ${runCmd}`;
      const child = spawn('osascript', ['-e', `tell application "Terminal" to do script "${script.replace(/"/g, '\\"')}"`], {
        cwd: resolved,
        shell: false,
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', () => { /* best effort */ });
      child.unref();
    }

    // We can't reliably know the port without parsing Vite/Next config, so we
    // return a port hint for the common defaults rather than a guaranteed URL.
    const portHint = scripts.dev && /next/.test(JSON.stringify(pkg)) ? 3000 : 5173;

    res.json({
      launched: true,
      script: scriptName,
      portHint,
      message: `Launched "npm run ${scriptName}" for ${path.basename(resolved)} in a new terminal window. Dev server starting on ~port ${portHint}.`
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 14a-pre: Projects that have AI data attached, so a user can export ONE
// project (code + every conversation about it) instead of a 22 GB tool folder.
app.get('/api/projects', async (_req, res) => {
  try {
    const scanned = await getScannedItems();
    // Real project paths from the drive scan give us the ground truth needed to
    // decode Claude's lossy directory-name encoding.
    const candidates = scanned.filter(i => i.id.startsWith('secondary-')).map(i => i.path);
    const projects = discoverProjects(candidates).map(p => ({
      ...p,
      totalAiFormatted: formatBytes(p.totalAiBytes),
      sources: p.sources.map(s => ({ ...s, formattedSize: formatBytes(s.sizeBytes) }))
    }));
    // Where an export lands by default, so the UI can show the destination
    // BEFORE the user commits rather than only revealing it afterwards.
    res.json({
      projects,
      unlinkable: UNLINKABLE_TOOLS,
      defaultExportDir: path.join(os.homedir(), 'Desktop')
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 14a-pre2: Everything attached to one specific project path.
app.post('/api/project-sources', async (req, res) => {
  try {
    const { projectPath } = req.body;
    if (!projectPath || typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    // Reject drive-relative input ("D:folder"). path.resolve would silently
    // join it onto the server's working directory and report a nonsense path.
    if (!path.isAbsolute(projectPath)) {
      return res.status(400).json({ error: `Enter a full path, e.g. D:\\projects\\my-app (got "${projectPath}")` });
    }
    const resolved = path.resolve(projectPath);
    const sources = findSourcesForProject(resolved).map(s => ({ ...s, formattedSize: formatBytes(s.sizeBytes) }));
    const projectBytes = fs.existsSync(resolved) ? await getDirectorySize(resolved) : 0;

    res.json({
      projectPath: resolved,
      exists: fs.existsSync(resolved),
      projectBytes,
      projectFormatted: formatBytes(projectBytes),
      sources,
      totalAiBytes: sources.reduce((a, s) => a + s.sizeBytes, 0),
      unlinkable: UNLINKABLE_TOOLS,
      defaultExportDir: path.join(os.homedir(), 'Desktop')
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 14a-pre3: Export ONE project — its code plus every linked AI conversation.
app.post('/api/export-project', async (req, res) => {
  try {
    const { projectPath, outputZipPath, includeCode } = req.body;
    if (!projectPath || typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    if (!path.isAbsolute(projectPath)) {
      return res.status(400).json({ error: `Enter a full path, e.g. D:\\projects\\my-app (got "${projectPath}")` });
    }
    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) {
      return res.status(400).json({ error: `Folder not found: ${resolved}` });
    }

    const sources = findSourcesForProject(resolved);

    // Estimate the total up front so the progress bar has a denominator.
    const codeBytes = includeCode !== false ? await getDirectorySize(resolved) : 0;
    const totalBytes = codeBytes + sources.reduce((a, s) => a + s.sizeBytes, 0);
    beginExport(`Archiving ${path.basename(resolved)}`, totalBytes);

    try {
      const result = await exportSingleProject(resolved, sources, outputZipPath, includeCode !== false);
      finishExport(result.success ? undefined : result.error);
      res.json(result);
    } catch (e) {
      finishExport((e as Error).message);
      throw e;
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 14a-pre4: Live progress for the running export. Archiving multi-GB
// projects takes tens of seconds; without this the UI could only show a static
// "Packaging…" label with no sign of movement.
app.get('/api/export-progress', (_req, res) => {
  res.json(getExportProgress());
});

// API 14b-pre: Which apps can actually take part in a transcript conversion on
// THIS machine. The UI used to hardcode two mismatched lists that included an
// unimplemented option and omitted supported ones.
app.get('/api/transcript-apps', (_req, res) => {
  try {
    res.json({ apps: listAvailableTranscriptApps() });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 14b: Cross-App Chat Transcript Converter (reads REAL local transcripts)
app.post('/api/convert-transcripts', async (req, res) => {
  try {
    const { sourceApp, targetApp } = req.body;
    if (!sourceApp || !targetApp) {
      return res.status(400).json({ error: 'sourceApp and targetApp are required' });
    }
    const result = convertTranscripts(sourceApp, targetApp);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API 14c: Convert Portable App to Native Installed Windows Application
app.post('/api/install-native', async (_req, res) => {
  try {
    const isWindows = os.platform() === 'win32';
    if (!isWindows) {
      return res.json({ success: false, message: 'Native installation is currently supported on Windows.' });
    }

    const localSetupPath = path.join(process.cwd(), 'dist-electron', `AICacheCleaner-Setup-${APP_VERSION}.exe`);

    if (fs.existsSync(localSetupPath)) {
      const child = spawn('cmd', ['/c', 'start', '', localSetupPath], { shell: false, detached: true, stdio: 'ignore' });
      child.on('error', () => { /* best effort */ });
      child.unref();
      return res.json({ success: true, message: 'Launched Windows Native Setup Installer.' });
    }

    // No installer is published for this release (the v1.0.0 Setup asset was
    // removed). Previously this opened a hardcoded release-download URL that
    // 404s, and still reported success. Send the user to the releases page and
    // say plainly that there is nothing to install yet.
    return res.json({
      success: false,
      releasesUrl: RELEASES_URL,
      message:
        'No native installer is bundled with this build, and none is published for this release yet. ' +
        'Build one locally with "npm run build:win-installer", or check the releases page for a future Setup download.'
    });
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
