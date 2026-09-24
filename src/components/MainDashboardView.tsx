import React, { useState } from 'react';
import type { SystemMetrics, AICacheItem } from '../types';
import { RefreshCw, FolderOpen, Rocket, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { FootprintStrip } from './FootprintStrip';
import { openItemMenu } from '../lib/itemMenu';
import '../lib/tokens.css';

interface MainDashboardViewProps {
  metrics: SystemMetrics | null;
  items: AICacheItem[];
  loading: boolean;
  onRefresh: () => void;
  onCleanSelected: (ids: string[]) => void;
  onExportVault: () => void;
  onOpenFolder: (path: string) => void;
  onNavigateTab: (tab: 'DASHBOARD' | 'SAFE_DELETE' | 'STORAGE' | 'SOFTWARE' | 'AUTOBOTS' | 'PROCESSES' | 'MIGRATION' | 'MEMORY' | 'HISTORY' | 'SETTINGS') => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`;
}

/** One measurement. Label above, value below, no box, no border, no glow. */
const Reading: React.FC<{ label: string; value: string; tone?: 'safe' | 'review' | 'default' }> = ({
  label,
  value,
  tone = 'default'
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '120px' }}>
    <span className="ins-label">{label}</span>
    <span
      className="ins-data"
      style={{
        fontSize: '1.125rem',
        fontWeight: 500,
        color:
          tone === 'safe' ? 'var(--ins-safe)' : tone === 'review' ? 'var(--ins-review)' : 'var(--ins-mist-50)'
      }}
    >
      {value}
    </span>
  </div>
);

export const MainDashboardView: React.FC<MainDashboardViewProps> = ({
  metrics,
  items,
  loading,
  onRefresh,
  onCleanSelected,
  onOpenFolder,
  onNavigateTab
}) => {
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ success: boolean; text: string } | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const handleLaunchLocalhost = async (folderPath: string) => {
    setLaunchingPath(folderPath);
    setLaunchMsg(null);
    try {
      const response = await fetch('http://127.0.0.1:3333/api/launch-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `Server returned ${response.status}`);
      if (data.url) window.open(data.url, '_blank');
      setLaunchMsg({ success: true, text: data.message || 'Dev server starting in a new terminal window.' });
    } catch (e) {
      setLaunchMsg({ success: false, text: `Could not launch project: ${(e as Error).message}` });
    } finally {
      setTimeout(() => setLaunchingPath(null), 2000);
      setTimeout(() => setLaunchMsg(null), 6000);
    }
  };

  const safeItems = items.filter(i => i.tier === 'GREEN' && i.canDelete);
  // Shown only past 1 GB: small gaps are ext4 overhead, not worth a compact.
  const dockerDisk = items.find(i => i.id === 'docker-wsl-disk' && (i.trappedBytes ?? 0) > 1024 ** 3);

  const visible = category ? items.filter(i => i.category === category) : items;
  const largest = [...visible].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 8);

  return (
    <div className="ins-page">
      {/* Header: identity left, the one primary action right. */}
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Storage overview</h1>
          <p className="ins-sub">
            {metrics
              ? `Last scanned ${new Date(metrics.lastScanTimestamp).toLocaleTimeString()} · runs only when you ask`
              : 'Not scanned yet'}
          </p>
        </div>

        <div className="ins-toolbar">
          <button className="ins-btn" onClick={onRefresh} disabled={loading} title="Rescan (Ctrl+R)">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            {loading ? 'Scanning' : 'Rescan'}
          </button>
          <button
            className="ins-btn ins-btn--primary"
            disabled={safeItems.length === 0}
            onClick={() => onCleanSelected(safeItems.map(i => i.id))}
            title={safeItems.length === 0 ? 'Nothing safe to reclaim' : undefined}
          >
            Reclaim {formatBytes(metrics?.reclaimableBytes ?? 0)}
          </button>
        </div>
      </header>

      {launchMsg && (
        <div
          className="ins-panel"
          style={{
            padding: 'var(--ins-space-3) var(--ins-space-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ins-space-2)',
            fontSize: '0.8125rem',
            color: launchMsg.success ? 'var(--ins-safe)' : 'var(--ins-locked)',
            borderColor: launchMsg.success ? 'rgba(63,185,138,0.35)' : 'rgba(217,106,106,0.35)'
          }}
        >
          {launchMsg.success ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {launchMsg.text}
        </div>
      )}

      {/* Signature element */}
      <FootprintStrip
        items={items}
        totalBytes={metrics?.totalAICacheBytes ?? 0}
        reclaimableBytes={metrics?.reclaimableBytes ?? 0}
        selectedCategory={category}
        onSelectCategory={setCategory}
      />

      {/* Secondary readings. A quiet row, not four glowing cards. */}
      <div
        className="ins-panel"
        style={{ padding: 'var(--ins-space-4) var(--ins-space-5)', display: 'flex', gap: 'var(--ins-space-6)', flexWrap: 'wrap' }}
      >
        <Reading label="Safe to reclaim" value={formatBytes(metrics?.reclaimableBytes ?? 0)} tone="safe" />
        <Reading label="Needs review" value={formatBytes(Math.max(0, (metrics?.totalAICacheBytes ?? 0) - (metrics?.reclaimableBytes ?? 0)))} tone="review" />
        <Reading label="Tracked locations" value={String(metrics?.itemCount ?? 0)} />
        <Reading label="AI processes" value={String(metrics?.activeProcessCount ?? 0)} />
        <Reading label="Memory in use" value={metrics ? `${(metrics.totalAIRAMMb / 1024).toFixed(2)} GB` : '—'} />
      </div>

      {/* The Docker disk file never shrinks, so its biggest saving is invisible
          in any size column. Surface it; nothing here deletes data. */}
      {dockerDisk && (
        <div className="ins-note ins-note--warn" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            Docker&apos;s disk file is {formatBytes(dockerDisk.sizeBytes)} but stores only{' '}
            {formatBytes(dockerDisk.sizeBytes - (dockerDisk.trappedBytes ?? 0))}. About{' '}
            <strong>{formatBytes(dockerDisk.trappedBytes ?? 0)}</strong> of empty space can be given back to Windows by
            compacting it — your images, containers and volumes are kept.
          </span>
          <button className="ins-btn" onClick={() => onNavigateTab('SAFE_DELETE')}>
            Show me how
          </button>
        </div>
      )}

      {/* Dense table */}
      <div className="ins-panel" style={{ padding: 'var(--ins-space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--ins-space-4)' }}>
          <span className="ins-label">
            Largest locations{category ? ` · ${category}` : ''}
          </span>
          {category && (
            <button className="ins-btn ins-btn--quiet" onClick={() => setCategory(null)} style={{ fontSize: '0.75rem' }}>
              Clear filter
            </button>
          )}
        </div>

        <table className="ins-table">
          <thead>
            <tr>
              <th>Location</th>
              <th style={{ width: '150px' }}>Safety</th>
              <th style={{ width: '110px' }} className="ins-num">Size</th>
              <th style={{ width: '150px' }} />
            </tr>
          </thead>
          <tbody>
            {largest.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 'var(--ins-space-6)', textAlign: 'center', color: 'var(--ins-mist-500)' }}>
                  {loading ? 'Scanning drives…' : 'Nothing detected yet. Run a scan to populate this view.'}
                </td>
              </tr>
            )}

            {largest.map(item => (
              <tr
                key={item.id}
                onDoubleClick={() => onOpenFolder(item.path)}
                onContextMenu={e => void openItemMenu(e, item, { onOpenFolder, onDelete: id => onCleanSelected([id]) })}
              >
                <td>
                  <div style={{ color: 'var(--ins-mist-50)', marginBottom: '1px' }}>{item.name}</div>
                  <button className="ins-path" onClick={() => onOpenFolder(item.path)} title={item.path}>
                    {item.path}
                  </button>
                </td>
                <td>
                  {item.tier === 'GREEN' && <span className="ins-tier ins-tier--safe">Rebuilds itself</span>}
                  {item.tier === 'YELLOW' && <span className="ins-tier ins-tier--review">Your data</span>}
                  {item.tier === 'RED' && <span className="ins-tier ins-tier--locked">Protected</span>}
                </td>
                <td className="ins-num ins-data" style={{ fontSize: '0.8125rem' }}>{item.formattedSize}</td>
                <td>
                  <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                    {item.isRunnableProject && (
                      <button
                        className="ins-btn ins-btn--quiet"
                        onClick={() => handleLaunchLocalhost(item.path)}
                        disabled={launchingPath === item.path}
                        style={{ fontSize: '0.75rem' }}
                      >
                        <Rocket size={12} /> Run
                      </button>
                    )}
                    <button
                      className="ins-btn ins-btn--quiet"
                      onClick={() => onOpenFolder(item.path)}
                      style={{ fontSize: '0.75rem' }}
                    >
                      <FolderOpen size={12} /> Open
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
