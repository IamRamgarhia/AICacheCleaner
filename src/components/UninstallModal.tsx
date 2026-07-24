import React, { useState } from 'react';
import type { AISoftwareAppItem } from '../types';
import { Trash2, Sparkles, ShieldCheck, AlertTriangle, X, CheckCircle2, Folder, Cpu, HardDrive } from 'lucide-react';

interface UninstallModalProps {
  software: AISoftwareAppItem | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmPurge: (softwareId: string, purgeMode: 'CACHE_ONLY' | 'FULL_UNINSTALL', createRestorePoint: boolean) => void;
}

export const UninstallModal: React.FC<UninstallModalProps> = ({ software, isOpen, onClose, onConfirmPurge }) => {
  if (!isOpen || !software) return null;

  const [purgeMode, setPurgeMode] = useState<'CACHE_ONLY' | 'FULL_UNINSTALL'>('CACHE_ONLY');
  const [createRestorePoint, setCreateRestorePoint] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);

  const handleExecute = async () => {
    setProcessing(true);
    try {
      await onConfirmPurge(software.id, purgeMode, createRestorePoint);
      onClose();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(5, 8, 15, 0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div className="glass-card" style={{
        width: '100%',
        maxWidth: '580px',
        background: '#0d1322',
        border: '1px solid rgba(0, 242, 254, 0.3)',
        borderRadius: '20px',
        padding: '28px',
        boxShadow: '0 0 40px rgba(0, 242, 254, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span style={{ fontSize: '0.74rem', color: '#00f2fe', background: 'rgba(0, 242, 254, 0.1)', padding: '3px 10px', borderRadius: '6px', fontWeight: 700 }}>
              SOFTWARE PURGE & CLEANUP ASSISTANT
            </span>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ffffff', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Trash2 size={24} color="#f87171" /> {software.name}
            </h2>
          </div>

          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Footprint & Detection Overview */}
        <div style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '16px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.78rem', color: '#9ca3af', display: 'block' }}>Total Software & Cache Footprint:</span>
            <strong style={{ fontSize: '1.5rem', color: '#00f2fe', fontWeight: 800 }}>{software.formattedDiskSize}</strong>
          </div>

          <span className={`badge ${software.status === 'ACTIVE IN RAM' ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: '0.78rem' }}>
            {software.status}
          </span>
        </div>

        {/* Detected Folder Paths */}
        <div>
          <label style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
            Detected Installed & Residual Paths on PC:
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
            {software.detectionPaths.map(p => (
              <div key={p} style={{ fontSize: '0.76rem', color: '#60a5fa', fontFamily: 'monospace', background: 'rgba(255, 255, 255, 0.03)', padding: '6px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Folder size={13} color="#00f2fe" />
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Mode Radio Selection */}
        <div>
          <label style={{ fontSize: '0.82rem', color: '#ffffff', fontWeight: 700, display: 'block', marginBottom: '10px' }}>
            Select Action Mode:
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '14px',
              background: purgeMode === 'CACHE_ONLY' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0, 0, 0, 0.2)',
              border: purgeMode === 'CACHE_ONLY' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
              borderRadius: '12px',
              cursor: 'pointer'
            }}>
              <input
                type="radio"
                name="purgeMode"
                checked={purgeMode === 'CACHE_ONLY'}
                onChange={() => setPurgeMode('CACHE_ONLY')}
                style={{ marginTop: '2px' }}
              />
              <div>
                <strong style={{ fontSize: '0.9rem', color: '#34d399', display: 'block' }}>
                  🧹 Clean Caches & Model Weights Only (Keep App Executable)
                </strong>
                <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                  Frees up disk space by clearing temporary cache, logs, and downloaded weights while keeping the software installed.
                </span>
              </div>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '14px',
              background: purgeMode === 'FULL_UNINSTALL' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 0, 0, 0.2)',
              border: purgeMode === 'FULL_UNINSTALL' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border-color)',
              borderRadius: '12px',
              cursor: 'pointer'
            }}>
              <input
                type="radio"
                name="purgeMode"
                checked={purgeMode === 'FULL_UNINSTALL'}
                onChange={() => setPurgeMode('FULL_UNINSTALL')}
                style={{ marginTop: '2px' }}
              />
              <div>
                <strong style={{ fontSize: '0.9rem', color: '#f87171', display: 'block' }}>
                  🖥️ Open Windows Native Uninstaller (Control Panel / Settings)
                </strong>
                <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                  Creates a Safety Restore Point first, then opens Windows Add/Remove Programs (appwiz.cpl) so Windows cleanly uninstalls the application.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Safety Restore Guarantee Checkbox */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', color: '#34d399', cursor: 'pointer', background: 'rgba(16, 185, 129, 0.08)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          <input
            type="checkbox"
            checked={true}
            readOnly
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
            <ShieldCheck size={16} /> Always creates a Safety Snapshot Restore Point FIRST before any action
          </span>
        </label>

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '6px' }}>
          <button className="btn-secondary" onClick={onClose} disabled={processing} style={{ padding: '10px 20px' }}>
            Cancel
          </button>

          <button
            className="btn-danger"
            disabled={processing}
            onClick={handleExecute}
            style={{
              padding: '10px 24px',
              fontSize: '0.9rem',
              fontWeight: 800,
              background: purgeMode === 'FULL_UNINSTALL' ? 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              boxShadow: purgeMode === 'FULL_UNINSTALL' ? '0 4px 20px rgba(255, 65, 108, 0.4)' : '0 4px 20px rgba(16, 185, 129, 0.4)'
            }}
          >
            {processing ? 'Creating Restore Point...' : purgeMode === 'FULL_UNINSTALL' ? 'Create Restore Point & Open Windows Uninstaller' : 'Create Restore Point & Clean Caches'}
          </button>
        </div>
      </div>
    </div>
  );
};
