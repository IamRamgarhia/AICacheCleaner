import React, { useEffect, useState } from 'react';
import type { SnapshotItem } from '../types';
import { RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface HistoryTabProps {
  snapshots: SnapshotItem[];
  onRestoreSnapshot?: (snapshotId: string, customDestinationPath?: string) => void;
  onRestore?: (snapshotId: string, customDestinationPath?: string) => void;
  onOpenFolder?: (path: string) => void;
  defaultRestorePath?: string;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  snapshots,
  onRestoreSnapshot,
  onRestore,
  defaultRestorePath
}) => {
  const [customPath, setCustomPath] = useState<string>(defaultRestorePath ?? '');
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (defaultRestorePath) setCustomPath(prev => (prev ? prev : defaultRestorePath));
  }, [defaultRestorePath]);

  const handleRestore = async (snapId: string) => {
    setRestoring(true);
    setMessage(null);
    try {
      if (onRestoreSnapshot) await onRestoreSnapshot(snapId, customPath);
      else if (onRestore) await onRestore(snapId, customPath);
      setMessage({ ok: true, text: `Restore requested for ${snapId}.` });
    } catch (e) {
      setMessage({ ok: false, text: `Could not restore ${snapId}: ${(e as Error).message}` });
    } finally {
      setRestoring(false);
      setTimeout(() => setMessage(null), 8000);
    }
  };

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Restore points</h1>
          <p className="ins-sub">
            A record is written before every clean. Restoring moves the files back out of the Recycle
            Bin to where they came from — you don't have to dig through it yourself.
          </p>
        </div>
        <span className="ins-meta ins-data">{snapshots.length} recorded</span>
      </header>

      {message && (
        <div className={`ins-note ${message.ok ? 'ins-note--ok' : 'ins-note--error'}`}>
          {message.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {message.text}
        </div>
      )}

      <div className="ins-panel" style={{ padding: 'var(--ins-space-4)' }}>
        <label className="ins-field-label" htmlFor="restore-dest">
          Restore destination
        </label>
        <input
          id="restore-dest"
          className="ins-input"
          type="text"
          value={customPath}
          placeholder="Leave blank to restore to the original location"
          onChange={e => setCustomPath(e.target.value)}
        />
      </div>

      {snapshots.length === 0 ? (
        <div className="ins-empty">
          <strong>No restore points yet</strong>
          One is written automatically the first time you clean something.
        </div>
      ) : (
        <div className="ins-grid">
          {snapshots.map(snap => (
            <div key={snap.snapshotId} className="ins-card">
              <div>
                <div className="ins-card-title ins-data" style={{ fontSize: '0.8125rem' }}>
                  {snap.snapshotId}
                </div>
                <span className="ins-meta">{snap.timestamp}</span>
              </div>

              <div className="ins-well" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{snap.itemCount} items</span>
                <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>{snap.formattedSize}</span>
              </div>

              <button
                className="ins-btn"
                disabled={restoring}
                onClick={() => handleRestore(snap.snapshotId)}
                style={{ justifyContent: 'center', marginTop: 'auto' }}
              >
                <RotateCcw size={14} /> {restoring ? 'Restoring…' : 'Restore these files'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
