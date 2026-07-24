import React, { useState } from 'react';
import type { AICacheItem } from '../types';
import { AlertTriangle, ShieldCheck, Trash2, X, FolderOpen, CheckCircle2 } from 'lucide-react';

interface PreDeleteModalProps {
  isOpen: boolean;
  itemsToClean: AICacheItem[];
  onConfirmClean: (createRestorePoint: boolean) => void;
  onCancel: () => void;
}

export const PreDeleteModal: React.FC<PreDeleteModalProps> = ({
  isOpen,
  itemsToClean,
  onConfirmClean,
  onCancel
}) => {
  const [createRestorePoint, setCreateRestorePoint] = useState<boolean>(true);

  if (!isOpen) return null;

  const totalBytes = itemsToClean.reduce((acc, i) => acc + i.sizeBytes, 0);

  const formatBytesLocal = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

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
      zIndex: 3000,
      padding: '20px'
    }}>
      <div className="glass-card" style={{ maxWidth: '580px', width: '100%', padding: '24px', border: '1px solid var(--border-glow)', borderRadius: '20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={22} color="#fbbf24" /> Pre-Deletion Safety Confirmation
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '2px' }}>
              You are about to clean <strong style={{ color: '#00f2fe' }}>{itemsToClean.length} items</strong> (<strong style={{ color: '#34d399' }}>{formatBytesLocal(totalBytes)}</strong>).
            </p>
          </div>

          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* ITEMIZED SHORT LIST OF FILES BEING DELETED */}
        <div style={{ marginBottom: '18px' }}>
          <label style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
            Items Selected for Cleanup ({itemsToClean.length}):
          </label>

          <div style={{
            maxHeight: '160px',
            overflowY: 'auto',
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '10px',
            padding: '10px',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {itemsToClean.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.03)', padding: '8px 10px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <CheckCircle2 size={14} color="#34d399" style={{ flexShrink: 0 }} />
                  <span style={{ color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    [{item.category}] {item.name}
                  </span>
                </div>
                <span style={{ color: '#34d399', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0, marginLeft: '8px' }}>
                  {item.formattedSize}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* RESTORE POINT CHOICE */}
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ fontSize: '0.88rem', color: '#fff', display: 'block', marginBottom: '10px' }}>
            Would you like to create a Safety Restore Point before deleting?
          </strong>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px',
              background: createRestorePoint ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
              border: createRestorePoint ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
              borderRadius: '10px',
              fontSize: '0.85rem',
              color: '#fff',
              cursor: 'pointer'
            }}>
              <input
                type="radio"
                name="restorePoint"
                checked={createRestorePoint}
                onChange={() => setCreateRestorePoint(true)}
              />
              <ShieldCheck size={18} color="#34d399" />
              <span>
                <strong style={{ color: '#34d399' }}>Yes, Create Safety Restore Point</strong> (Recommended — Allows 1-click restore anytime)
              </span>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px',
              background: !createRestorePoint ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
              border: !createRestorePoint ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-color)',
              borderRadius: '10px',
              fontSize: '0.85rem',
              color: '#d1d5db',
              cursor: 'pointer'
            }}>
              <input
                type="radio"
                name="restorePoint"
                checked={!createRestorePoint}
                onChange={() => setCreateRestorePoint(false)}
              />
              <Trash2 size={16} color="#f87171" />
              <span>No, Soft-Delete Directly to Windows Recycle Bin</span>
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '10px 18px' }}>
            Cancel
          </button>

          <button
            className="btn-primary"
            onClick={() => onConfirmClean(createRestorePoint)}
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)',
              padding: '10px 22px',
              fontWeight: 800
            }}
          >
            Confirm & Clean {itemsToClean.length} Items
          </button>
        </div>
      </div>
    </div>
  );
};
