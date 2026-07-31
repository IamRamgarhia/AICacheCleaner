import React, { useState } from 'react';
import type { AICacheItem } from '../types';
import { FolderOpen, Info, Rocket, Trash2, X } from 'lucide-react';
import { JUNK_EXTENSIONS, RECENT_WINDOW_DAYS, isRecentlyModified } from '../lib/itemFilters';
import { toolColor } from '../lib/toolColors';

interface TargetListTableProps {
  items: AICacheItem[];
  onCleanSelected: (selectedIds: string[]) => void;
  cleaning?: boolean;
  onOpenFolder?: (path: string) => void;
  loading?: boolean;
}

type Filter = 'ALL' | 'SAFE' | 'REVIEW' | 'ACTIVE' | 'STALE' | 'LARGE';
type SortBy = 'SIZE' | 'RECENT' | 'OLDEST' | 'NAME';

export const TargetListTable: React.FC<TargetListTableProps> = ({ items, onCleanSelected, cleaning, onOpenFolder, loading }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sortBy, setSortBy] = useState<SortBy>('SIZE');
  const [detail, setDetail] = useState<AICacheItem | null>(null);
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const openFolder = async (folderPath: string) => {
    if (onOpenFolder) return onOpenFolder(folderPath);
    try {
      await fetch('http://127.0.0.1:3333/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
    } catch (e) {
      console.warn('Could not open folder:', (e as Error).message);
    }
  };

  const launchProject = async (folderPath: string) => {
    setLaunchingPath(folderPath);
    setLaunchMsg(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/launch-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server returned ${res.status}`);
      if (data.url) window.open(data.url, '_blank');
      setLaunchMsg({ ok: true, text: data.message || 'Dev server starting in a new terminal window.' });
    } catch (e) {
      setLaunchMsg({ ok: false, text: `Could not start it: ${(e as Error).message}` });
    } finally {
      setTimeout(() => setLaunchingPath(null), 2000);
      setTimeout(() => setLaunchMsg(null), 6000);
    }
  };

  // Downloaded media folders are not AI storage. Matched on real extensions —
  // a substring test used to reject paths merely containing ".ai".
  const isJunk = (item: AICacheItem) => {
    const n = item.name.toLowerCase();
    const p = item.path.toLowerCase();
    if (JUNK_EXTENSIONS.some(ext => n.endsWith(ext) || p.endsWith(ext))) return true;
    return p.includes('\\downl') || p.includes('\\downloads') || p.includes('\\temp');
  };

  const base = items.filter(i => !isJunk(i));

  const passes = (i: AICacheItem, f: Filter) => {
    if (f === 'SAFE') return i.tier === 'GREEN';
    if (f === 'REVIEW') return i.tier === 'YELLOW';
    if (f === 'ACTIVE') return isRecentlyModified(i.lastModified);
    if (f === 'STALE') return !isRecentlyModified(i.lastModified);
    if (f === 'LARGE') return i.sizeBytes >= 1_000_000_000;
    return true;
  };

  const visible = [...base.filter(i => passes(i, filter))].sort((a, b) => {
    if (sortBy === 'SIZE') return b.sizeBytes - a.sizeBytes;
    if (sortBy === 'RECENT') return b.lastModified.localeCompare(a.lastModified);
    if (sortBy === 'OLDEST') return a.lastModified.localeCompare(b.lastModified);
    return a.name.localeCompare(b.name);
  });

  const greenSelectable = visible.filter(i => i.canDelete && i.tier === 'GREEN');
  const selectedItems = visible.filter(i => selectedIds.includes(i.id));
  const selectedBytes = selectedItems.reduce((acc, i) => acc + i.sizeBytes, 0);
  const selectedReviewCount = selectedItems.filter(i => i.tier !== 'GREEN').length;

  const toggle = (id: string) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const filterDefs: { id: Filter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: base.length },
    { id: 'SAFE', label: 'Safe', count: base.filter(i => passes(i, 'SAFE')).length },
    { id: 'REVIEW', label: 'Your data', count: base.filter(i => passes(i, 'REVIEW')).length },
    { id: 'ACTIVE', label: `Active ${RECENT_WINDOW_DAYS}d`, count: base.filter(i => passes(i, 'ACTIVE')).length },
    { id: 'STALE', label: 'Untouched', count: base.filter(i => passes(i, 'STALE')).length },
    { id: 'LARGE', label: 'Over 1 GB', count: base.filter(i => passes(i, 'LARGE')).length }
  ];

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">All locations</h1>
          <p className="ins-sub">
            Every AI cache, model store and project folder found across your drives. Safety is shown per
            row — only &ldquo;Rebuilds itself&rdquo; is risk-free.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ins-space-2)', alignItems: 'center' }}>
          <label className="ins-field-label" htmlFor="sortby" style={{ margin: 0 }}>Sort</label>
          <select id="sortby" className="ins-select" style={{ width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
            <option value="SIZE">Largest first</option>
            <option value="RECENT">Recently used</option>
            <option value="OLDEST">Untouched longest</option>
            <option value="NAME">Name</option>
          </select>
        </div>
      </header>

      {launchMsg && (
        <div className={`ins-note ${launchMsg.ok ? 'ins-note--ok' : 'ins-note--error'}`}>{launchMsg.text}</div>
      )}

      <div style={{ display: 'flex', gap: 'var(--ins-space-1)', flexWrap: 'wrap' }}>
        {filterDefs.map(f => (
          <button
            key={f.id}
            className={`ins-btn${filter === f.id ? '' : ' ins-btn--quiet'}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label} <span className="ins-data" style={{ color: 'var(--ins-mist-500)' }}>{f.count}</span>
          </button>
        ))}
      </div>

      <div
        className="ins-panel"
        style={{ padding: '10px var(--ins-space-4)', display: 'flex', alignItems: 'center', gap: 'var(--ins-space-3)', flexWrap: 'wrap' }}
      >
        <button
          className="ins-btn ins-btn--quiet"
          onClick={() => setSelectedIds(greenSelectable.map(i => i.id))}
          title="Selects only items that rebuild themselves. Your data must be picked one at a time."
        >
          Select {greenSelectable.length} safe
        </button>
        {selectedIds.length > 0 && (
          <button className="ins-btn ins-btn--quiet" onClick={() => setSelectedIds([])}>
            Clear
          </button>
        )}
        <span className="ins-meta">{selectedIds.length} selected</span>
        {selectedReviewCount > 0 && (
          <span className="ins-tier ins-tier--review">{selectedReviewCount} contain your data</span>
        )}
        <button
          className="ins-btn ins-btn--primary"
          style={{ marginLeft: 'auto' }}
          disabled={selectedIds.length === 0 || cleaning}
          onClick={() => onCleanSelected(selectedIds)}
        >
          <Trash2 size={14} /> Reclaim {selectedBytes > 0 ? `${(selectedBytes / 1024 ** 3).toFixed(2)} GB` : ''}
        </button>
      </div>

      <div className="ins-panel" style={{ padding: 'var(--ins-space-4)' }}>
        {loading && items.length === 0 ? (
          <div className="ins-empty">
            <strong>Scanning your drives…</strong>
            Measuring every AI cache, model store and project folder.
          </div>
        ) : visible.length === 0 ? (
          <div className="ins-empty">
            <strong>Nothing matches</strong>
            Try a different filter, or rescan from the overview.
          </div>
        ) : (
          <table className="ins-table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}>
                  <input
                    type="checkbox"
                    aria-label="Select all safe items"
                    checked={greenSelectable.length > 0 && selectedIds.length === greenSelectable.length}
                    onChange={e => setSelectedIds(e.target.checked ? greenSelectable.map(i => i.id) : [])}
                  />
                </th>
                <th>Location</th>
                <th style={{ width: '150px' }}>Safety</th>
                <th style={{ width: '120px' }}>Last used</th>
                <th style={{ width: '100px' }} className="ins-num">Size</th>
                <th style={{ width: '150px' }} />
              </tr>
            </thead>
            <tbody>
              {visible.map(item => {
                const recent = isRecentlyModified(item.lastModified);
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={!item.canDelete}
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={`Select ${item.name}`}
                      />
                    </td>
                    <td>
                      <span className="ins-tool-name">
                        <span className="ins-dot" style={{ background: toolColor(item.category) }} />
                        <span style={{ color: 'var(--ins-mist-50)' }}>{item.name}</span>
                      </span>
                      <button className="ins-path" onClick={() => openFolder(item.path)} title={item.path}>
                        {item.path}
                      </button>
                    </td>
                    <td>
                      {item.tier === 'GREEN' && <span className="ins-tier ins-tier--safe">Rebuilds itself</span>}
                      {item.tier === 'YELLOW' && <span className="ins-tier ins-tier--review">Your data</span>}
                      {item.tier === 'RED' && <span className="ins-tier ins-tier--locked">Protected</span>}
                    </td>
                    <td>
                      <span className="ins-data ins-meta">{item.lastModified}</span>
                      <div className="ins-meta" style={{ fontSize: '0.6875rem' }}>
                        {recent ? 'Active' : 'Untouched'}
                      </div>
                    </td>
                    <td className="ins-num ins-data">{item.formattedSize}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                        {item.isRunnableProject && (
                          <button
                            className="ins-btn ins-btn--quiet"
                            onClick={() => launchProject(item.path)}
                            disabled={launchingPath === item.path}
                          >
                            <Rocket size={12} /> Run
                          </button>
                        )}
                        <button className="ins-btn ins-btn--quiet" onClick={() => openFolder(item.path)}>
                          <FolderOpen size={12} /> Open
                        </button>
                        {item.safeReason && (
                          <button className="ins-btn ins-btn--quiet" onClick={() => setDetail(item)} aria-label="Why is this safe?">
                            <Info size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="ins-overlay" role="dialog" aria-modal="true" onClick={() => setDetail(null)}>
          <div className="ins-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 className="ins-h1" style={{ fontSize: '1.0625rem' }}>{detail.name}</h2>
              <button className="ins-btn ins-btn--quiet" onClick={() => setDetail(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="ins-well ins-data" style={{ fontSize: '0.75rem' }}>{detail.path}</div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--ins-mist-300)', lineHeight: 1.55 }}>{detail.safeReason}</p>
            <div style={{ display: 'flex', gap: 'var(--ins-space-2)', justifyContent: 'flex-end' }}>
              <button className="ins-btn ins-btn--quiet" onClick={() => openFolder(detail.path)}>
                <FolderOpen size={13} /> Open folder
              </button>
              <button className="ins-btn" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
