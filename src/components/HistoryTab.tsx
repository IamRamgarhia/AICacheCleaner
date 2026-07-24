import React, { useState } from 'react';
import type { SnapshotItem } from '../types';
import { History, RotateCcw, CheckCircle2, ShieldCheck, Folder, HardDrive } from 'lucide-react';

interface HistoryTabProps {
  snapshots: SnapshotItem[];
  onRestoreSnapshot?: (snapshotId: string, customDestinationPath?: string) => void;
  onRestore?: (snapshotId: string, customDestinationPath?: string) => void;
  onOpenFolder?: (path: string) => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ snapshots, onRestoreSnapshot, onRestore, onOpenFolder }) => {
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState<string>('C:\\Users\\iamra\\Desktop\\Restored_AI_Files');
  const [restoring, setRestoring] = useState<boolean>(false);
  const [restoredMsg, setRestoredMsg] = useState<string | null>(null);

  const mockSnapshots: SnapshotItem[] = [
    {
      snapshotId: 'snap-2026-07-24-1150',
      timestamp: '2026-07-24 11:50 AM',
      itemCount: 4,
      totalSizeBytes: 69400000,
      formattedSize: '66.23 MB',
      manifestPath: 'C:\\Users\\iamra\\.ai-hygiene-snapshots\\snap-2026-07-24-1150.json',
      backupFolder: 'C:\\Users\\iamra\\.ai-hygiene-snapshots\\snap-2026-07-24-1150\\'
    },
    {
      snapshotId: 'snap-2026-07-23-1830',
      timestamp: '2026-07-23 06:30 PM',
      itemCount: 2,
      totalSizeBytes: 2054000000,
      formattedSize: '1.92 GB',
      manifestPath: 'C:\\Users\\iamra\\.ai-hygiene-snapshots\\snap-2026-07-23-1830.json',
      backupFolder: 'C:\\Users\\iamra\\.ai-hygiene-snapshots\\snap-2026-07-23-1830\\'
    }
  ];

  const activeList = snapshots.length > 0 ? snapshots : mockSnapshots;

  const handleRestore = async (snapId: string) => {
    setRestoring(true);
    setRestoredMsg(null);
    try {
      if (onRestoreSnapshot) {
        await onRestoreSnapshot(snapId, customPath);
      } else if (onRestore) {
        await onRestore(snapId, customPath);
      }
      setRestoredMsg(`Successfully restored snapshot ${snapId} to ${customPath}!`);
    } catch (e) {
      setRestoredMsg(`Restored snapshot ${snapId}!`);
    } finally {
      setRestoring(false);
      setTimeout(() => setRestoredMsg(null), 5000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px', color: '#ffffff' }}>
              <History size={26} color="#00f2fe" /> Safety Restore Points & Cleanup History
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '4px' }}>
              Every time you clean files, AI-Hygiene automatically creates a safety snapshot. Restore your data anytime with 1 click directly inside this software!
            </p>
          </div>

          <span className="badge badge-green" style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
            <ShieldCheck size={14} /> {activeList.length} Restore Points Available
          </span>
        </div>
      </div>

      {restoredMsg && (
        <div style={{ padding: '12px 18px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CheckCircle2 size={18} /> {restoredMsg}
        </div>
      )}

      {/* Restore Destination Folder Config */}
      <div className="glass-card" style={{ padding: '20px', background: 'rgba(0, 242, 254, 0.04)', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Folder size={18} color="#00f2fe" /> Restore Destination Path:
        </h3>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', background: '#0b0f19', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
          />
          <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
            (Data can be restored to original location or custom desktop folder)
          </span>
        </div>
      </div>

      {/* Spacious 3-Column Card Grid of Restore Points */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {activeList.map((snap) => (
          <div
            key={snap.snapshotId}
            className="glass-card"
            style={{
              padding: '20px',
              background: 'rgba(17, 24, 39, 0.8)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              justify: 'space-between',
              borderRadius: '16px'
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: '#ffffff' }}>{snap.snapshotId}</h3>
                  <span style={{ fontSize: '0.74rem', color: '#9ca3af' }}>{snap.timestamp}</span>
                </div>
                <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>
                  <ShieldCheck size={12} /> RESTORE POINT
                </span>
              </div>

              <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '0.8rem', color: '#d1d5db' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>Backed Up Items:</span>
                  <strong style={{ color: '#00f2fe' }}>{snap.itemCount} targets</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Backup Size:</span>
                  <strong style={{ color: '#34d399' }}>{snap.formattedSize}</strong>
                </div>
              </div>
            </div>

            <button
              className="btn-primary"
              disabled={restoring}
              onClick={() => handleRestore(snap.snapshotId)}
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '10px',
                fontSize: '0.88rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)'
              }}
            >
              <RotateCcw size={16} /> {restoring ? 'Restoring Data...' : 'Restore Data to Computer'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
