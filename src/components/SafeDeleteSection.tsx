import React, { useEffect, useState } from 'react';
import type { AICacheItem } from '../types';
import { FolderOpen, Trash2, CheckCircle2 } from 'lucide-react';
import { toolColor } from '../lib/toolColors';

interface SafeDeleteSectionProps {
  items: AICacheItem[];
  onCleanSelected: (itemIds: string[]) => void;
  onOpenFolder?: (path: string) => void;
  cleaning?: boolean;
  loading?: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`;
}

export const SafeDeleteSection: React.FC<SafeDeleteSectionProps> = ({
  items,
  onCleanSelected,
  onOpenFolder,
  cleaning,
  loading
}) => {
  const safeItems = items.filter(i => i.tier === 'GREEN' && i.canDelete);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // useState's initialiser only runs on first mount. If this tab was the one
  // restored from localStorage, it mounted before the scan returned and the
  // pre-selection stayed permanently empty. Sync when the item set changes.
  useEffect(() => {
    setSelectedIds(safeItems.map(i => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const selectedBytes = safeItems
    .filter(i => selectedIds.includes(i.id))
    .reduce((acc, i) => acc + i.sizeBytes, 0);

  const handleOpenFolder = async (folderPath: string) => {
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

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const allSelected = safeItems.length > 0 && selectedIds.length === safeItems.length;

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Safe to delete</h1>
          <p className="ins-sub">
            Temporary graphics caches, compiled bytecode and diagnostic logs. Every item here is rebuilt
            automatically the next time the tool starts — no project code, settings or chat history is touched.
          </p>
        </div>

        <button
          className="ins-btn ins-btn--primary"
          disabled={selectedIds.length === 0 || cleaning}
          onClick={() => onCleanSelected(selectedIds)}
        >
          <Trash2 size={14} />
          {cleaning ? 'Cleaning…' : `Reclaim ${formatBytes(selectedBytes)}`}
        </button>
      </header>

      {safeItems.length > 0 && (
        <div
          className="ins-panel"
          style={{ padding: '10px var(--ins-space-4)', display: 'flex', alignItems: 'center', gap: 'var(--ins-space-4)' }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={e => setSelectedIds(e.target.checked ? safeItems.map(i => i.id) : [])}
            />
            Select all
          </label>
          <span className="ins-meta">
            {selectedIds.length} of {safeItems.length} selected
          </span>
          <span className="ins-data" style={{ marginLeft: 'auto', color: 'var(--ins-safe)', fontSize: '0.875rem' }}>
            {formatBytes(selectedBytes)}
          </span>
        </div>
      )}

      {loading && safeItems.length === 0 ? (
        <div className="ins-empty">
          <strong>Scanning for safe caches…</strong>
          Measuring each cache location on your drives.
        </div>
      ) : safeItems.length === 0 ? (
        <div className="ins-empty">
          <strong>Nothing to reclaim right now</strong>
          No auto-rebuilding caches were found. Run a scan from the overview, or check All locations for
          items that need your review.
        </div>
      ) : (
        <div className="ins-grid">
          {safeItems.map(item => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <div key={item.id} className={`ins-card ins-card--tool${isSelected ? ' ins-card--selected' : ''}`}
                style={{ borderLeftColor: toolColor(item.category) }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(item.id)}
                    style={{ marginTop: '2px', flexShrink: 0 }}
                    aria-label={`Select ${item.name}`}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ins-card-title">{item.name}</div>
                    <span className="ins-meta ins-tool-name"><span className="ins-dot" style={{ background: toolColor(item.category) }} />{item.category}</span>
                  </div>
                  <span className="ins-tier ins-tier--safe">Rebuilds itself</span>
                </div>

                <button className="ins-path" onClick={() => handleOpenFolder(item.path)} title={item.path}>
                  {item.path}
                </button>

                <div className="ins-well">{item.safeReason || item.impactDescription}</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ins-space-2)', marginTop: 'auto' }}>
                  <div>
                    <div className="ins-data" style={{ fontSize: '1rem', color: 'var(--ins-mist-50)' }}>
                      {item.formattedSize}
                    </div>
                    <span className="ins-meta">Modified {item.lastModified}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button className="ins-btn ins-btn--quiet" onClick={() => handleOpenFolder(item.path)}>
                      <FolderOpen size={13} /> Open
                    </button>
                    <button className="ins-btn ins-btn--quiet" onClick={() => onCleanSelected([item.id])}>
                      <CheckCircle2 size={13} /> Reclaim
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
