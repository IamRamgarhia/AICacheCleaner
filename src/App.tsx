import React, { useEffect, useRef, useState } from 'react';
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
import { TitleBar } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { DiskExplorer } from './components/DiskExplorer';
import { FirstRunTour } from './components/FirstRunTour';
import { DockerWslTab } from './components/DockerWslTab';
import { DuplicateModelsTab } from './components/DuplicateModelsTab';
import { ProjectClutterTab } from './components/ProjectClutterTab';
import { alertDialog, confirmDialog, onAppCommand } from './lib/native';
import { useReclaimReminder } from './lib/useReclaimReminder';
import { useGrowthAlert } from './lib/useGrowthAlert';
import { McpServersTab } from './components/McpServersTab';
import { isRecentlyModified } from './lib/itemFilters';
import { HardDrive, Cpu, Package, Eye, CheckCircle2, Sparkles, History, Settings, Laptop, Bot, LayoutDashboard, Code2, FolderTree, Container, Copy, FolderX, Plug } from 'lucide-react';

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

type TabType = 'DASHBOARD' | 'SAFE_DELETE' | 'STORAGE' | 'EXPLORER' | 'SOFTWARE' | 'AUTOBOTS' | 'PROCESSES' | 'MIGRATION' | 'MEMORY' | 'HISTORY' | 'SETTINGS'
  | 'DOCKER_WSL' | 'DUPLICATES' | 'CLUTTER' | 'MCP';

// Order here is the Ctrl+1…9 shortcut order.
const PAGE_TITLES: Record<TabType, string> = {
  DASHBOARD: 'Storage overview',
  SAFE_DELETE: 'Safe to delete',
  STORAGE: 'All locations',
  EXPLORER: 'Disk explorer',
  SOFTWARE: 'Installed AI tools',
  AUTOBOTS: 'Agents & crawlers',
  PROCESSES: 'Running processes',
  MEMORY: 'Stored transcripts',
  HISTORY: 'Restore points',
  MIGRATION: 'Export & migrate',
  SETTINGS: 'Settings',
  DOCKER_WSL: 'Docker & WSL',
  DUPLICATES: 'Duplicate models',
  CLUTTER: 'Old project clutter',
  MCP: 'MCP servers'
};

