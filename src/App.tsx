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
import { HardDrive, Cpu, Package, Eye, CheckCircle2, Sparkles, History, ShieldCheck, Settings, Laptop, Bot, LayoutDashboard, Code2 } from 'lucide-react';

// Empty until the real scan loads. We intentionally do NOT seed the UI with
// hardcoded sample items (previous versions shipped the developer's personal
// C:\Users\... paths and fake GB sizes to every new user).
const emptyScanItems: AICacheItem[] = [];

// Treat items modified in the last 30 days as "active/recent".
const RECENT_WINDOW_DAYS = 30;

// Active folders on top (newest first), untouched folders at bottom
const sortItemsByPriority = (raw: AICacheItem[]): AICacheItem[] => {
  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  return [...raw].sort((a, b) => {
    const aTime = Date.parse(a.lastModified);
    const bTime = Date.parse(b.lastModified);
    const aRecent = !Number.isNaN(aTime) && aTime >= recentCutoff;
    const bRecent = !Number.isNaN(bTime) && bTime >= recentCutoff;

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


  const fetchSystemData = async () => {
    try {
      const response = await fetch('http://localhost:3333/api/scan');
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
      console.warn('API offline - using initial scan state');
    }
  };


  useEffect(() => {
    const splashTimer = setTimeout(() => setLoading(false), 400);
    fetchSystemData();
    checkGitHubUpdate();
    return () => clearTimeout(splashTimer);
  }, []);

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
      if (response.ok && data.success) {
        showToast(`Cleaned ${itemIds.length} items! ${createRestorePoint ? 'Restore Point Created' : 'Soft-deleted to Recycle Bin'}`);
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
      if (response.ok && data.success) {
        // Items are soft-deleted to the OS Recycle Bin / Trash; "restoredPaths"
        // lists those already back in place. Any remaining must be recovered from
        // the Recycle Bin / Trash manually (data.error carries that guidance).
        const backInPlace = Array.isArray(data.restoredPaths) ? data.restoredPaths.length : 0;
        if (data.recoverableFromTrash && data.error) {
          showToast(`${backInPlace} item(s) verified in place. Remaining can be restored from your Recycle Bin / Trash.`);
        } else {
          showToast(`Restored snapshot ${snapshotId}! (${backInPlace} item(s) verified in place)`);
        }
        fetchSystemData();
      } else {
        showToast(`Error restoring snapshot: ${data.error || 'Failed'}`);
      }
    } catch (e) {
      showToast(`Failed to restore snapshot: ${(e as Error).message}`);
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '12px',
          boxShadow: '0 8px 25px rgba(16, 185, 129, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontWeight: 600,
          zIndex: 3000,
          fontSize: '0.9rem'
        }}>
          <CheckCircle2 size={18} /> {toastMessage}
        </div>
      )}

      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="glass-card" style={{
        width: '240px',
        minWidth: '240px',
        borderRadius: 0,
        borderRight: '1px solid var(--border-color)',
        borderTop: 'none',
        borderLeft: 'none',
        borderBottom: 'none',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100vh',
        position: 'sticky',
        top: 0
      }}>
        <div>
          {/* Brand Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px', paddingLeft: '4px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 15px rgba(0, 242, 254, 0.4)'
            }}>
              <ShieldCheck size={24} color="#0b0f19" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #ffffff, #9ca3af)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                AICacheCleaner
              </h1>
              <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, letterSpacing: '0.05em' }}>
                v1.0 • 100% FREE FOSS
              </span>
            </div>
          </div>

          {/* Sidebar Menu Items - Concise & Point to Point Naming */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              className={`sidebar-nav-btn ${activeTab === 'DASHBOARD' ? 'active' : ''}`}
              onClick={() => changeTab('DASHBOARD')}
            >
              <LayoutDashboard size={18} color={activeTab === 'DASHBOARD' ? '#ffffff' : '#00f2fe'} />
              <span>Dashboard</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'SAFE_DELETE' ? 'active-green' : ''}`}
              onClick={() => changeTab('SAFE_DELETE')}
            >
              <Sparkles size={18} color={activeTab === 'SAFE_DELETE' ? '#ffffff' : '#34d399'} />
              <span>Safe Delete</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'STORAGE' ? 'active' : ''}`}
              onClick={() => changeTab('STORAGE')}
            >
              <HardDrive size={18} color={activeTab === 'STORAGE' ? '#ffffff' : '#9ca3af'} />
              <span>Drive Footprint</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'SOFTWARE' ? 'active' : ''}`}
              onClick={() => changeTab('SOFTWARE')}
            >
              <Laptop size={18} color={activeTab === 'SOFTWARE' ? '#ffffff' : '#9ca3af'} />
              <span>AI Software</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'AUTOBOTS' ? 'active' : ''}`}
              onClick={() => changeTab('AUTOBOTS')}
            >
              <Bot size={18} color={activeTab === 'AUTOBOTS' ? '#ffffff' : '#c084fc'} />
              <span>Clawbots & Bots</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'HISTORY' ? 'active' : ''}`}
              onClick={() => changeTab('HISTORY')}
            >
              <History size={18} color={activeTab === 'HISTORY' ? '#ffffff' : '#9ca3af'} />
              <span>Restore Points</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'PROCESSES' ? 'active' : ''}`}
              onClick={() => changeTab('PROCESSES')}
            >
              <Cpu size={18} color={activeTab === 'PROCESSES' ? '#ffffff' : '#9ca3af'} />
              <span>Process Inspector</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'MIGRATION' ? 'active' : ''}`}
              onClick={() => changeTab('MIGRATION')}
            >
              <Package size={18} color={activeTab === 'MIGRATION' ? '#ffffff' : '#9ca3af'} />
              <span>PC Migration</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'MEMORY' ? 'active' : ''}`}
              onClick={() => changeTab('MEMORY')}
            >
              <Eye size={18} color={activeTab === 'MEMORY' ? '#ffffff' : '#9ca3af'} />
              <span>Privacy Inspector</span>
            </button>

            <button
              className={`sidebar-nav-btn ${activeTab === 'SETTINGS' ? 'active' : ''}`}
              onClick={() => changeTab('SETTINGS')}
            >
              <Settings size={18} color={activeTab === 'SETTINGS' ? '#ffffff' : '#9ca3af'} />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* BOTTOM LEFT SIDEBAR BRANDING & SAAS DEVELOPMENT CONTACT CTA */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.1) 0%, rgba(157, 78, 221, 0.1) 100%)',
          padding: '12px',
          borderRadius: '12px',
          border: '1px solid rgba(0, 242, 254, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          marginTop: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00f2fe', fontSize: '0.8rem', fontWeight: 800 }}>
            <Code2 size={16} /> Dice Codes
          </div>
          <p style={{ fontSize: '0.72rem', color: '#9ca3af', lineHeight: '1.3' }}>
            Need custom AI software or web apps?
          </p>
          <a
            href="https://dicecodes.com/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.74rem',
              color: '#ffffff',
              background: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
              padding: '6px 10px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              boxShadow: '0 2px 10px rgba(0, 198, 255, 0.3)'
            }}
          >
            Visit DiceCodes.com ↗
          </a>
        </div>
      </aside>

      {/* MAIN CONTENT WORKSPACE */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto', maxHeight: '100vh' }}>
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
            onCleanSelected={requestClean}
            onOpenFolder={handleOpenFolder}
          />
        )}

        {activeTab === 'STORAGE' && (
          <TargetListTable
            items={items}
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
          />
        )}

        {activeTab === 'PROCESSES' && (
          <ProcessInspector
            processes={processes}
            onKillProcess={handleKillProcess}
          />
        )}

        {activeTab === 'MIGRATION' && (
          <MigrationWizard
            onOpenFolder={handleOpenFolder}
          />
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
        onConfirm={handleConfirmClean}
        onCancel={() => setIsPreDeleteModalOpen(false)}
      />
    </div>
  );
};

export default App;

