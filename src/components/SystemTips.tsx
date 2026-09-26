import React, { useEffect, useState } from 'react';
import { Check, Copy, FolderOpen, MonitorCog, ShieldAlert } from 'lucide-react';
import { LoadingState } from './LoadingState';

interface Tip {
  id: string;
  title: string;
  bytes: number;
  formattedSize: string;
  why: string;
  steps: string[];
  commands?: { label: string; command: string; needsAdmin: boolean }[];
  openPath?: string;
  risk: 'low' | 'medium';
}

/**
 * Windows-level space this app will not touch itself (hibernation file, update
 * leftovers, driver downloads…). Guided steps and copy-paste commands only.
 */
export const SystemTips: React.FC<{ onOpenFolder: (path: string) => void }> = ({ onOpenFolder }) => {
  const [tips, setTips] = useState<Tip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://127.0.0.1:3333/api/system-tips')
      .then(r => r.json())
      .then(d => (d.error ? setError(d.error) : setTips(d.tips || [])))
      .catch(e => setError(e.message));
  }, []);

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (error) return null;
  if (tips !== null && tips.length === 0) return null;

  return (
    <section className="ins-page" style={{ gap: 'var(--ins-space-3)' }}>
      <div className="ins-section-head">
        <MonitorCog size={15} />
        <span className="ins-card-title">Windows &amp; system</span>
        <span className="ins-meta">Space outside AI tools. The app never touches these — follow the steps yourself.</span>
      </div>

      {tips === null ? (
        <LoadingState compact title="Measuring Windows locations" />
      ) : (
        <div className="ins-grid ins-grid--2col">
          {[...tips].sort((a, b) => b.bytes - a.bytes).map(tip => (
            <div key={tip.id} className="ins-card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ins-space-2)' }}>
                <div className="ins-card-title" style={{ flex: 1 }}>{tip.title}</div>
                <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>{tip.formattedSize}</span>
              </div>
              {tip.risk === 'medium' && (
                <span className="ins-tier ins-tier--review" style={{ alignSelf: 'flex-start' }}>
                  <ShieldAlert size={11} /> Turns off a Windows feature
                </span>
              )}
              <p className="ins-details-text">{tip.why}</p>
              <ol className="ins-steps">
                {tip.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
              {tip.commands?.map((c, i) => (
                <div key={i}>
                  <span className="ins-meta">{c.label}{c.needsAdmin ? ' · run in an administrator terminal' : ''}</span>
                  <div className="ins-well ins-data ins-selectable" style={{ fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{c.command}</span>
                    <button className="ins-btn ins-btn--quiet" onClick={() => copy(`${tip.id}-${i}`, c.command)} aria-label="Copy command">
                      {copied === `${tip.id}-${i}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
              ))}
              {tip.openPath && (
                <button className="ins-btn ins-btn--quiet" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => onOpenFolder(tip.openPath!)}>
                  <FolderOpen size={13} /> Open folder
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
