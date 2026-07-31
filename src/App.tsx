import React, { useEffect, useState } from 'react';
import type { AICacheItem, AIProcessItem, SystemMetrics, SnapshotItem } from './types';
import { MainDashboardView } from './components/MainDashboardView';
import { TargetListTable } from './components/TargetListTable';
import { SafeDeleteSection } from './components/SafeDeleteSection';
import { ProcessInspector } from './components/ProcessInspector';
import { AISoftwareTab } from './components/AISoftwareTab';
import { AutoBotsTab } from './components/AutoBotsTab';
import { MigrationWizard } from './components/MigrationWizard';
import { MemoryInspector } from './components/MemoryInspector';
import { HistoryTab } from './components/HistoryTab';
import { SettingsTab } from './components/SettingsTab';
import { PreDeleteModal } from './components/PreDeleteModal';
import { isRecentlyModified } from './lib/itemFilters';
import { HardDrive, Cpu, Package, Eye, CheckCircle2, Sparkles, History, ShieldCheck, Settings, Laptop, Bot, LayoutDashboard, Code2, AlertTriangle } from 'lucide-react';

// Empty until the real scan loads. We intentionally do NOT seed the UI with
// hardcoded sample items (previous versions shipped the developer's personal
// C:\Users\... paths and fake GB sizes to every new user).
const emptyScanItems: AICacheItem[] = [];

// Active folders on top (newest first), untouched folders at bottom
const sortItemsByPriority = (raw: AICacheItem[]): AICacheItem[] => {
  return [...raw].sort((a, b) => {
    const aTime = Date.parse(a.lastModified);
    const bTime = Date.parse(b.lastModified);
    const aRecent = isRecentlyModified(a.lastModified);
    const bRecent = isRecentlyModified(b.lastModified);

    if (aRecent && !bRecent) return -1;
    if (!aRecent && bRecent) return 1;

    // Secondary sort: Newest modified date first (NaN sorts to the bottom)
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });
};

type TabType = 'DASHBOARD' | 'SAFE_DELETE' | 'STORAGE' | 'SOFTWARE' | 'AUTOBOTS' | 'PROCESSES' | 'MIGRATION' | 'MEMORY' | 'HISTORY' | 'SETTINGS';

const getInitialTab = (): TabType => {
  const hash = window.location.hash.replace('#', '').toUpperCase() as TabType;
  const validTabs: TabType[] = ['DASHBOARD', 'SAFE_DELETE', 'STORAGE', 'SOFTWARE', 'AUTOBOTS', 'PROCESSES', 'MIGRATION', 'MEMORY', 'HISTORY', 'SETTINGS'];
  if (validTabs.includes(hash)) return hash;

  const saved = localStorage.getItem('ai_hygiene_active_tab') as TabType;
  if (validTabs.includes(saved)) return saved;

  return 'DASHBOARD';
};
// No fake process/metrics seed data. Until the real scan loads, the UI shows
// a loading state instead of fabricated PIDs and GB counts.
const emptyProcesses: AIProcessItem[] = [];