const getInitialTab = (): TabType => {
  const hash = window.location.hash.replace('#', '').toUpperCase() as TabType;
  const validTabs = Object.keys(PAGE_TITLES) as TabType[];
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
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    updateAvailable: boolean;
    latestVersion?: string;
    currentVersion?: string;
    downloadUrl?: string;
    releaseNotes?: string;
    assets?: { name: string; downloadUrl: string; sizeBytes: number; digest?: string }[];
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
    reminderEnabled?: boolean;
    reminderGb?: number;
    thresholdNotify?: boolean;
  } | null>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/config');
      if (res.ok) setAppConfig(await res.json());
    } catch (e) {
      console.warn('Could not load saved preferences:', (e as Error).message);
    }
  };


  // refresh=true forces a new walk; otherwise the server may answer from its
  // cached scan, which is what page loads and tab switches want.
  const fetchSystemData = async (refresh = false) => {
    setScanError(null);
    if (refresh) setLoading(true);
    try {
      const response = await fetch(`http://localhost:3333/api/scan${refresh ? '?refresh=1' : ''}`);
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

  // Tray "Rescan now".
  useEffect(() => onAppCommand(cmd => { if (cmd === 'rescan') void fetchSystemData(true); }), []);

  // Desktop keyboard shortcuts. Ctrl+R/F5 rescan instead of reloading the page.
  useEffect(() => {
    const order = Object.keys(PAGE_TITLES) as TabType[];
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if ((ctrl && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault();
        void fetchSystemData(true);
      } else if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (ctrl && /^[1-9]$/.test(e.key)) {
        const tab = order[Number(e.key) - 1];
        if (tab) { e.preventDefault(); changeTab(tab); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onQueryChange = (q: string) => {
    setQuery(q);
    // Searching is about locations; jump to the list that can show matches.
    if (q && activeTab !== 'STORAGE') changeTab('STORAGE');
  };

  // Threshold alert: fires when the measured AI footprint exceeds the GB limit
  // saved in Settings.
  const thresholdGb = appConfig?.cacheThresholdGb ?? 0;
  const totalGb = metrics ? metrics.totalAICacheBytes / (1024 * 1024 * 1024) : 0;
  const overThreshold = thresholdGb > 0 && totalGb > thresholdGb;

  useReclaimReminder(appConfig, metrics);
  useGrowthAlert(appConfig?.thresholdNotify ? { growthAlertGb: appConfig.cacheThresholdGb } : null, metrics);

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
      } else if (response.status === 403 || response.status === 409) {
        // A refusal explains why nothing was deleted; too long for a toast.
        await alertDialog('Nothing was deleted', data.error, 'error');
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
    const proc = processes.find(p => p.pid === pid);
    const label = proc ? `${proc.tool} (${proc.name}, PID ${pid})` : `PID ${pid}`;
    // Stopping a process loses its unsaved work, so every stop is confirmed.
    const ok = await confirmDialog({
      title: 'Stop process',
      message: `Stop ${label}?`,
      detail: 'Any unsaved work in it will be lost.',
      confirmLabel: 'Stop process',
      danger: true
    });
    if (!ok) return;
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
        { tab: 'EXPLORER', icon: <FolderTree size={15} />, text: 'Disk explorer' },
        { tab: 'DOCKER_WSL', icon: <Container size={15} />, text: 'Docker & WSL' },
        { tab: 'DUPLICATES', icon: <Copy size={15} />, text: 'Duplicate models' },
        { tab: 'CLUTTER', icon: <FolderX size={15} />, text: 'Old project clutter' }
      ]
    },
    {
      label: 'Software',
      items: [
        { tab: 'SOFTWARE', icon: <Laptop size={15} />, text: 'Installed AI tools' },
        { tab: 'AUTOBOTS', icon: <Bot size={15} />, text: 'Agents & crawlers' }
      ]
    },
    {
      label: 'Inspect',
      items: [
        { tab: 'PROCESSES', icon: <Cpu size={15} />, text: 'Running processes' },
        { tab: 'MCP', icon: <Plug size={15} />, text: 'MCP servers' },
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
    <div className="ins-scope ins-shell">
      <TitleBar pageTitle={PAGE_TITLES[activeTab]} query={query} onQueryChange={onQueryChange} searchRef={searchRef} />

      {toastMessage && (
        <div className="ins-toast" role="status">
          <CheckCircle2 size={15} /> {toastMessage}
        </div>
      )}

      <div className="ins-shell-body">
        <aside className="ins-sidebar">
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

          <a href="https://dicecodes.com/" target="_blank" rel="noopener noreferrer" className="ins-meta ins-sidebar-foot">
            <Code2 size={13} /> Built by Dice Codes
          </a>
        </aside>

        <main className="ins-main">
        {activeTab === 'DASHBOARD' && (
          <MainDashboardView
            metrics={metrics}
            items={items}
            loading={loading}
            onRefresh={() => fetchSystemData(true)}
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
            query={query}
          />
        )}

        {activeTab === 'EXPLORER' && (
          <DiskExplorer onOpenFolder={handleOpenFolder} />
        )}

        {activeTab === 'SOFTWARE' && (
          <AISoftwareTab
            processes={processes}
            onKillProcess={handleKillProcess}
            onOpenFolder={handleOpenFolder}
            onNavigate={tab => changeTab(tab as TabType)}
          />
        )}

        {activeTab === 'AUTOBOTS' && (
          <AutoBotsTab
            onKillBot={handleKillProcess}
            onOpenFolder={handleOpenFolder}
            onNavigate={tab => changeTab(tab as TabType)}
          />
        )}

        {activeTab === 'DOCKER_WSL' && <DockerWslTab onOpenFolder={handleOpenFolder} />}
        {activeTab === 'DUPLICATES' && <DuplicateModelsTab onOpenFolder={handleOpenFolder} />}
        {activeTab === 'CLUTTER' && <ProjectClutterTab onOpenFolder={handleOpenFolder} />}
        {activeTab === 'MCP' && <McpServersTab onOpenFolder={handleOpenFolder} />}

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
          <SettingsTab updateInfo={updateInfo} onCheckUpdate={checkGitHubUpdate} onSaved={fetchConfig} />
        )}
        </main>
      </div>

      <StatusBar
        engineError={scanError}
        onRetry={() => fetchSystemData(true)}
        threshold={overThreshold ? { totalGb, limitGb: thresholdGb } : null}
        onThresholdClick={() => changeTab('SAFE_DELETE')}
        update={updateInfo?.updateAvailable ? updateInfo : null}
        onUpdateClick={() => changeTab('SETTINGS')}
      />

      <FirstRunTour onNavigate={tab => changeTab(tab as TabType)} />

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

