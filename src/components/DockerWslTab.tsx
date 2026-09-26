import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Container, Copy, FolderOpen, HardDrive, RefreshCw, ShieldAlert } from 'lucide-react';
import { LoadingState } from './LoadingState';
import { confirmDialog } from '../lib/native';
import { formatBytes } from '../lib/format';
import type { DockerBreakdown, DockerManualCleanup, DockerPruneKind, DockerPruneResult, DockerTypeUsage, WslListing } from '../lib/types/dockerWsl';
import { apiJson, requireArrays } from '../lib/shape';

const API = 'http://127.0.0.1:3333';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  return (await apiJson(r)) as T;
}

const PRUNE_LABEL: Record<DockerPruneKind, string> = {
  'build-cache': 'the Docker build cache',
  'dangling-images': 'dangling (untagged) Docker images'
};

const CommandWell: React.FC<{ command: string; copied: boolean; onCopy: () => void }> = ({ command, copied, onCopy }) => (
  <div className="ins-well ins-data ins-selectable" style={{ fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
    <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{command}</span>
    <button className="ins-btn ins-btn--quiet" onClick={onCopy} aria-label="Copy command">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  </div>
);

const SectionHead: React.FC<{ icon: React.ReactNode; title: string; meta: string }> = ({ icon, title, meta }) => (
  <div className="ins-section-head">
    {icon}
    <span className="ins-card-title">{title}</span>
    <span className="ins-meta">{meta}</span>
  </div>
);

const DockerTypesTable: React.FC<{
  types: DockerTypeUsage[];
  busy: DockerPruneKind | null;
  onPrune: (kind: DockerPruneKind) => void;
}> = ({ types, busy, onPrune }) => (
  <div className="ins-panel">
    <table className="ins-table">
      <thead>
        <tr>
          <th>Type</th>
          <th className="ins-num">Count</th>
          <th className="ins-num">Size</th>
          <th className="ins-num">Reclaimable</th>
          <th style={{ width: '150px' }} />
        </tr>
      </thead>
      <tbody>
        {types.map(t => (
          <tr key={t.type}>
            <td>{t.type}</td>
            <td className="ins-num ins-data">{t.count}{t.active ? <span className="ins-meta"> · {t.active} in use</span> : null}</td>
            <td className="ins-num ins-data">{formatBytes(t.sizeBytes)}</td>
            <td className="ins-num ins-data">{formatBytes(t.reclaimableBytes)}</td>
            <td className="ins-num">
              {t.pruneKind && (
                <button
                  className="ins-btn"
                  disabled={busy !== null || t.reclaimableBytes === 0}
                  onClick={() => onPrune(t.pruneKind!)}
                  title={t.pruneKind === 'dangling-images'
                    ? 'Removes untagged images only. The reclaimable figure also counts unused tagged images, which stay.'
                    : 'Rebuilt automatically by the next build that needs it.'}
                >
                  {busy === t.pruneKind ? <RefreshCw size={13} className="spin" /> : null}
                  {t.pruneKind === 'dangling-images' ? 'Clean dangling' : 'Clean'}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ManualCleanups: React.FC<{ items: DockerManualCleanup[]; copied: string | null; onCopy: (key: string, text: string) => void }> = ({ items, copied, onCopy }) => (
  <div className="ins-grid ins-grid--2col">
    {items.map(m => (
      <div key={m.id} className="ins-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ins-space-2)' }}>
          <div className="ins-card-title" style={{ flex: 1 }}>{m.label}</div>
          <span className={`ins-tier ${m.severity === 'danger' ? 'ins-tier--locked' : 'ins-tier--review'}`}>
            <ShieldAlert size={11} /> {m.severity === 'danger' ? 'Can lose data' : 'Run it yourself'}
          </span>
        </div>
        <div className={`ins-note ${m.severity === 'danger' ? 'ins-note--error' : 'ins-note--warn'}`}>
          <AlertTriangle size={14} /> {m.warning}
        </div>
        {m.commands.map(c => (
          <CommandWell key={c} command={c} copied={copied === `${m.id}:${c}`} onCopy={() => onCopy(`${m.id}:${c}`, c)} />
        ))}
      </div>
    ))}
  </div>
);

/** Where Docker and WSL space goes. Two self-rebuilding Docker cleanups; everything else is shown to run by hand. */
export const DockerWslTab: React.FC<{ onOpenFolder?: (p: string) => void }> = ({ onOpenFolder }) => {
  const [docker, setDocker] = useState<DockerBreakdown | null>(null);
  const [wsl, setWsl] = useState<WslListing | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [wslError, setWslError] = useState<string | null>(null);
  const [busy, setBusy] = useState<DockerPruneKind | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadDocker = useCallback(() => {
    setDocker(null);
    setDockerError(null);
    fetchJson<DockerBreakdown>(`${API}/api/docker/breakdown`).then(d => setDocker(requireArrays<DockerBreakdown>(d, ['types', 'manual']))).catch(e => setDockerError((e as Error).message));
  }, []);

  useEffect(() => {
    loadDocker();
    fetchJson<WslListing>(`${API}/api/wsl/distros`).then(d => setWsl(requireArrays<WslListing>(d, ['distros', 'compactSteps']))).catch(e => setWslError((e as Error).message));
  }, [loadDocker]);

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const prune = async (kind: DockerPruneKind) => {
    const ok = await confirmDialog({
      title: 'Clean Docker',
      message: `Permanently delete ${PRUNE_LABEL[kind]}?`,
      detail:
        'Docker objects do not go to the Recycle Bin — this cannot be undone. ' +
        'They are rebuilt or re-downloaded automatically the next time a build or container needs them.',
      confirmLabel: 'Clean',
      danger: true
    });
    if (!ok) return;
    setBusy(kind);
    setMsg(null);
    try {
      const r = await fetchJson<DockerPruneResult>(`${API}/api/docker/prune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind })
      });
      setMsg(r.ok
        ? {
            ok: true,
            text: `Freed ${r.reclaimed ?? 'space'} inside Docker. The virtual disk file does not shrink by itself — ` +
              'use the compact steps below to give the space back to Windows.'
          }
        : { ok: false, text: r.output });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      loadDocker();
    }
  };

  const openButton = (p: string) => onOpenFolder && (
    <button className="ins-btn ins-btn--quiet" onClick={() => onOpenFolder(p)} title={p}>
      <FolderOpen size={13} /> Open folder
    </button>
  );

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Docker &amp; WSL</h1>
          <p className="ins-sub">
            Containers and Linux distros keep everything inside a few large virtual disks. See what is inside them,
            clean what rebuilds itself, and copy the commands for the rest.
          </p>
        </div>
        <button className="ins-btn" onClick={loadDocker} disabled={(docker === null && !dockerError) || busy !== null}>
          <RefreshCw size={14} className={docker === null && !dockerError ? 'spin' : ''} /> Refresh
        </button>
      </header>

      {msg && (
        <div className={`ins-note ${msg.ok ? 'ins-note--ok' : 'ins-note--error'}`}>
          {msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.text}
        </div>
      )}

      <SectionHead icon={<Container size={15} />} title="Docker" meta="Build cache and dangling images rebuild themselves. Nothing else is deleted from here." />
      {dockerError ? (
        <div className="ins-empty"><strong>Could not read Docker usage</strong>{dockerError}</div>
      ) : docker === null ? (
        <LoadingState compact title="Asking Docker what it stores" detail="Runs docker system df — up to 20 seconds." />
      ) : (
        <>
          {docker.state === 'ok'
            ? <DockerTypesTable types={docker.types} busy={busy} onPrune={kind => void prune(kind)} />
            : <div className="ins-empty"><strong>{docker.state === 'not-installed' ? 'Docker not found' : 'Docker is not running'}</strong>{docker.message}</div>}

          {docker.disk && (
            <div className="ins-panel" style={{ padding: 'var(--ins-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ins-space-2)', flexWrap: 'wrap' }}>
                <HardDrive size={14} />
                <span className="ins-card-title" style={{ flex: 1 }}>Docker virtual disk</span>
                <span className="ins-data">{formatBytes(docker.disk.sizeBytes)}</span>
                <span className="ins-tier ins-tier--locked">Never delete</span>
              </div>
              <span className="ins-meta ins-data ins-selectable" style={{ wordBreak: 'break-all' }}>{docker.disk.path}</span>
              <p className="ins-details-text">
                This one file holds every image, container and volume. It grows but never shrinks on its own, even after a clean.
                {docker.disk.trappedBytes !== null && (
                  <> About <strong>{formatBytes(docker.disk.trappedBytes)}</strong> of it is empty space a compact returns to Windows.</>
                )}
              </p>
              <span className="ins-meta">Compact (quit Docker Desktop first, then run in PowerShell as administrator):</span>
              {docker.disk.compactCommand && (
                <CommandWell command={docker.disk.compactCommand} copied={copied === 'docker-disk'} onCopy={() => copy('docker-disk', docker.disk!.compactCommand!)} />
              )}
            </div>
          )}

          <ManualCleanups items={docker.manual} copied={copied} onCopy={copy} />
        </>
      )}

      <SectionHead icon={<HardDrive size={15} />} title="WSL distros" meta="Shown only. Each distro's disk file IS that distro — never delete it." />
      {wslError ? (
        <div className="ins-empty"><strong>Could not read WSL distros</strong>{wslError}</div>
      ) : wsl === null ? (
        <LoadingState compact title="Reading installed WSL distros" />
      ) : wsl.distros.length === 0 ? (
        <div className="ins-empty"><strong>No WSL distros found</strong>WSL is not set up on this machine.</div>
      ) : (
        <>
          <div className="ins-panel">
            <table className="ins-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>WSL</th>
                  <th className="ins-num">Disk size</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {wsl.distros.map(d => (
                  <tr key={d.id}>
                    <td>
                      {d.name}
                      {d.isDefault && <span className="ins-meta"> · default</span>}
                      {d.managedByDocker && <span className="ins-meta"> · managed by Docker Desktop</span>}
                    </td>
                    <td className="ins-data">{d.version}</td>
                    <td className="ins-num ins-data">{d.sizeBytes === null ? '—' : formatBytes(d.sizeBytes)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ins-space-2)' }}>
                        <span className="ins-meta ins-data ins-selectable" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{d.basePath}</span>
                        {openButton(d.basePath)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ins-panel" style={{ padding: 'var(--ins-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-2)' }}>
            <span className="ins-card-title">Shrinking a WSL disk</span>
            <ol className="ins-steps">{wsl.compactSteps.map(s => <li key={s}>{s}</li>)}</ol>
            {wsl.distros.filter(d => d.compactCommand && !d.managedByDocker).map(d => (
              <div key={d.id}>
                <span className="ins-meta">{d.name}</span>
                <CommandWell command={d.compactCommand!} copied={copied === `wsl:${d.id}`} onCopy={() => copy(`wsl:${d.id}`, d.compactCommand!)} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
