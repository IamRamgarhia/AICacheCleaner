import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import type { DuplicateCopy, DuplicateGroup, DuplicateScanResult } from '../lib/types/duplicates';
import { confirmDialog } from '../lib/native';
import { toolColor } from '../lib/toolColors';
import { LoadingState } from './LoadingState';
import { apiJson, requireArrays } from '../lib/shape';

const API = 'http://127.0.0.1:3333';

interface DuplicateModelsTabProps {
  onOpenFolder?: (p: string) => void;
}

type Message = { ok: boolean; text: string } | null;

async function openFolder(folderPath: string, onOpenFolder?: (p: string) => void) {
  if (onOpenFolder) return onOpenFolder(folderPath);
  await fetch(`${API}/api/open-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  }).catch(() => undefined); // best effort, like the other tabs
}

/**
 * The same model weights stored more than once across Ollama, Hugging Face and
 * LM Studio. Only plain files can be moved to the Recycle Bin here; blobs in
 * content-addressed stores are removed with the tool's own command instead.
 */
export const DuplicateModelsTab: React.FC<DuplicateModelsTabProps> = ({ onOpenFolder }) => {
  const [data, setData] = useState<DuplicateScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/duplicate-models`);
      const body = await apiJson(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(requireArrays<DuplicateScanResult>(body, ['groups']));
    } catch (e) {
      setMessage({ ok: false, text: `Could not look for duplicate models: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const moveToBin = async (group: DuplicateGroup, copy: DuplicateCopy) => {
    const kept = group.copies.filter(c => c.id !== copy.id).map(c => `• ${c.store}: ${c.path}`).join('\n');
    const ok = await confirmDialog({
      title: 'Move duplicate to Recycle Bin',
      message: `Move this ${group.formattedSize} copy of ${copy.modelName} to the Recycle Bin?`,
      detail: `${copy.path}\n\nThese copies stay:\n${kept}\n\nYou can restore it from the Recycle Bin.`,
      confirmLabel: 'Move to Recycle Bin'
    });
    if (!ok) return;
    setBusyId(copy.id);
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/duplicate-models/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: copy.id })
      });
      const body = await apiJson(res);
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body.result as DuplicateScanResult);
      setMessage({ ok: true, text: `Moved ${copy.path} to the Recycle Bin — ${body.reclaimedFormatted} freed.` });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const copyCommand = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => setMessage({ ok: false, text: 'Could not copy to the clipboard.' }));
  };

  const groups = data?.groups ?? [];

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Duplicate models</h1>
          <p className="ins-sub">
            The same model weights stored more than once across Ollama, Hugging Face and LM Studio. Plain model files
            can go to the Recycle Bin while another copy stays; files inside a tool&apos;s own store are removed with
            that tool&apos;s command, because other models may depend on them.
          </p>
        </div>
      </header>

      <div className="ins-actionbar">
        <span className="ins-meta">
          {data ? `${groups.length} duplicate set${groups.length === 1 ? '' : 's'} · ${data.formattedTotalSavings} to gain by keeping one of each` : ' '}
        </span>
        <button className="ins-btn" style={{ marginLeft: 'auto' }} disabled={loading} onClick={() => void load()}>
          <RefreshCw size={14} />
          Rescan
        </button>
      </div>

      {message && <div className={`ins-note ${message.ok ? 'ins-note--ok' : 'ins-note--error'}`}>{message.text}</div>}

      {loading ? (
        <div className="ins-panel">
          <LoadingState title="Looking for duplicate model files" detail="Comparing model files of 100 MB or more by size, then by content." />
        </div>
      ) : groups.length === 0 ? (
        <div className="ins-panel">
          <div className="ins-empty">
            <strong>No duplicate models</strong>
            {data ? `Checked ${data.filesChecked} model files of 100 MB or more.` : 'Rescan to try again.'}
          </div>
        </div>
      ) : groups.map(group => (
        <div key={group.id} className="ins-panel">
          <div className="ins-section-head" style={{ padding: 'var(--ins-space-4) var(--ins-space-5)' }}>
            <span className={`ins-tier ${group.match === 'identical' ? 'ins-tier--safe' : 'ins-tier--review'}`}>
              {group.match === 'identical' ? 'Identical' : 'Very likely identical'}
            </span>
            <span className="ins-meta">{group.copies.length} copies of {group.formattedSize}</span>
            <span className="ins-num ins-data" style={{ marginLeft: 'auto' }}>{group.formattedSavings} to gain</span>
          </div>
          <table className="ins-table">
            <thead>
              <tr>
                <th>Copy</th>
                <th style={{ width: '320px' }}>Action</th>
                <th style={{ width: '44px' }} />
              </tr>
            </thead>
            <tbody>
              {group.copies.map(copy => (
                <tr key={copy.id} title={copy.note}>
                  <td>
                    <span className="ins-tool-name">
                      <span className="ins-dot" style={{ background: toolColor(copy.store) }} />
                      <span style={{ color: 'var(--ins-mist-50)' }}>{copy.store} · {copy.modelName}</span>
                    </span>
                    <span className="ins-path">{copy.path}</span>
                  </td>
                  <td>
                    {copy.trashable ? (
                      <button className="ins-btn" disabled={busyId !== null} onClick={() => void moveToBin(group, copy)}>
                        <Trash2 size={12} />
                        {busyId === copy.id ? 'Moving…' : 'Move this copy to Recycle Bin'}
                      </button>
                    ) : copy.command ? (
                      <div className="ins-well ins-data" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{copy.command}</span>
                        <button className="ins-btn ins-btn--quiet" onClick={() => copyCommand(copy.id, copy.command!)} aria-label="Copy command" style={{ flexShrink: 0 }}>
                          {copied === copy.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    ) : (
                      <span className="ins-meta">{copy.note}</span>
                    )}
                  </td>
                  <td>
                    <button className="ins-btn ins-btn--quiet" onClick={() => void openFolder(copy.path, onOpenFolder)} title="Open folder" aria-label={`Open folder of ${copy.path}`}>
                      <FolderOpen size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};
