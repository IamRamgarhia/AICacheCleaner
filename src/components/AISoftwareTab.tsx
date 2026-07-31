import React, { useState, useEffect } from 'react';
import type { AIProcessItem, AISoftwareAppItem } from '../types';
import { RefreshCw, AlertTriangle, CheckCircle2, Zap, Trash2 } from 'lucide-react';
import { UninstallModal } from './UninstallModal';
import { toolColor } from '../lib/toolColors';

interface AISoftwareTabProps {
  processes: AIProcessItem[];
  onKillProcess: (pid: number) => void;
  onOpenFolder?: (path: string) => void;
}

export const AISoftwareTab: React.FC<AISoftwareTabProps> = ({ onKillProcess }) => {
  const [softwareList, setSoftwareList] = useState<AISoftwareAppItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AISoftwareAppItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchSoftware = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/software');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setSoftwareList(data.software || []);
    } catch (e) {
      setLoadError(`Could not scan installed software: ${(e as Error).message}`);
      setSoftwareList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSoftware();
  }, []);

  const detected = softwareList.filter(s => s.status !== 'NOT INSTALLED');

  const handleConfirmPurge = async (
    softwareId: string,
    purgeMode: 'CACHE_ONLY' | 'FULL_UNINSTALL',
    createRestorePoint: boolean
  ) => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/purge-software', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ softwareId, purgeMode, createRestorePoint })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server returned ${res.status}`);
      setActionMsg({ ok: data.success !== false, text: data.message });
      fetchSoftware();
    } catch (e) {
      setActionMsg({ ok: false, text: `Could not complete that: ${(e as Error).message}` });
    }
    setTimeout(() => setActionMsg(null), 8000);
  };

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Installed AI tools</h1>
          <p className="ins-sub">
            AI software found on this machine, whether running, installed, or left behind after an
            uninstall. Cleaning here removes only auto-rebuilding caches — never chat history.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ins-space-2)', alignItems: 'center' }}>
          <span className="ins-meta ins-data">{detected.length} found</span>
          <button className="ins-btn" onClick={fetchSoftware} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Scanning' : 'Rescan'}
          </button>
        </div>
      </header>

      {actionMsg && (
        <div className={`ins-note ${actionMsg.ok ? 'ins-note--ok' : 'ins-note--error'}`}>
          {actionMsg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {actionMsg.text}
        </div>
      )}

      {loadError && (
        <div className="ins-note ins-note--error">
          <AlertTriangle size={15} /> {loadError}
        </div>
      )}

      {!loading && detected.length === 0 && !loadError ? (
        <div className="ins-empty">
          <strong>No AI tools detected</strong>
          None of the supported tools were found in their standard install locations.
        </div>
      ) : (
        <div className="ins-grid">
          {detected.map(sw => {
            const isRunning = sw.status === 'ACTIVE IN RAM';
            return (
              <div key={sw.id} className="ins-card ins-card--tool" style={{ borderLeftColor: toolColor(sw.name) }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ins-space-2)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ins-card-title ins-tool-name"><span className="ins-dot" style={{ background: toolColor(sw.name) }} />{sw.name}</div>
                    <span className="ins-meta">
                      {sw.category}
                      {sw.version ? ` · ${sw.version}` : ''}
                    </span>
                  </div>
                  <span className={`ins-tier ${isRunning ? 'ins-tier--safe' : 'ins-tier--review'}`}>
                    {isRunning ? 'Running' : sw.status === 'INSTALLED ON DISK' ? 'Installed' : 'Left behind'}
                  </span>
                </div>

                <p className="ins-meta" style={{ lineHeight: 1.5 }}>{sw.description}</p>

                <div className="ins-well">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span>On disk</span>
                    <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>{sw.formattedDiskSize}</span>
                  </div>
                  {isRunning && sw.pid && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>PID {sw.pid}</span>
                      <span className="ins-data">{sw.ramMb} MB · {sw.cpuPercent}%</span>
                    </div>
                  )}
                  {sw.detectionPaths.slice(0, 2).map(p => (
                    <div key={p} className="ins-data" style={{ fontSize: '0.6875rem', color: 'var(--ins-mist-500)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 'var(--ins-space-2)', marginTop: 'auto' }}>
                  {isRunning && sw.pid && (
                    <button className="ins-btn ins-btn--quiet" onClick={() => onKillProcess(sw.pid!)}>
                      <Zap size={13} /> Stop
                    </button>
                  )}
                  <button
                    className="ins-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                      setSelected(sw);
                      setIsModalOpen(true);
                    }}
                  >
                    <Trash2 size={13} /> Clean or remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <UninstallModal
        software={selected}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirmPurge={handleConfirmPurge}
      />
    </div>
  );
};
