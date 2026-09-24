import React, { useEffect, useRef, useState } from 'react';
import type { AICacheItem } from '../types';
import { FolderOpen, Rocket, Trash2 } from 'lucide-react';
import { JUNK_EXTENSIONS, RECENT_WINDOW_DAYS, isRecentlyModified } from '../lib/itemFilters';
import { toolColor } from '../lib/toolColors';
import { openItemMenu } from '../lib/itemMenu';
import { DetailsPane } from './DetailsPane';
import { LoadingState } from './LoadingState';

interface TargetListTableProps {
  items: AICacheItem[];
  onCleanSelected: (selectedIds: string[]) => void;
  cleaning?: boolean;
  onOpenFolder?: (path: string) => void;
  loading?: boolean;
  /** Text from the title-bar search box. */
  query?: string;
}

type Filter = 'ALL' | 'SAFE' | 'REVIEW' | 'ACTIVE' | 'STALE' | 'LARGE' | 'ABANDONED';
type SortBy = 'SIZE' | 'RECENT' | 'OLDEST' | 'NAME';

export const TargetListTable: React.FC<TargetListTableProps> = ({ items, onCleanSelected, cleaning, onOpenFolder, loading, query = '' }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sortBy, setSortBy] = useState<SortBy>('SIZE');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

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

  const q = query.trim().toLowerCase();
  const base = items
    .filter(i => !isJunk(i))
    .filter(i => !q || `${i.name} ${i.path} ${i.category}`.toLowerCase().includes(q));

  const passes = (i: AICacheItem, f: Filter) => {
    if (f === 'SAFE') return i.tier === 'GREEN';
    if (f === 'REVIEW') return i.tier === 'YELLOW';
    if (f === 'ACTIVE') return isRecentlyModified(i.lastModified);
    if (f === 'STALE') return !isRecentlyModified(i.lastModified);
    if (f === 'LARGE') return i.sizeBytes >= 1_000_000_000;
    if (f === 'ABANDONED') return (i.idleDays ?? 0) >= 90;
    return true;
  };

  const visible = [...base.filter(i => passes(i, filter))].sort((a, b) => {
    if (sortBy === 'SIZE') return b.sizeBytes - a.sizeBytes;
    if (sortBy === 'RECENT') return b.lastModified.localeCompare(a.lastModified);
    if (sortBy === 'OLDEST') return a.lastModified.localeCompare(b.lastModified);
    return a.name.localeCompare(b.name);
  });

  const focused = visible.find(i => i.id === focusedId) ?? null;
  const greenSelectable = visible.filter(i => i.canDelete && i.tier === 'GREEN');
  // Only what is on screen and deletable counts. A search or filter must never
  // leave hidden selections that a Delete or Reclaim would silently include.
  const selectedItems = visible.filter(i => i.canDelete && selectedIds.includes(i.id));
  const effectiveIds = selectedItems.map(i => i.id);
  const selectedBytes = selectedItems.reduce((acc, i) => acc + i.sizeBytes, 0);
  const selectedReviewCount = selectedItems.filter(i => i.tier !== 'GREEN').length;

  const toggle = (id: string) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  useEffect(() => {
    if (focusedId) rowRefs.current.get(focusedId)?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  // After a clean or rescan, forget selections of items that no longer exist.
  useEffect(() => {
    setSelectedIds(prev => prev.filter(id => items.some(i => i.id === id)));
  }, [items]);

  // Keyboard: ↑/↓ move, Space selects, Enter opens the folder, Delete asks to
  // delete (the caution dialog still decides), Esc closes the details pane.
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Controls handle their own keys (Space on a checkbox ticks THAT row), and
    // nothing here may act behind an open confirmation dialog.
    if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const idx = visible.findIndex(i => i.id === focusedId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (visible[next]) setFocusedId(visible[next].id);
    } else if (!focused) {
      return;
    } else if (e.key === ' ') {
      e.preventDefault();
      if (focused.canDelete) toggle(focused.id);
    } else if (e.key === 'Enter') {
      openFolder(focused.path);
    } else if (e.key === 'Delete') {
      // The focused row is what Delete means — unless it is part of a
      // selection, in which case the (visible) selection goes together.
      if (effectiveIds.includes(focused.id)) onCleanSelected(effectiveIds);
      else if (focused.canDelete) onCleanSelected([focused.id]);
    } else if (e.key === 'Escape') {
      setFocusedId(null);
    }
  };

  const filterDefs: { id: Filter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: base.length },
    { id: 'SAFE', label: 'Safe', count: base.filter(i => passes(i, 'SAFE')).length },
    { id: 'REVIEW', label: 'Your data', count: base.filter(i => passes(i, 'REVIEW')).length },
    { id: 'ACTIVE', label: `Active ${RECENT_WINDOW_DAYS}d`, count: base.filter(i => passes(i, 'ACTIVE')).length },
    { id: 'STALE', label: 'Untouched', count: base.filter(i => passes(i, 'STALE')).length },
    { id: 'LARGE', label: 'Over 1 GB', count: base.filter(i => passes(i, 'LARGE')).length },
    { id: 'ABANDONED', label: 'Untouched 90d+', count: base.filter(i => passes(i, 'ABANDONED')).length }
  ];

  return (
    <div className="ins-page ins-page--split">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">All locations</h1>
          <p className="ins-sub">
            Every AI cache, model, app cache and project folder found. Only &ldquo;Rebuilds itself&rdquo; is risk-free.
            {q && <> Showing matches for &ldquo;{query}&rdquo;.</>}
          </p>
        </div>

        <div className="ins-toolbar">
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

      <div className="ins-segmented" role="group" aria-label="Filter">
        {filterDefs.map(f => (
          <button key={f.id} className={filter === f.id ? 'is-on' : ''} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
            {f.label} <span className="ins-data">{f.count}</span>
          </button>
        ))}
      </div>

      <div className="ins-actionbar">
        <button
          className="ins-btn ins-btn--quiet"
          onClick={() => setSelectedIds(greenSelectable.map(i => i.id))}
          title="Selects only items that rebuild themselves. Your data must be picked one at a time."
        >
          Select {greenSelectable.length} safe
        </button>
        {effectiveIds.length > 0 && (
          <button className="ins-btn ins-btn--quiet" onClick={() => setSelectedIds([])}>Clear</button>
        )}
        <span className="ins-meta">{effectiveIds.length} selected</span>
        {selectedReviewCount > 0 && <span className="ins-tier ins-tier--review">{selectedReviewCount} contain your data</span>}
        <span className="ins-meta ins-hint">↑↓ move · Space select · Enter open · Del delete</span>
        <button
          className="ins-btn ins-btn--primary"
          style={{ marginLeft: 'auto' }}
          disabled={effectiveIds.length === 0 || cleaning}
          onClick={() => onCleanSelected(effectiveIds)}
        >
          <Trash2 size={14} /> Reclaim {selectedBytes > 0 ? `${(selectedBytes / 1024 ** 3).toFixed(2)} GB` : ''}
        </button>
      </div>

      <div className="ins-split">
        <div className="ins-panel ins-split-list" tabIndex={0} onKeyDown={onKeyDown} aria-label="Locations">
          {loading && items.length === 0 ? (
            <LoadingState live title="Scanning your drives" detail="Measuring every AI cache, model, app cache and project folder." />
          ) : visible.length === 0 ? (
            <div className="ins-empty">
              <strong>Nothing matches</strong>
              {q ? 'Try a different search.' : 'Try a different filter, or rescan.'}
            </div>
          ) : (
            <table className="ins-table ins-table--interactive">
              <thead>
                <tr>
                  <th style={{ width: '32px' }}>
                    <input
                      type="checkbox"
                      aria-label="Select all safe items"
                      checked={greenSelectable.length > 0 && greenSelectable.every(i => selectedIds.includes(i.id))}
                      onChange={e => setSelectedIds(e.target.checked ? greenSelectable.map(i => i.id) : [])}
                    />
                  </th>
                  <th>Location</th>
                  <th style={{ width: '130px' }}>Safety</th>
                  <th style={{ width: '104px' }}>Last used</th>
                  <th style={{ width: '92px' }} className="ins-num">Size</th>
                  <th style={{ width: '84px' }} />
                </tr>
              </thead>
              <tbody>
                {visible.map(item => {
                  const recent = isRecentlyModified(item.lastModified);
                  return (
                    <tr
                      key={item.id}
                      ref={el => { if (el) rowRefs.current.set(item.id, el); else rowRefs.current.delete(item.id); }}
                      className={item.id === focusedId ? 'is-focused' : undefined}
                      onClick={() => setFocusedId(item.id)}
                      onDoubleClick={() => openFolder(item.path)}
                      onContextMenu={e => {
                        setFocusedId(item.id);
                        void openItemMenu(e, item, {
                          onOpenFolder: openFolder,
                          onDelete: id => onCleanSelected([id]),
                          onShowDetails: i => setFocusedId(i.id)
                        });
                      }}
                      aria-selected={item.id === focusedId}
                    >
                      <td onClick={e => e.stopPropagation()}>
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
                        <span className="ins-path" title={item.path}>{item.path}</span>
                      </td>
                      <td>
                        {item.tier === 'GREEN' && <span className="ins-tier ins-tier--safe">Rebuilds itself</span>}
                        {item.tier === 'YELLOW' && <span className="ins-tier ins-tier--review">Your data</span>}
                        {item.tier === 'RED' && <span className="ins-tier ins-tier--locked">Protected</span>}
                      </td>
                      <td>
                        <span className="ins-data ins-meta">
                          {typeof item.idleDays === 'number'
                            ? item.idleDays === 0 ? 'today' : `${item.idleDays}d idle`
                            : item.lastModified}
                        </span>
                        <div className="ins-meta" style={{ fontSize: '0.6875rem', color: (item.idleDays ?? 0) >= 90 ? 'var(--ins-review)' : undefined }}>
                          {(item.idleDays ?? 0) >= 90 ? 'Abandoned' : recent ? 'Active' : 'Untouched'}
                        </div>
                      </td>
                      <td className="ins-num ins-data">{item.formattedSize}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                          {item.isRunnableProject && (
                            <button
                              className="ins-btn ins-btn--quiet"
                              onClick={e => { e.stopPropagation(); launchProject(item.path); }}
                              disabled={launchingPath === item.path}
                              title="Start its dev server"
                            >
                              <Rocket size={12} />
                            </button>
                          )}
                          <button
                            className="ins-btn ins-btn--quiet"
                            onClick={e => { e.stopPropagation(); openFolder(item.path); }}
                            title="Open folder"
                            aria-label={`Open ${item.name}`}
                          >
                            <FolderOpen size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {focused && (
          <DetailsPane
            item={focused}
            onClose={() => setFocusedId(null)}
            onOpenFolder={openFolder}
            onDelete={id => onCleanSelected([id])}
          />
        )}
      </div>
    </div>
  );
};
