import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import type { ClutterItem, ClutterScanResult, ClutterTrashResponse } from '../lib/types/clutter';
import { confirmDialog } from '../lib/native';
import { formatBytes, idleLabel } from '../lib/format';
import { LoadingState } from './LoadingState';
import { apiJson, requireArrays } from '../lib/shape';

const API = 'http://127.0.0.1:3333';

interface ProjectClutterTabProps {
  onOpenFolder?: (p: string) => void;
}

type SortBy = 'SIZE' | 'OLDEST' | 'RECENT';
type Message = { ok: boolean; text: string } | null;

const projectName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

async function openFolder(folderPath: string, onOpenFolder?: (p: string) => void) {
  if (onOpenFolder) return onOpenFolder(folderPath);
  await fetch(`${API}/api/open-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  }).catch(() => undefined); // best effort, like the other tabs
}

function describeResult(r: ClutterTrashResponse, items: ClutterItem[]): string {
  const label = (id: string) => {
    const i = items.find(x => x.id === id);
    return i ? `${projectName(i.projectPath)}/${i.kind}` : id;
  };
  const moved = r.moved.length > 0 ? `Moved ${r.moved.length} to the Recycle Bin (${r.reclaimedFormatted}).` : 'Nothing was moved.';
  const refused = r.refused.map(x => `Not moved: ${label(x.id)} — ${x.reason}.`);
  return [moved, ...refused].join('\n');
}

/**
 * Rebuildable build and dependency folders in project trees. Projects touched
 * in the last two weeks are shown but never ticked for you, and the server
 * refuses them unless you tick them yourself.
 */
export const ProjectClutterTab: React.FC<ProjectClutterTabProps> = ({ onOpenFolder }) => {
  const [data, setData] = useState<ClutterScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>('SIZE');
  const [message, setMessage] = useState<Message>(null);

  const applyResult = (result: ClutterScanResult) => {
    setData(result);
    setSelected(result.items.filter(i => !i.recent).map(i => i.id));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/project-clutter`);
      const body = await apiJson(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      applyResult(requireArrays<ClutterScanResult>(body, ['items', 'roots']));
    } catch (e) {
      setMessage({ ok: false, text: `Could not look for project clutter: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = [...(data?.items ?? [])].sort((a, b) => {
    if (sortBy === 'OLDEST') return a.projectLastTouchedMs - b.projectLastTouchedMs;
    if (sortBy === 'RECENT') return b.projectLastTouchedMs - a.projectLastTouchedMs;
    return b.sizeBytes - a.sizeBytes;
  });
  const chosen = items.filter(i => selected.includes(i.id));
  const chosenBytes = chosen.reduce((sum, i) => sum + i.sizeBytes, 0);
  const recentChosen = chosen.filter(i => i.recent);
  const toggle = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const moveSelected = async () => {
    const list = chosen.slice(0, 12).map(i => `• ${i.paths.length > 1 ? `${i.paths.length} ${i.kind} folders in ${i.projectPath}` : i.paths[0]}`).join('\n');
    const more = chosen.length > 12 ? `\n…and ${chosen.length - 12} more` : '';
    const recentNote = recentChosen.length > 0
      ? `\n\n${recentChosen.length} of these belong to projects changed in the last ${data?.recentDays ?? 14} days.`
      : '';
    const ok = await confirmDialog({
      title: 'Move build folders to Recycle Bin',
      message: `Move ${chosen.length} folder${chosen.length === 1 ? '' : 's'} (${formatBytes(chosenBytes)}) to the Recycle Bin?`,
      detail: `${list}${more}${recentNote}\n\nThey are rebuilt by npm install, pip, cargo build or the project's build. You can restore them from the Recycle Bin.`,
      confirmLabel: 'Move to Recycle Bin'
    });
    if (!ok || !data) return;
    setMoving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/project-clutter/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chosen.map(i => i.id), includeRecent: recentChosen.length > 0 })
      });
      const body = await apiJson(res, { allowErrorBody: true });
      if (!res.ok && !Array.isArray(body.refused)) throw new Error(body.error || `HTTP ${res.status}`);
      const result = requireArrays<ClutterTrashResponse & { error?: string }>(body, ['moved', 'refused']);
      const movedIds = new Set(result.moved.map(m => m.id));
      setMessage({ ok: res.ok && result.refused.length === 0, text: result.error ?? describeResult(result, data.items) });
      setData({ ...data, items: data.items.filter(i => !movedIds.has(i.id)) });
      setSelected(prev => prev.filter(id => !movedIds.has(id)));
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Project clutter</h1>
          <p className="ins-sub">
            Dependency and build folders your projects rebuild on demand — node_modules, virtual environments, Rust
            target, framework caches and dist/build output. Only folders next to the file that rebuilds them are listed.
          </p>
        </div>
      </header>

      <div className="ins-actionbar">
        <label className="ins-check">
          <input
            type="checkbox"
            checked={items.length > 0 && selected.length === items.filter(i => !i.recent).length && recentChosen.length === 0}
            onChange={e => setSelected(e.target.checked ? items.filter(i => !i.recent).map(i => i.id) : [])}
          />
          Select all older projects
        </label>
        <label className="ins-field-label" htmlFor="clutter-sort" style={{ margin: 0 }}>Sort</label>
        <select id="clutter-sort" className="ins-select" style={{ width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
          <option value="SIZE">Largest first</option>
          <option value="OLDEST">Least recently touched</option>
          <option value="RECENT">Most recently touched</option>
        </select>
        <button className="ins-btn" disabled={loading || moving} onClick={() => void load()}>
          <RefreshCw size={14} />
          Rescan
        </button>
        <button className="ins-btn ins-btn--primary" style={{ marginLeft: 'auto' }} disabled={chosen.length === 0 || moving || loading} onClick={() => void moveSelected()}>
          <Trash2 size={14} />
          {moving ? 'Moving…' : `Move ${chosen.length} to Recycle Bin (${formatBytes(chosenBytes)})`}
        </button>
      </div>

      {message && <div className={`ins-note ${message.ok ? 'ins-note--ok' : 'ins-note--error'}`} style={{ whiteSpace: 'pre-line' }}>{message.text}</div>}
      {data?.truncated && (
        <div className="ins-note ins-note--warn">
          The search stopped after {data.dirsVisited.toLocaleString()} folders, so some projects may be missing.
        </div>
      )}

      <div className="ins-panel ins-split-list">
        {loading ? (
          <LoadingState title="Looking for rebuildable project folders" detail="Searching your project folders, then measuring each build and dependency folder." />
        ) : items.length === 0 ? (
          <div className="ins-empty">
            <strong>No project clutter found</strong>
            {data ? `Searched ${data.dirsVisited.toLocaleString()} folders under ${data.roots.length} locations.` : 'Rescan to try again.'}
          </div>
        ) : (
          <table className="ins-table ins-table--interactive">
            <thead>
              <tr>
                <th style={{ width: '32px' }} />
                <th>Project folder</th>
                <th style={{ width: '150px' }}>Project last touched</th>
                <th style={{ width: '96px' }} className="ins-num">Size</th>
                <th style={{ width: '44px' }} />
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} onClick={() => toggle(item.id)} title={item.paths.join('\n')}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`Select ${item.kind} in ${item.projectPath}`} />
                  </td>
                  <td>
                    <span className="ins-tool-name">
                      <span style={{ color: 'var(--ins-mist-50)' }}>{projectName(item.projectPath)}</span>
                      <span className="ins-meta ins-data">{item.kind}{item.paths.length > 1 ? ` × ${item.paths.length}` : ''}</span>
                      {item.recent && <span className="ins-tier ins-tier--review">Recent project</span>}
                    </span>
                    <span className="ins-path">{item.paths.length > 1 ? item.projectPath : item.paths[0]}</span>
                  </td>
                  <td className="ins-meta ins-data">{idleLabel(item.idleDays, 'unknown')}</td>
                  <td className="ins-num ins-data">{item.formattedSize}</td>
                  <td>
                    <button className="ins-btn ins-btn--quiet" onClick={e => { e.stopPropagation(); void openFolder(item.projectPath, onOpenFolder); }} title="Open project folder" aria-label={`Open ${item.projectPath}`}>
                      <FolderOpen size={12} />
                    </button>
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