export const App: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [items, setItems] = useState<AICacheItem[]>(emptyScanItems);
  const [processes, setProcesses] = useState<AIProcessItem[]>(emptyProcesses);
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    updateAvailable: boolean;
    latestVersion?: string;
    currentVersion?: string;
    downloadUrl?: string;
    releaseNotes?: string;
  } | null>(null);

  const changeTab = (tab: TabType) => {
    setActiveTab(tab);
    localStorage.setItem('ai_hygiene_active_tab', tab);
    window.location.hash = tab.toLowerCase();
  };

  const checkGitHubUpdate = async () => {
    try {
      const res = await fetch('http://localhost:3333/api/check-update');
      const data = await res.json();
      setUpdateInfo(data);
    } catch (e) {
      console.log('Update check skipped offline');
    }
  };


  // Pre-deletion modal state
  const [pendingCleanItems, setPendingCleanItems] = useState<AICacheItem[]>([]);
  const [isPreDeleteModalOpen, setIsPreDeleteModalOpen] = useState<boolean>(false);

  // Saved preferences. These were previously written to config.json and read by
  // nothing; the threshold alert and restore-point default now depend on them.
  const [appConfig, setAppConfig] = useState<{
    cacheThresholdGb: number;
    restorePointPolicy: 'PROMPT' | 'ALWAYS' | 'NEVER';
    customRestorePath: string;
  } | null>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/config');
      if (res.ok) setAppConfig(await res.json());
    } catch (e) {
      console.warn('Could not load saved preferences:', (e as Error).message);
    }
  };


  const fetchSystemData = async () => {
    setScanError(null);
    try {
      const response = await fetch('http://localhost:3333/api/scan');
      if (!response.ok) throw new Error(`Scan API returned ${response.status}`);
      const data = await response.json();

      // Show only real scan results. Do not merge in any hardcoded sample data.
      const sorted = sortItemsByPriority(data.items || []);

      setMetrics(data.metrics);
      setItems(sorted);
      setProcesses(data.processes || []);

      const snapRes = await fetch('http://localhost:3333/api/snapshots');
      const snapData = await snapRes.json();
      setSnapshots(snapData.snapshots || []);
    } catch (e) {
      // Surface the failure honestly instead of silently falling back to empty.
      setScanError(`Could not reach the local engine: ${(e as Error).message}. Make sure the backend is running on port 3333.`);
    } finally {
      // Loading ends when the fetch resolves/rejects — not on a fixed timer.
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchSystemData();
    checkGitHubUpdate();
    fetchConfig();
  }, []);

  // Threshold alert: fires when the measured AI footprint exceeds the GB limit
  // saved in Settings.
  const thresholdGb = appConfig?.cacheThresholdGb ?? 0;
  const totalGb = metrics ? metrics.totalAICacheBytes / (1024 * 1024 * 1024) : 0;
  const overThreshold = thresholdGb > 0 && totalGb > thresholdGb;

  const requestClean = (selectedIds: string[]) => {
    const targetItems = items.filter(i => selectedIds.includes(i.id));
    setPendingCleanItems(targetItems);
    setIsPreDeleteModalOpen(true);
  };

  const handleConfirmClean = async (createRestorePoint: boolean) => {
    setIsPreDeleteModalOpen(false);
    setCleaning(true);
    const itemIds = pendingCleanItems.map(i => i.id);
    const targetPaths = pendingCleanItems.map(i => i.path);

    try {
      const response = await fetch('http://127.0.0.1:3333/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, targetPaths, createRestorePoint })
      });
      const data = await response.json();
      if (response.ok && typeof data.cleanedCount === 'number') {
        // Report what actually happened, not what was requested. Previously the
        // toast always claimed the requested count, so a run that deleted
        // nothing still said "Cleaned N items!".
        const parts = [`Cleaned ${data.cleanedCount} of ${data.requestedCount ?? itemIds.length} items`];
        if (data.reclaimedFormatted) parts.push(`freed ${data.reclaimedFormatted}`);
        if (data.skippedCount) parts.push(`${data.skippedCount} skipped (already gone)`);
        if (data.failedCount) parts.push(`${data.failedCount} failed`);
        parts.push(createRestorePoint ? 'restore point created' : 'soft-deleted to Recycle Bin');
        showToast(parts.join(' • '));

        if (Array.isArray(data.errors) && data.errors.length > 0) {
          console.error('[Clean] failures:', data.errors);
        }
        // Refresh even on partial failure — some items really were removed.
        fetchSystemData();
      } else {
        showToast(`Error: ${data.error || 'Failed to clean items.'}`);
      }
    } catch (e) {
      showToast(`Network / API error: ${(e as Error).message}`);
    } finally {
      setCleaning(false);
      setPendingCleanItems([]);
    }
  };

  const handleOpenFolder = async (folderPath: string) => {
    try {
      await fetch('http://127.0.0.1:3333/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
    } catch (e) {
      console.warn('API offline - cannot launch Explorer');
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string, customDestinationPath?: string) => {
    try {
      const response = await fetch('http://127.0.0.1:3333/api/snapshots/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, customDestinationPath })
      });
      const data = await response.json();

      if (!response.ok) {
        showToast(`Could not restore: ${data.error || `server returned ${response.status}`}`);
        return;
      }

      // Report what actually moved. Restore now really pulls files back out of
      // the Recycle Bin, so these counts describe real filesystem changes.
      const parts: string[] = [];
      if (data.restoredCount) parts.push(`Restored ${data.restoredCount} item(s)`);
      if (data.alreadyInPlaceCount) parts.push(`${data.alreadyInPlaceCount} already in place`);
      if (data.failedCount) parts.push(`${data.failedCount} could not be recovered`);
      showToast(parts.length ? parts.join(' • ') : 'Nothing needed restoring.');

      if (Array.isArray(data.failed) && data.failed.length > 0) {
        console.warn('[Restore] failures:', data.failed);
      }
      fetchSystemData();
    } catch (e) {
      showToast(`Could not restore: ${(e as Error).message}`);
    }
  };

  const handleKillProcess = async (pid: number) => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/processes/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Terminated process (PID: ${pid})`);
        setProcesses(prev => prev.filter(p => p.pid !== pid));
      } else {
        showToast(`Failed to terminate process ${pid}`);
      }
    } catch (e) {
      showToast(`Error terminating process: ${(e as Error).message}`);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Navigation grouped by intent. Ten flat items gave every destination equal
  // weight and no sense of what the app is for.
  const navGroups: { label: string; items: { tab: TabType; icon: React.ReactNode; text: string }[] }[] = [
    {
      label: 'Overview',
      items: [{ tab: 'DASHBOARD', icon: <LayoutDashboard size={15} />, text: 'Storage overview' }]
    },
    {
      label: 'Reclaim',
      items: [
        { tab: 'SAFE_DELETE', icon: <Sparkles size={15} />, text: 'Safe to delete' },
        { tab: 'STORAGE', icon: <HardDrive size={15} />, text: 'All locations' },
        { tab: 'SOFTWARE', icon: <Laptop size={15} />, text: 'Installed AI tools' },
        { tab: 'AUTOBOTS', icon: <Bot size={15} />, text: 'Agents & crawlers' }
      ]
    },
    {
      label: 'Inspect',
      items: [
        { tab: 'PROCESSES', icon: <Cpu size={15} />, text: 'Running processes' },
        { tab: 'MEMORY', icon: <Eye size={15} />, text: 'Stored transcripts' }
      ]
    },
    {
      label: 'Recover & move',
      items: [
        { tab: 'HISTORY', icon: <History size={15} />, text: 'Restore points' },
        { tab: 'MIGRATION', icon: <Package size={15} />, text: 'Export & migrate' }
      ]
    },
    {
      label: 'Configure',
      items: [{ tab: 'SETTINGS', icon: <Settings size={15} />, text: 'Settings' }]
    }
  ];

  return (
    <div className="ins-scope" style={{ display: 'flex', minHeight: '100vh', background: 'var(--ins-graphite-900)' }}>
      {/* Toast */}
      {toastMessage && (
        <div
          className="ins-note ins-note--ok"
          role="status"
          style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 3000, background: 'var(--ins-graphite-800)', borderColor: 'rgba(63,185,138,0.4)' }}
        >
          <CheckCircle2 size={15} /> {toastMessage}
        </div>
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: '224px',
          minWidth: '224px',
          borderRight: '1px solid var(--ins-graphite-700)',
          background: 'var(--ins-graphite-850)',
          padding: 'var(--ins-space-5) var(--ins-space-3)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflowY: 'auto'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '0 10px', marginBottom: 'var(--ins-space-6)' }}>
          <ShieldCheck size={18} style={{ color: 'var(--ins-mist-300)' }} />
          <div>
            <div style={{ fontFamily: 'var(--ins-font-label)', fontSize: '0.9375rem', fontWeight: 600, letterSpacing: '-0.01em' }}>
              AICacheCleaner
            </div>
            <div className="ins-data" style={{ fontSize: '0.6875rem', color: 'var(--ins-mist-500)' }}>v1.1.0</div>
          </div>
        </div>

        <nav style={{ flex: 1 }}>
          {navGroups.map(group => (
            <div key={group.label} className="ins-nav-group">
              <span className="ins-label">{group.label}</span>
              {group.items.map(item => (
                <button
                  key={item.tab}
                  className={activeTab === item.tab ? 'ins-nav-btn is-active' : 'ins-nav-btn'}
                  onClick={() => changeTab(item.tab)}
                  aria-current={activeTab === item.tab ? 'page' : undefined}
                >
                  {item.icon}
                  <span>{item.text}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <a
          href="https://dicecodes.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="ins-meta"
          style={{ padding: '10px', marginTop: 'var(--ins-space-5)', borderTop: '1px solid var(--ins-graphite-700)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ins-mist-500)' }}
        >
          <Code2 size={13} /> Built by Dice Codes
        </a>
      </aside>

      {/* Main workspace. min-width:0 is what stops grid children from forcing
          the column wider than the viewport and clipping the rightmost card. */}
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--ins-space-6)', overflowY: 'auto', overflowX: 'hidden', maxHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-4)' }}>
        {scanError && (
          <div className="ins-note ins-note--error">
            <AlertTriangle size={15} />
            <span>{scanError}</span>
            <button className="ins-btn ins-btn--quiet" onClick={fetchSystemData} style={{ marginLeft: 'auto' }}>
              Try again
            </button>
          </div>
        )}

        {overThreshold && (
          <div className="ins-note ins-note--warn">
            <AlertTriangle size={15} />
            <span>
              AI storage is <strong className="ins-data">{totalGb.toFixed(1)} GB</strong>, above your {thresholdGb} GB alert threshold.
            </span>
            <button className="ins-btn ins-btn--quiet" onClick={() => changeTab('SAFE_DELETE')} style={{ marginLeft: 'auto' }}>
              Review safe caches
            </button>
          </div>
        )}

        {activeTab === 'DASHBOARD' && (
          <MainDashboardView
            metrics={metrics}
            items={items}
            loading={loading}
            onRefresh={fetchSystemData}
            onCleanSelected={requestClean}
            onExportVault={() => changeTab('MIGRATION')}
            onOpenFolder={handleOpenFolder}
            onNavigateTab={(tab) => changeTab(tab)}
          />
        )}

        {activeTab === 'SAFE_DELETE' && (
          <SafeDeleteSection
            items={items}
            cleaning={cleaning}
            loading={loading}
            onCleanSelected={requestClean}
            onOpenFolder={handleOpenFolder}
          />
        )}

        {activeTab === 'STORAGE' && (
          <TargetListTable
            items={items}
            cleaning={cleaning}
            loading={loading}
            onCleanSelected={requestClean}
            onOpenFolder={handleOpenFolder}
          />
        )}

        {activeTab === 'SOFTWARE' && (
          <AISoftwareTab
            processes={processes}
            onKillProcess={handleKillProcess}
          />
        )}

        {activeTab === 'AUTOBOTS' && (
          <AutoBotsTab
            processes={processes}
            onKillBot={handleKillProcess}
          />
        )}

        {activeTab === 'HISTORY' && (
          <HistoryTab
            snapshots={snapshots}
            onRestore={handleRestoreSnapshot}
            onOpenFolder={handleOpenFolder}
            defaultRestorePath={appConfig?.customRestorePath}
          />
        )}

        {activeTab === 'PROCESSES' && (
          <ProcessInspector
            processes={processes}
            onKillProcess={handleKillProcess}
            loading={loading}
          />
        )}

        {activeTab === 'MIGRATION' && (
          <MigrationWizard />
        )}

        {activeTab === 'MEMORY' && (
          <MemoryInspector />
        )}

        {activeTab === 'SETTINGS' && (
          <SettingsTab updateInfo={updateInfo} onCheckUpdate={checkGitHubUpdate} />
        )}
      </main>

      {/* PRE-DELETION SAFETY CHECKLIST MODAL */}
      <PreDeleteModal
        isOpen={isPreDeleteModalOpen}
        itemsToClean={pendingCleanItems}
        restorePointPolicy={appConfig?.restorePointPolicy}
        onConfirmClean={handleConfirmClean}
        onCancel={() => setIsPreDeleteModalOpen(false)}
      />
    </div>
  );
};

export default App;

