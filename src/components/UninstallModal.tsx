import React, { useEffect, useState } from 'react';
import type { AISoftwareAppItem } from '../types';
import { X, ShieldCheck } from 'lucide-react';

interface UninstallModalProps {
  software: AISoftwareAppItem | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmPurge: (softwareId: string, purgeMode: 'CACHE_ONLY' | 'FULL_UNINSTALL', createRestorePoint: boolean) => void;
}

export const UninstallModal: React.FC<UninstallModalProps> = ({ software, isOpen, onClose, onConfirmPurge }) => {
  // Hooks run before any early return — see Rules of Hooks.
  const [purgeMode, setPurgeMode] = useState<'CACHE_ONLY' | 'FULL_UNINSTALL'>('CACHE_ONLY');
  const [processing, setProcessing] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) setPurgeMode('CACHE_ONLY');
  }, [isOpen]);

  // Escape closes. A modal you can't dismiss from the keyboard is a trap.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !software) return null;

  const handleExecute = async () => {
    setProcessing(true);
    try {
      await onConfirmPurge(software.id, purgeMode, true);
      onClose();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="ins-overlay ins-scope" role="dialog" aria-modal="true" aria-label={`Clean or remove ${software.name}`}>
      <div className="ins-modal">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--ins-space-3)' }}>
          <div>
            <h2 className="ins-h1" style={{ fontSize: '1.125rem' }}>{software.name}</h2>
            <span className="ins-meta">
              {software.formattedDiskSize} on disk ·{' '}
              {software.status === 'ACTIVE IN RAM' ? 'running now' : 'not running'}
            </span>
          </div>
          <button className="ins-btn ins-btn--quiet" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div>
          <span className="ins-label" style={{ display: 'block', marginBottom: 'var(--ins-space-2)' }}>
            Detected locations
          </span>
          <div className="ins-well ins-data" style={{ fontSize: '0.6875rem', maxHeight: '96px', overflowY: 'auto' }}>
            {software.detectionPaths.map(p => (
              <div key={p} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-2)' }}>
          <label className={`ins-choice${purgeMode === 'CACHE_ONLY' ? ' ins-choice--on' : ''}`}>
            <input
              type="radio"
              name="purgeMode"
              checked={purgeMode === 'CACHE_ONLY'}
              onChange={() => setPurgeMode('CACHE_ONLY')}
            />
            <span>
              <strong style={{ display: 'block', color: 'var(--ins-mist-50)' }}>Clean caches only</strong>
              <span className="ins-meta">
                Moves this tool&apos;s auto-rebuilding caches to the Recycle Bin. Chat history, settings and
                model weights are left alone, and the app stays installed.
              </span>
            </span>
          </label>

          <label className={`ins-choice${purgeMode === 'FULL_UNINSTALL' ? ' ins-choice--on' : ''}`}>
            <input
              type="radio"
              name="purgeMode"
              checked={purgeMode === 'FULL_UNINSTALL'}
              onChange={() => setPurgeMode('FULL_UNINSTALL')}
            />
            <span>
              <strong style={{ display: 'block', color: 'var(--ins-mist-50)' }}>Open Windows uninstaller</strong>
              <span className="ins-meta">
                Records a restore point, then opens Add/Remove Programs so Windows removes the application
                itself. Nothing is deleted by AICacheCleaner.
              </span>
            </span>
          </label>
        </div>

        <div className="ins-note ins-note--ok">
          <ShieldCheck size={15} /> A restore point is recorded first, every time.
        </div>

        <div style={{ display: 'flex', gap: 'var(--ins-space-2)', justifyContent: 'flex-end' }}>
          <button className="ins-btn ins-btn--quiet" onClick={onClose} disabled={processing}>
            Cancel
          </button>
          <button className="ins-btn ins-btn--primary" disabled={processing} onClick={handleExecute}>
            {processing
              ? 'Working…'
              : purgeMode === 'FULL_UNINSTALL'
              ? 'Record & open uninstaller'
              : 'Record & clean caches'}
          </button>
        </div>
      </div>
    </div>
  );
};
