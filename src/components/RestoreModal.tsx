import React from 'react';
import type { SnapshotItem } from '../types';
import { RotateCcw, X, ShieldCheck } from 'lucide-react';

interface RestoreModalProps {
  snapshots: SnapshotItem[];
  isOpen: boolean;
  onClose: () => void;
}

export const RestoreModal: React.FC<RestoreModalProps> = ({ snapshots, isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="glass-card" style={{ width: '90%', maxWidth: '600px', padding: '24px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RotateCcw size={20} color="#10b981" /> Safety Restore Point Snapshots
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '20px' }}>
          Every cleaning action creates an automatic snapshot. You can also restore soft-deleted items from your OS Recycle Bin anytime.
        </p>

        {snapshots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px' }}>
            No snapshots created yet. Snapshots will appear automatically whenever a clean operation is performed.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '350px', overflowY: 'auto' }}>
            {snapshots.map(snap => (
              <div key={snap.snapshotId} className="glass-card" style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 700, color: '#f3f4f6' }}>{snap.snapshotId}</span>
                  <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>{snap.formattedSize} ({snap.itemCount} items)</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '12px' }}>Created: {snap.timestamp}</div>
                <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', padding: '8px', fontSize: '0.85rem' }}>
                  <ShieldCheck size={14} color="#10b981" /> Undo & Restore All Items
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
