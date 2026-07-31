import React, { useEffect, useState } from 'react';
import type { AICacheItem } from '../types';
import { X, ShieldAlert, FolderTree } from 'lucide-react';

interface PreDeleteModalProps {
  isOpen: boolean;
  itemsToClean: AICacheItem[];
  restorePointPolicy?: 'PROMPT' | 'ALWAYS' | 'NEVER';
  onConfirmClean: (createRestorePoint: boolean) => void;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`;
}

export const PreDeleteModal: React.FC<PreDeleteModalProps> = ({
  isOpen,
  itemsToClean,
  restorePointPolicy = 'PROMPT',
  onConfirmClean,
  onCancel
}) => {
  const [createRestorePoint, setCreateRestorePoint] = useState<boolean>(true);
  const [ackUserData, setAckUserData] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setAckUserData(false);
      setCreateRestorePoint(restorePointPolicy !== 'NEVER');
    }
  }, [isOpen, restorePointPolicy]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const totalBytes = itemsToClean.reduce((acc, i) => acc + i.sizeBytes, 0);

  // YELLOW/RED hold real user data — chat databases, session keys, model
  // weights. Deleting them is allowed but must be deliberate.
  const userDataItems = itemsToClean.filter(i => i.tier === 'YELLOW' || i.tier === 'RED');

  // Warn when one selection lives inside another: deleting the parent takes the
  // child too, so the itemised list understates what is actually removed.
  const enclosedPairs: { parent: string; child: string }[] = [];
  for (const outer of itemsToClean) {
    const outerKey = outer.path.toLowerCase().replace(/[\\/]+$/, '');
    for (const inner of itemsToClean) {
      if (inner.id === outer.id) continue;
      const innerKey = inner.path.toLowerCase();
      if (innerKey.startsWith(outerKey + '\\') || innerKey.startsWith(outerKey + '/')) {
        enclosedPairs.push({ parent: outer.name, child: inner.name });
      }
    }
  }

  const confirmBlocked = userDataItems.length > 0 && !ackUserData;

  return (
    <div className="ins-overlay ins-scope" role="dialog" aria-modal="true" aria-label="Confirm cleanup">
      <div className="ins-modal">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--ins-space-3)' }}>
          <div>
            <h2 className="ins-h1" style={{ fontSize: '1.125rem' }}>
              Reclaim {formatBytes(totalBytes)}
            </h2>
            <span className="ins-meta">
              {itemsToClean.length} {itemsToClean.length === 1 ? 'location' : 'locations'} → Recycle Bin
            </span>
          </div>
          <button className="ins-btn ins-btn--quiet" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div>
          <span className="ins-label" style={{ display: 'block', marginBottom: 'var(--ins-space-2)' }}>
            What will be moved
          </span>
          <div className="ins-well" style={{ maxHeight: '150px', overflowY: 'auto', padding: 0 }}>
            <table className="ins-table">
              <tbody>
                {itemsToClean.map(item => (
                  <tr key={item.id}>
                    <td style={{ paddingLeft: 'var(--ins-space-3)' }}>
                      <div style={{ color: 'var(--ins-mist-50)', fontSize: '0.75rem' }}>{item.name}</div>
                      <span className="ins-data" style={{ fontSize: '0.6875rem', color: 'var(--ins-mist-500)' }}>
                        {item.path}
                      </span>
                    </td>
                    <td className="ins-num ins-data" style={{ width: '80px', fontSize: '0.75rem' }}>
                      {item.formattedSize}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {enclosedPairs.length > 0 && (
          <div className="ins-note ins-note--warn" style={{ alignItems: 'flex-start' }}>
            <FolderTree size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              {enclosedPairs.slice(0, 2).map((p, i) => (
                <span key={i} style={{ display: 'block' }}>
                  “{p.parent}” already contains “{p.child}”.
                </span>
              ))}
              Removing the parent removes the nested folder with it.
            </span>
          </div>
        )}

        {userDataItems.length > 0 && (
          <div
            className="ins-note ins-note--error"
            style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--ins-space-2)' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
              <ShieldAlert size={15} /> {userDataItems.length} of these hold your data, not cache
            </span>
            <span style={{ color: 'var(--ins-mist-300)' }}>
              These can contain chat history, session keys, MCP configs, vector indexes or downloaded model
              weights. They do not rebuild themselves — recovery depends on your Recycle Bin.
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ins-mist-50)' }}>
              <input type="checkbox" checked={ackUserData} onChange={e => setAckUserData(e.target.checked)} />
              I understand, continue anyway
            </label>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-2)' }}>
          <label className={`ins-choice${createRestorePoint ? ' ins-choice--on' : ''}`}>
            <input type="radio" name="restorePoint" checked={createRestorePoint} onChange={() => setCreateRestorePoint(true)} />
            <span>
              <strong style={{ display: 'block', color: 'var(--ins-mist-50)' }}>Record a restore point first</strong>
              <span className="ins-meta">Writes down exactly what was removed and from where.</span>
            </span>
          </label>
          <label className={`ins-choice${!createRestorePoint ? ' ins-choice--on' : ''}`}>
            <input type="radio" name="restorePoint" checked={!createRestorePoint} onChange={() => setCreateRestorePoint(false)} />
            <span>
              <strong style={{ display: 'block', color: 'var(--ins-mist-50)' }}>Skip the record</strong>
              <span className="ins-meta">Items still go to the Recycle Bin, just without a written list.</span>
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ins-space-2)', justifyContent: 'flex-end' }}>
          <button className="ins-btn ins-btn--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ins-btn ins-btn--primary"
            disabled={confirmBlocked}
            onClick={() => onConfirmClean(createRestorePoint)}
            title={confirmBlocked ? 'Acknowledge the warning above to continue' : undefined}
          >
            Move {itemsToClean.length} to Recycle Bin
          </button>
        </div>
      </div>
    </div>
  );
};
