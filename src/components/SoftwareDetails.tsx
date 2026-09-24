import React, { useState } from 'react';
import type { AISoftwareAppItem } from '../types';
import { Check, Copy, FolderOpen, Trash2, X, Zap, ArrowRight } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { formatBytes } from '../lib/format';
import { statusOf } from '../lib/softwareStatus';

interface SoftwareDetailsProps {
  item: AISoftwareAppItem;
  onClose: () => void;
  onOpenFolder?: (path: string) => void;
  onStop: (pid: number) => void;
  onClean: (item: AISoftwareAppItem) => void;
  onNavigate?: (tab: string) => void;
}

const INFO_ONLY: Record<string, string> = {
  model: 'A model on disk. Remove it with the tool that downloaded it (command below when known) so nothing that still uses it breaks.',
  'ai-feature': 'An app with AI built in. Shown so you can see its size; manage it from the app itself.',
  toolchain: 'Shown for information. AI tools and other apps rely on it, so it can’t be removed from here.',
  package: 'Installed by or for AI tools. Remove it with its own command below if you no longer need it.'
};

/** Everything known about one installed tool, beside the list. */
export const SoftwareDetails: React.FC<SoftwareDetailsProps> = ({ item, onClose, onOpenFolder, onStop, onClean, onNavigate }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const status = statusOf(item);
  const running = item.status === 'ACTIVE IN RAM';
  const group = item.group ?? 'ai';
  // Stopping one process of a many-process app (Chrome, Claude) achieves
  // nothing useful and can lose work; those are closed from the app itself.
  const canStop = group === 'ai' && running && !!item.pid && (item.processCount ?? 1) <= 1;

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <aside className="ins-details" aria-label={`Details for ${item.name}`}>
      <div className="ins-details-head">
        <span className="ins-appcell">
          <AppIcon name={item.name} category={item.category} iconPath={item.iconPath} iconDataUrl={item.iconDataUrl} large />
          <span style={{ minWidth: 0 }}>
            <strong className="ins-details-title" style={{ display: 'block' }}>{item.name}</strong>
            <span className="ins-meta">{item.category}</span>
          </span>
        </span>
        <button className="ins-btn ins-btn--quiet ins-btn--icon" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="ins-details-body">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ins-space-3)', flexWrap: 'wrap' }}>
          <span className="ins-data" style={{ fontSize: '1.5rem', fontWeight: 600 }}>{item.totalDiskSizeBytes > 0 ? item.formattedDiskSize : '—'}</span>
          <span className={`ins-status ins-status--${status.tone}`}>{status.label}</span>
        </div>

        <dl className="ins-kv">
          {item.version && (<><dt>Version</dt><dd>{item.version}</dd></>)}
          {item.publisher && (<><dt>Publisher</dt><dd>{item.publisher}</dd></>)}
          {running && (
            <>
              <dt>Memory</dt>
              <dd className="ins-data">
                {formatBytes((item.ramMb ?? 0) * 1024 * 1024)}
                {item.processCount && item.processCount > 1 ? ` across ${item.processCount} processes` : item.pid ? ` · PID ${item.pid}` : ''}
              </dd>
            </>
          )}
        </dl>

        <p className="ins-details-text">{item.description}</p>
        {INFO_ONLY[group] && <p className="ins-details-text ins-meta">{INFO_ONLY[group]}</p>}

        {(item.id === 'tc-docker' || item.id === 'tc-wsl') && onNavigate && (
          <button className="ins-btn" onClick={() => onNavigate('DOCKER_WSL')} style={{ alignSelf: 'flex-start' }}>
            See images, containers and WSL disks <ArrowRight size={13} />
          </button>
        )}

        {item.detectionPaths.length > 0 && (
          <section>
            <span className="ins-label">Where it is</span>
            {item.detectionPaths.map(p => (
              <div key={p} className="ins-pathrow ins-selectable">
                <span>{p}</span>
                {onOpenFolder && (
                  <button className="ins-btn ins-btn--quiet ins-btn--icon" onClick={() => onOpenFolder(p)} aria-label={`Open ${p}`} title="Open in Explorer">
                    <FolderOpen size={13} />
                  </button>
                )}
                <button className="ins-btn ins-btn--quiet ins-btn--icon" onClick={() => copy(p, p)} aria-label="Copy path" title="Copy path">
                  {copied === p ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            ))}
          </section>
        )}

        {item.children && item.children.length > 0 && (
          <section>
            <span className="ins-label">Includes</span>
            <ul className="ins-inside">
              {item.children.map(c => (
                <li key={c.name} title={c.path ?? c.name}>
                  <span className="ins-inside-name">{c.name}</span>
                  <span className="ins-meta">{c.detail}</span>
                  <span className="ins-data ins-inside-size">{c.sizeBytes ? formatBytes(c.sizeBytes) : ''}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.manualCommand && (
          <section>
            <span className="ins-label">Remove it with its own tool</span>
            <div className="ins-pathrow ins-selectable">
              <span className="ins-code">{item.manualCommand}</span>
              <button className="ins-btn ins-btn--quiet ins-btn--icon" onClick={() => copy('cmd', item.manualCommand!)} aria-label="Copy command">
                {copied === 'cmd' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </section>
        )}
      </div>

      <div className="ins-details-actions">
        {onOpenFolder && item.detectionPaths[0] && (
          <button className="ins-btn" onClick={() => onOpenFolder(item.detectionPaths[0])}>
            <FolderOpen size={13} /> Open folder
          </button>
        )}
        {canStop && (
          <button className="ins-btn" onClick={() => onStop(item.pid!)}>
            <Zap size={13} /> Stop
          </button>
        )}
        {item.canUninstall && (
          <button className="ins-btn" style={{ marginLeft: 'auto' }} onClick={() => onClean(item)}>
            <Trash2 size={13} /> Clean or remove…
          </button>
        )}
      </div>
    </aside>
  );
};
