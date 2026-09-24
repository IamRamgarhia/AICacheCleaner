import React, { useEffect, useState } from 'react';
import { Terminal, Play, Eye, Copy, Check, AlertTriangle } from 'lucide-react';
import { confirmDialog } from '../lib/native';

interface Cmd {
  id: string;
  tool: string;
  label: string;
  manual: string;
  note: string;
  canRun: boolean;
  available: boolean;
}

interface Result {
  ok: boolean;
  output: string;
  command: string;
}

/**
 * Cleanup that a tool has to do for itself.
 *
 * Docker keeps every image, container and volume inside one ~55 GB virtual
 * disk. Deleting that file destroys the lot, and `docker system prune` frees
 * space *inside* it without shrinking the file. Package managers own their
 * cache formats the same way. So these are commands, not paths — previewed
 * first, with the exact command shown so it can be run by hand instead.
 */
export const ReclaimCommands: React.FC = () => {
  const [commands, setCommands] = useState<Cmd[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://127.0.0.1:3333/api/reclaim-commands')
      .then(r => r.json())
      .then(d => setCommands(d.commands || []))
      .catch(e => console.warn('Could not load cleanup commands:', e.message));
  }, []);

  const exec = async (id: string, mode: 'preview' | 'run') => {
    // These deletions bypass the Recycle Bin (the tool removes its own files),
    // so every run is confirmed with exactly what will execute.
    const cmd = commands.find(c => c.id === id);
    if (mode === 'run' && cmd && !(await confirmDialog({
      title: `${cmd.tool} cleanup`,
      message: `Run "${cmd.manual}"?`,
      detail: `${cmd.note}\n\nThis is done by ${cmd.tool} itself and does NOT go to the Recycle Bin. Use Preview first to see what it covers.`,
      confirmLabel: 'Run cleanup',
      danger: true
    }))) return;
    setBusy(`${id}:${mode}`);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/reclaim-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, mode })
      });
      const data: Result = await res.json();
      setResults(prev => ({ ...prev, [id]: data }));
    } catch (e) {
      setResults(prev => ({ ...prev, [id]: { ok: false, output: (e as Error).message, command: '' } }));
    } finally {
      setBusy(null);
    }
  };

  const copy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const available = commands.filter(c => c.available);
  if (available.length === 0) return null;

  return (
    <div className="ins-panel" style={{ padding: 'var(--ins-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-4)' }}>
      <div>
        <span className="ins-label">
          <Terminal size={12} style={{ verticalAlign: '-1px', marginRight: '5px' }} />
          Cleanup the tool has to do itself
        </span>
        <p className="ins-sub" style={{ marginTop: '4px' }}>
          Some space can&apos;t be freed by deleting a folder. Preview shows exactly what would go, and the
          command is there to run yourself if you&apos;d rather.
        </p>
      </div>

      <div className="ins-grid">
        {available.map(c => {
          const r = results[c.id];
          return (
            <div key={c.id} className="ins-card">
              <div>
                <div className="ins-card-title">{c.tool}</div>
                <span className="ins-meta">{c.label}</span>
              </div>

              <div
                className="ins-well ins-data"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}
              >
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{c.manual}</span>
                <button
                  className="ins-btn ins-btn--quiet"
                  onClick={() => copy(c.id, c.manual)}
                  aria-label="Copy command"
                  style={{ flexShrink: 0 }}
                >
                  {copied === c.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>

              <p className="ins-meta" style={{ lineHeight: 1.5 }}>{c.note}</p>

              {r && (
                <div className={`ins-note ${r.ok ? 'ins-note--ok' : 'ins-note--warn'}`} style={{ alignItems: 'flex-start' }}>
                  {!r.ok && <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />}
                  <pre
                    className="ins-data"
                    style={{ margin: 0, fontSize: '0.6875rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '160px', overflowY: 'auto' }}
                  >
                    {r.output}
                  </pre>
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--ins-space-2)', marginTop: 'auto' }}>
                <button className="ins-btn" disabled={!!busy} onClick={() => exec(c.id, 'preview')}>
                  <Eye size={13} /> {busy === `${c.id}:preview` ? 'Checking…' : 'Preview'}
                </button>
                {c.canRun ? (
                  <button
                    className="ins-btn ins-btn--primary"
                    style={{ marginLeft: 'auto' }}
                    disabled={!!busy}
                    onClick={() => exec(c.id, 'run')}
                  >
                    <Play size={13} /> {busy === `${c.id}:run` ? 'Running…' : 'Run cleanup'}
                  </button>
                ) : (
                  <span className="ins-meta" style={{ marginLeft: 'auto', alignSelf: 'center' }}>Run it yourself as administrator</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
