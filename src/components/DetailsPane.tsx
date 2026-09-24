import React, { useEffect, useState } from 'react';
import type { AICacheItem } from '../types';
import { Copy, Check, FolderOpen, Trash2, X } from 'lucide-react';
import { formatBytes, idleLabel } from '../lib/format';
import { toolColor } from '../lib/toolColors';

interface Child { name: string; path: string; bytes: number; isDir: boolean }

interface DetailsPaneProps {
  item: AICacheItem;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  onDelete: (id: string) => void;
}

const TIER_LABEL = { GREEN: 'Rebuilds itself', YELLOW: 'Your data', RED: 'Protected' } as const;
const TIER_CLASS = { GREEN: 'ins-tier--safe', YELLOW: 'ins-tier--review', RED: 'ins-tier--locked' } as const;

/**
 * Everything known about one location, beside the list instead of in a modal:
 * why it has its rating, what's inside it (largest first), and the actions.
 */
export const DetailsPane: React.FC<DetailsPaneProps> = ({ item, onClose, onOpenFolder, onDelete }) => {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setChildren(null);
    setInspectError(null);
    // Arrowing through the list shouldn't start a folder walk per row.
    const timer = setTimeout(() => {
      fetch(`http://127.0.0.1:3333/api/inspect?limit=8&path=${encodeURIComponent(item.path)}`, { signal: ctrl.signal })
        .then(async r => {
          const data = await r.json();
          if (!r.ok) return setInspectError(data.error || `Could not look inside (status ${r.status}).`);
          setChildren(data.children);
        })
        .catch(e => { if (e.name !== 'AbortError') setInspectError(`Could not look inside: ${e.message}`); });
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [item.path]);

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const largest = children?.[0]?.bytes || 1;

  return (
    <aside className="ins-details" aria-label={`Details for ${item.name}`}>
      <div className="ins-details-head">
        <span className="ins-tool-name" style={{ minWidth: 0 }}>
          <span className="ins-dot" style={{ background: toolColor(item.category) }} />
          <strong className="ins-details-title">{item.name}</strong>
        </span>
        <button className="ins-btn ins-btn--quiet" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="ins-details-body">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ins-space-3)', flexWrap: 'wrap' }}>
          <span className="ins-data" style={{ fontSize: '1.5rem', color: 'var(--ins-mist-50)' }}>{formatBytes(item.sizeBytes)}</span>
          <span className={`ins-tier ${TIER_CLASS[item.tier]}`}>{TIER_LABEL[item.tier]}</span>
          <span className="ins-meta">{idleLabel(item.idleDays, item.lastModified)}</span>
        </div>

        <div className="ins-well ins-data ins-selectable" style={{ fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{item.path}</span>
          <button className="ins-btn ins-btn--quiet" onClick={() => copy('path', item.path)} aria-label="Copy path" title="Copy path">
            {copied === 'path' ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>

        <section>
          <span className="ins-label">What removing it means</span>
          <p className="ins-details-text">{item.impactDescription}</p>
          {item.safeReason && <p className="ins-details-text">{item.safeReason}</p>}
          {item.evidence && <p className="ins-details-text ins-meta">Why this rating: {item.evidence}</p>}
        </section>

        {typeof item.trappedBytes === 'number' && item.trappedBytes > 0 && (
          <section className="ins-note ins-note--warn">
            About {formatBytes(item.trappedBytes)} inside this file is empty space. Compacting returns it to Windows
            and keeps your data — see Tool cleanup on the Safe to delete page.
          </section>
        )}

        {item.manualCommand && (
          <section>
            <span className="ins-label">Remove it with the tool itself</span>
            <div className="ins-well ins-data ins-selectable" style={{ fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{item.manualCommand}</span>
              <button className="ins-btn ins-btn--quiet" onClick={() => copy('cmd', item.manualCommand!)} aria-label="Copy command">
                {copied === 'cmd' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </section>
        )}

        <section>
          <span className="ins-label">What&apos;s inside</span>
          {inspectError ? (
            <p className="ins-meta">{inspectError}</p>
          ) : children === null ? (
            <p className="ins-meta">Measuring…</p>
          ) : children.length === 0 ? (
            <p className="ins-meta">Empty folder.</p>
          ) : (
            <ul className="ins-inside">
              {children.map(c => (
                <li key={c.path} title={c.path}>
                  <span className="ins-inside-name">{c.isDir ? '▸ ' : ''}{c.name}</span>
                  <span className="ins-inside-bar"><span style={{ width: `${Math.max(2, (c.bytes / largest) * 100)}%` }} /></span>
                  <span className="ins-data ins-inside-size">{formatBytes(c.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="ins-details-actions">
        <button className="ins-btn" onClick={() => onOpenFolder(item.path)}>
          <FolderOpen size={13} /> Open folder
        </button>
        <button
          className="ins-btn ins-btn--primary"
          disabled={!item.canDelete}
          onClick={() => onDelete(item.id)}
          title={item.canDelete ? 'Asks before deleting; goes to the Recycle Bin' : 'Not deletable from this app'}
          style={{ marginLeft: 'auto' }}
        >
          <Trash2 size={13} /> {item.canDelete ? 'Delete…' : 'Locked'}
        </button>
      </div>
    </aside>
  );
};
