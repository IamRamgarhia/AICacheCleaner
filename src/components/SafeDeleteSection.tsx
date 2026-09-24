import React, { useEffect, useRef, useState } from 'react';
import type { AICacheItem } from '../types';
import { FolderOpen, Trash2 } from 'lucide-react';
import { toolColor } from '../lib/toolColors';
import { formatBytes, idleLabel } from '../lib/format';
import { openItemMenu } from '../lib/itemMenu';
import { ReclaimCommands } from './ReclaimCommands';
import { SystemTips } from './SystemTips';

interface SafeDeleteSectionProps {
  items: AICacheItem[];
  onCleanSelected: (itemIds: string[]) => void;
  onOpenFolder?: (path: string) => void;
  cleaning?: boolean;
  loading?: boolean;
}

export const SafeDeleteSection: React.FC<SafeDeleteSectionProps> = ({
  items,
  onCleanSelected,
  onOpenFolder,
  cleaning,
  loading
}) => {
  const safeItems = [...items.filter(i => i.tier === 'GREEN' && i.canDelete)].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // New safe items start selected; ones the user has already seen keep
  // whatever they chose, so a rescan never re-ticks something they unticked.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const green = items.filter(i => i.tier === 'GREEN' && i.canDelete).map(i => i.id);
    const fresh = green.filter(id => !seen.current.has(id));
    fresh.forEach(id => seen.current.add(id));
    setSelectedIds(prev => [...prev.filter(id => green.includes(id)), ...fresh]);
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
            Caches the tools rebuild on their own — web and code caches, GPU shaders, package downloads. No project code,
            settings, logins or chat history. Everything goes to the Recycle Bin after you confirm.
          </p>
        </div>
      </header>

      <div className="ins-actionbar">
        <label className="ins-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={e => setSelectedIds(e.target.checked ? safeItems.map(i => i.id) : [])}
          />
          Select all
        </label>
        <span className="ins-meta">{selectedIds.length} of {safeItems.length} selected</span>
        <button
          className="ins-btn ins-btn--primary"
          style={{ marginLeft: 'auto' }}
          disabled={selectedIds.length === 0 || cleaning}
          onClick={() => onCleanSelected(selectedIds)}
        >
          <Trash2 size={14} />
          {cleaning ? 'Cleaning…' : `Reclaim ${formatBytes(selectedBytes)}`}
        </button>
      </div>

      <div className="ins-panel ins-split-list">
        {loading && safeItems.length === 0 ? (
          <div className="ins-empty">
            <strong>Scanning for safe caches…</strong>
            Measuring each cache location on your drives.
          </div>
        ) : safeItems.length === 0 ? (
          <div className="ins-empty">
            <strong>Nothing to reclaim right now</strong>
            No auto-rebuilding caches were found. Rescan, or check All locations for items that need your review.
          </div>
        ) : (
          <table className="ins-table ins-table--interactive">
            <thead>
              <tr>
                <th style={{ width: '32px' }} />
                <th>Cache</th>
                <th style={{ width: '120px' }}>Last used</th>
                <th style={{ width: '96px' }} className="ins-num">Size</th>
                <th style={{ width: '84px' }} />
              </tr>
            </thead>
            <tbody>
              {safeItems.map(item => (
                <tr
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  onContextMenu={e => void openItemMenu(e, item, { onOpenFolder: handleOpenFolder, onDelete: id => onCleanSelected([id]) })}
                  title={item.safeReason || item.impactDescription}
                >
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelect(item.id)} aria-label={`Select ${item.name}`} />
                  </td>
                  <td>
                    <span className="ins-tool-name">
                      <span className="ins-dot" style={{ background: toolColor(item.category) }} />
                      <span style={{ color: 'var(--ins-mist-50)' }}>{item.name}</span>
                    </span>
                    <span className="ins-path">{item.impactDescription}</span>
                  </td>
                  <td className="ins-meta ins-data">{idleLabel(item.idleDays, item.lastModified)}</td>
                  <td className="ins-num ins-data">{item.formattedSize}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                      <button className="ins-btn ins-btn--quiet" onClick={e => { e.stopPropagation(); handleOpenFolder(item.path); }} title="Open folder" aria-label={`Open ${item.name}`}>
                        <FolderOpen size={12} />
                      </button>
                      <button className="ins-btn ins-btn--quiet" onClick={e => { e.stopPropagation(); onCleanSelected([item.id]); }} title="Delete just this one" aria-label={`Delete ${item.name}`}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SystemTips onOpenFolder={handleOpenFolder} />
      <ReclaimCommands />
    </div>
  );
};
