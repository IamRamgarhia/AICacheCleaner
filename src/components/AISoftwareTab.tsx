import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AIProcessItem, AISoftwareAppItem, SoftwareGroup } from '../types';
import { RefreshCw, AlertTriangle, CheckCircle2, Search, X } from 'lucide-react';
import { UninstallModal } from './UninstallModal';
import { LoadingState } from './LoadingState';
import { SoftwareList } from './SoftwareList';
import { visibleRows, type Sort, type SortKey } from '../lib/softwareStatus';
import { SoftwareDetails } from './SoftwareDetails';
import { isElectron, showContextMenu } from '../lib/native';

interface AISoftwareTabProps {
  processes?: AIProcessItem[];
  onKillProcess: (pid: number) => void;
  onOpenFolder?: (path: string) => void;
  onNavigate?: (tab: string) => void;
  /** Narrow the list (the Agents page shows only agents and crawlers). */
  only?: (item: AISoftwareAppItem) => boolean;
  title?: string;
  subtitle?: string;
}

const COLLAPSED_KEY = 'aicc_software_collapsed';

function loadCollapsed(): Set<SoftwareGroup> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export const AISoftwareTab: React.FC<AISoftwareTabProps> = ({
  onKillProcess, onOpenFolder, onNavigate, only,
  title = 'Installed AI tools',
  subtitle = 'AI apps, apps with AI built in, and the runtimes, services and packages they rely on. Only AI apps can be cleaned from here — everything else is shown so you can see what it is and how much space it takes.'
}) => {
  const [softwareList, setSoftwareList] = useState<AISoftwareAppItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'size', desc: true });
  const [collapsed, setCollapsed] = useState<Set<SoftwareGroup>>(loadCollapsed);
  const [modalItem, setModalItem] = useState<AISoftwareAppItem | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchSoftware = useCallback(async (refresh = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`http://127.0.0.1:3333/api/software${refresh ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setSoftwareList(data.software || []);
    } catch (e) {
      setLoadError(`Could not scan installed software: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSoftware(); }, [fetchSoftware]);

  const detected = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return softwareList
      .filter(s => s.status !== 'NOT INSTALLED')
      .filter(s => !only || only(s))
      .filter(s => !q || `${s.name} ${s.category} ${s.publisher ?? ''}`.toLowerCase().includes(q));
  }, [softwareList, only, filter]);

  const selected = detected.find(s => s.id === selectedId) ?? null;

  const toggleGroup = (g: SoftwareGroup) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* not persisted */ }
      return next;
    });
  };

  const onSort = (key: SortKey) => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }));

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) requestAnimationFrame(() => document.getElementById(`sw-row-${id}`)?.scrollIntoView({ block: 'nearest' }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, button')) return;
    const rows = visibleRows(detected, sort, collapsed).flatMap(g => (g.open ? g.rows : []));
    const at = rows.findIndex(r => r.id === selectedId);
    const go = (i: number) => { e.preventDefault(); select(rows[Math.max(0, Math.min(rows.length - 1, i))]?.id ?? null); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at <= 0 ? 0 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Escape') setSelectedId(null);
  };

  const openFirstFolder = (item: AISoftwareAppItem) => {
    if (onOpenFolder && item.detectionPaths[0]) onOpenFolder(item.detectionPaths[0]);
  };

  const onRowMenu = async (item: AISoftwareAppItem, e: React.MouseEvent) => {
    if (!isElectron()) return;
    e.preventDefault();
    setSelectedId(item.id);
    const choice = await showContextMenu([
      { id: 'open', label: 'Open folder', enabled: !!item.detectionPaths[0] && !!onOpenFolder },
      { id: 'copy', label: 'Copy path', enabled: !!item.detectionPaths[0] },
      ...(item.manualCommand ? [{ id: 'cmd', label: 'Copy remove command' }] : []),
      ...(item.canUninstall ? [{ separator: true }, { id: 'clean', label: 'Clean or remove…' }] : [])
    ]);
    if (choice === 'open') openFirstFolder(item);
    else if (choice === 'copy') void navigator.clipboard?.writeText(item.detectionPaths[0]);
    else if (choice === 'cmd') void navigator.clipboard?.writeText(item.manualCommand!);
    else if (choice === 'clean') setModalItem(item);
  };

  const handleConfirmPurge = async (softwareId: string, purgeMode: 'CACHE_ONLY' | 'FULL_UNINSTALL', createRestorePoint: boolean) => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/purge-software', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ softwareId, purgeMode, createRestorePoint })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server returned ${res.status}`);
      setActionMsg({ ok: data.success !== false, text: data.message });
      void fetchSoftware(true);
    } catch (e) {
      setActionMsg({ ok: false, text: `Could not complete that: ${(e as Error).message}` });
    }
    setTimeout(() => setActionMsg(null), 8000);
  };

  const empty = softwareList.length > 0 && detected.length === 0;

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="ins-h1">{title}</h1>
          <p className="ins-sub" title={subtitle}>{subtitle}</p>
        </div>
        <div className="ins-toolbar" style={{ flexShrink: 0 }}>
          {/* No grand total: rows overlap (npm packages live inside Node.js, models inside Ollama). */}
          {detected.length > 0 && <span className="ins-meta ins-data">{detected.length} items</span>}
          <label className="ins-filter">
            <Search size={13} />
            <input type="search" placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter the list" />
            {filter && <button className="ins-btn ins-btn--quiet ins-btn--icon" onClick={() => setFilter('')} aria-label="Clear filter"><X size={12} /></button>}
          </label>
          <button className="ins-btn" onClick={() => void fetchSoftware(true)} disabled={loading} title="Look again (F5)">
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'Scanning' : 'Rescan'}
          </button>
        </div>
      </header>

      {actionMsg && (
        <div className={`ins-note ${actionMsg.ok ? 'ins-note--ok' : 'ins-note--error'}`}>
          {actionMsg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {actionMsg.text}
        </div>
      )}
      {loadError && <div className="ins-note ins-note--error"><AlertTriangle size={15} /> {loadError}</div>}

      {loading && softwareList.length === 0 ? (
        <LoadingState
          title="Finding AI tools and the software they use"
          detail="Reading installed programs, runtimes and packages, then measuring each one. The first look takes up to a minute; after that it's remembered."
        />
      ) : !loading && softwareList.length === 0 && !loadError ? (
        <div className="ins-empty">
          <strong>Nothing found</strong>
          None of the supported tools were found in their standard install locations.
        </div>
      ) : (
        <div className="ins-split ins-split--app">
          <div className="ins-panel ins-list-wrap" tabIndex={0} onKeyDown={onKeyDown} aria-label="Software list — use arrow keys to move">
            {empty ? (
              <div className="ins-list-empty">Nothing matches “{filter}”.</div>
            ) : (
              <SoftwareList
                items={detected}
                selectedId={selectedId}
                sort={sort}
                collapsed={collapsed}
                onSort={onSort}
                onToggleGroup={toggleGroup}
                onSelect={select}
                onOpen={openFirstFolder}
                onContextMenu={onRowMenu}
              />
            )}
          </div>
          {selected && (
            <SoftwareDetails
              item={selected}
              onClose={() => setSelectedId(null)}
              onOpenFolder={onOpenFolder}
              onStop={onKillProcess}
              onClean={setModalItem}
              onNavigate={onNavigate}
            />
          )}
        </div>
      )}

      <UninstallModal
        software={modalItem}
        isOpen={modalItem !== null}
        onClose={() => setModalItem(null)}
        onConfirmPurge={handleConfirmPurge}
      />
    </div>
  );
};
