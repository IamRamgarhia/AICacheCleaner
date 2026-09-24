import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpCircle, HardDrive, Loader2, Trash2 } from 'lucide-react';
import { formatBytes } from '../lib/format';

interface Status {
  drives: { root: string; freeBytes: number; totalBytes: number }[];
  recycleBin: Record<string, { bytes: number; usedBytes: number; off: boolean }> | null;
  scan: { running: boolean; phase: string; done: number; total: number };
  lastScanAt: number | null;
  version: string;
}

interface StatusBarProps {
  engineError: string | null;
  onRetry: () => void;
  threshold: { totalGb: number; limitGb: number } | null;
  onThresholdClick: () => void;
  update: { latestVersion?: string } | null;
  onUpdateClick: () => void;
}

/**
 * Always-visible machine state along the bottom of the window — the desktop
 * equivalent of the banners that used to push page content down.
 */
export const StatusBar: React.FC<StatusBarProps> = ({ engineError, onRetry, threshold, onThresholdClick, update, onUpdateClick }) => {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      let next = 20_000;
      try {
        const res = await fetch('http://127.0.0.1:3333/api/status');
        const data: Status = await res.json();
        if (!alive) return;
        setStatus(data);
        setOffline(false);
        if (data.scan.running) next = 1_500;
      } catch {
        if (alive) setOffline(true);
        next = 5_000;
      }
      if (alive) timer = setTimeout(poll, next);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const scan = status?.scan;
  const down = offline || Boolean(engineError);

  return (
    <footer className="ins-statusbar" role="status">
      <span className={`ins-sb-item ${down ? 'is-bad' : ''}`} title={engineError ?? undefined}>
        <span className={`ins-sb-dot ${down ? 'is-bad' : 'is-ok'}`} />
        {down ? (
          <>Engine offline <button className="ins-sb-link" onClick={onRetry}>Retry</button></>
        ) : scan?.running ? (
          <><Loader2 size={11} className="spin" /> Scanning · {scan.phase}{scan.total ? ` ${scan.done}/${scan.total}` : ''}</>
        ) : status?.lastScanAt ? (
          <>Scanned {new Date(status.lastScanAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
        ) : (
          <>Ready</>
        )}
      </span>

      {status?.drives.map(d => {
        const low = d.freeBytes / d.totalBytes < 0.1;
        return (
          <span key={d.root} className={`ins-sb-item ${low ? 'is-warn' : ''}`} title={`${d.root} ${formatBytes(d.freeBytes)} free of ${formatBytes(d.totalBytes)}`}>
            <HardDrive size={11} /> {d.root.replace(/\\$/, '')} {formatBytes(d.freeBytes)} free
          </span>
        );
      })}

      {status?.recycleBin && Object.entries(status.recycleBin).slice(0, 1).map(([drive, b]) => (
        <span key={drive} className="ins-sb-item" title="Space left in the Recycle Bin — deletes that would not fit are refused">
          <Trash2 size={11} /> Bin {drive} {b.off ? 'off' : `${formatBytes(Math.max(0, b.bytes * 0.9 - b.usedBytes))} room`}
        </span>
      ))}

      <span className="ins-sb-fill" />

      {threshold && (
        <button className="ins-sb-item ins-sb-link is-warn" onClick={onThresholdClick} title="Over your alert threshold (Settings)">
          <AlertTriangle size={11} /> {threshold.totalGb.toFixed(1)} GB tracked · over {threshold.limitGb} GB
        </button>
      )}
      {update?.latestVersion && (
        <button className="ins-sb-item ins-sb-link is-accent" onClick={onUpdateClick}>
          <ArrowUpCircle size={11} /> Update {update.latestVersion} available
        </button>
      )}
      <span className="ins-sb-item ins-meta">v{status?.version ?? '—'}</span>
    </footer>
  );
};
