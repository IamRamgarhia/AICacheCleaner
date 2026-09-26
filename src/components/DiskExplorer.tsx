import React, { useEffect, useState } from 'react';
import { ArrowUp, FolderOpen, HardDrive, Home, Loader2, RefreshCw } from 'lucide-react';
import { formatBytes } from '../lib/format';
import { isElectron, showContextMenu } from '../lib/native';
import { LoadingState } from './LoadingState';

interface Child { name: string; path: string; bytes: number; isDir: boolean; newestMtimeMs: number; pending?: boolean }
interface Drive { root: string; freeBytes: number; totalBytes: number }

interface DiskExplorerProps {
  onOpenFolder: (path: string) => void;
}

function parentOf(p: string): string | null {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  // "C:" -> "C:\" ; "" (posix root) -> "/"
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || '/';
}

/**
 * Read-only "where did my space go" view: any folder's children, largest first.
 * It never deletes — removal of arbitrary folders stays with the user, in
 * Explorer. Known safe items are cleaned from the other pages.
 */
export const DiskExplorer: React.FC<DiskExplorerProps> = ({ onOpenFolder }) => {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [home, setHome] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch('http://127.0.0.1:3333/api/status')
      .then(r => r.json())
      .then(d => {
        setDrives(d.drives || []);
        setHome(d.home || null);
        setCurrent(prev => prev ?? d.home ?? null);
      })
      .catch(e => setError(`Could not reach the local engine: ${e.message}`));
  }, []);

  // Polls a live snapshot: every entry is listed at once and sizes fill in as
  // each is measured, so a 100 GB folder is useful after a second, not minutes.
  useEffect(() => {
    if (!current) return;
    const ctrl = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    setChildren(null);
    setError(null);
    setDone(false);
    setElapsed(0);
    const poll = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:3333/api/inspect?live=1&limit=300&path=${encodeURIComponent(current)}`, { signal: ctrl.signal });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `status ${r.status}`);
        setChildren(data.children);
        setElapsed(Math.round((Date.now() - started) / 1000));
        if (data.done) setDone(true);
        else timer = setTimeout(poll, 1000);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      }
    };
    void poll();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [current, reloadKey]);

  const total = children?.reduce((a, c) => a + c.bytes, 0) ?? 0;
  const largest = children?.[0]?.bytes || 1;
  const up = current ? parentOf(current) : null;

  const menu = async (_e: React.MouseEvent, c: Child) => {
    const chosen = await showContextMenu([
      ...(c.isDir ? [{ id: 'into', label: 'Open here' }] : []),
      { id: 'reveal', label: 'Show in Explorer' },
      { id: 'copy', label: 'Copy path' }
    ]);
    if (chosen === null) return;
    if (chosen === 'into') setCurrent(c.path);
    if (chosen === 'reveal') onOpenFolder(c.isDir ? c.path : current!);
    if (chosen === 'copy') void navigator.clipboard?.writeText(c.path);
  };

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Disk explorer</h1>
          <p className="ins-sub">Where the space goes, largest first. Read-only — open a folder in Explorer to remove anything yourself.</p>
        </div>
        <div className="ins-toolbar">
          {home && (
            <button className="ins-btn ins-btn--quiet" onClick={() => setCurrent(home)} title="Your user folder">
              <Home size={13} /> Home
            </button>
          )}
          {drives.map(d => (
            <button key={d.root} className="ins-btn ins-btn--quiet" onClick={() => setCurrent(d.root)}
              title={`${formatBytes(d.freeBytes)} free of ${formatBytes(d.totalBytes)}`}>
              <HardDrive size={13} /> {d.root.replace(/\\$/, '')}
            </button>
          ))}
        </div>
      </header>

      <div className="ins-actionbar">
        <button className="ins-btn ins-btn--quiet" disabled={!up} onClick={() => up && setCurrent(up)} aria-label="Up one folder" title="Up one folder (Backspace)">
          <ArrowUp size={13} />
        </button>
        <span className="ins-data ins-selectable ins-breadcrumb" title={current ?? ''}>{current ?? '…'}</span>
        <span className="ins-meta">
          {children ? `${children.length} items · ${formatBytes(total)}${done ? '' : ` so far · measuring ${elapsed}s`}` : ''}
        </span>
        {children && !done && <Loader2 size={13} className="spin" aria-label="Measuring" />}
        <button className="ins-btn ins-btn--quiet" onClick={() => setReloadKey(k => k + 1)} title="Measure again">
          <RefreshCw size={13} />
        </button>
        {current && (
          <button className="ins-btn" onClick={() => onOpenFolder(current)} style={{ marginLeft: 'auto' }}>
            <FolderOpen size={13} /> Show in Explorer
          </button>
        )}
      </div>

      <div
        className="ins-panel ins-split-list"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Backspace' && up) { e.preventDefault(); setCurrent(up); } }}
      >
        {error ? (
          <div className="ins-empty"><strong>Could not read this folder</strong>{error}</div>
        ) : children === null ? (
          <LoadingState
            title={`Measuring ${current ?? 'folder'}`}
            detail="A whole drive can take a few minutes the first time; results are then remembered for 5 minutes."
          />
        ) : children.length === 0 ? (
          <div className="ins-empty"><strong>Empty folder</strong></div>
        ) : (
          <table className="ins-table ins-table--interactive">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: '38%' }}>Share</th>
                <th style={{ width: '96px' }} className="ins-num">Size</th>
                <th style={{ width: '110px' }}>Last changed</th>
              </tr>
            </thead>
            <tbody>
              {children.map(c => (
                <tr
                  key={c.path}
                  onClick={() => c.isDir && setCurrent(c.path)}
                  onContextMenu={e => { if (isElectron()) { e.preventDefault(); void menu(e, c); } }}
                  style={{ cursor: c.isDir ? 'pointer' : 'default' }}
                  title={c.path}
                >
                  <td>
                    <span style={{ color: c.isDir ? 'var(--ins-mist-50)' : 'var(--ins-mist-300)' }}>
                      {c.isDir ? '▸ ' : ''}{c.name}
                    </span>
                  </td>
                  <td>
                    <span className="ins-inside-bar"><span style={{ width: `${Math.max(1, (c.bytes / largest) * 100)}%` }} /></span>
                  </td>
                  <td className="ins-num ins-data">{c.pending ? <span className="ins-meta">…</span> : formatBytes(c.bytes)}</td>
                  <td className="ins-meta ins-data">
                    {c.newestMtimeMs ? new Date(c.newestMtimeMs).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
