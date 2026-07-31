import React, { useState, useEffect } from 'react';
import { RefreshCw, Save, CheckCircle2, AlertTriangle, ExternalLink, ShieldCheck, Download } from 'lucide-react';

interface SettingsTabProps {
  updateInfo?: {
    updateAvailable: boolean;
    latestVersion?: string;
    currentVersion?: string;
    downloadUrl?: string;
    releaseNotes?: string;
  } | null;
  onCheckUpdate?: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ updateInfo, onCheckUpdate }) => {
  const [cacheThresholdGb, setCacheThresholdGb] = useState<number>(20);
  const [restorePointPolicy, setRestorePointPolicy] = useState<'PROMPT' | 'ALWAYS' | 'NEVER'>('PROMPT');
  const [customRestorePath, setCustomRestorePath] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);
  const [installMsg, setInstallMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('http://127.0.0.1:3333/api/config')
      .then(res => res.json())
      .then(data => {
        if (!data) return;
        if (data.cacheThresholdGb) setCacheThresholdGb(data.cacheThresholdGb);
        if (data.restorePointPolicy) setRestorePointPolicy(data.restorePointPolicy);
        if (data.customRestorePath) setCustomRestorePath(data.customRestorePath);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheThresholdGb, restorePointPolicy, customRestorePath })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server returned ${res.status}`);
      }
      setSaved({ ok: true, text: 'Preferences saved.' });
    } catch (e) {
      setSaved({ ok: false, text: `Could not save: ${(e as Error).message}` });
    }
    setTimeout(() => setSaved(null), 4000);
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    if (onCheckUpdate) await onCheckUpdate();
    setTimeout(() => setCheckingUpdate(false), 1200);
  };

  const handleInstallNative = async () => {
    setInstalling(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/install-native', { method: 'POST' });
      const data = await res.json();
      setInstallMsg({ ok: data.success !== false, text: data.message });
    } catch (e) {
      setInstallMsg({ ok: false, text: `Could not reach the local engine: ${(e as Error).message}` });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Settings</h1>
          <p className="ins-sub">
            Stored locally in <code className="ins-data">~/.ai-cache-cleaner/config.json</code>. Nothing is
            synced or sent anywhere.
          </p>
        </div>
        <button className="ins-btn ins-btn--primary" onClick={handleSave}>
          <Save size={14} /> Save preferences
        </button>
      </header>

      {saved && (
        <div className={`ins-note ${saved.ok ? 'ins-note--ok' : 'ins-note--error'}`}>
          {saved.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {saved.text}
        </div>
      )}

      <div className="ins-grid--2col">
        {/* Safety */}
        <div className="ins-card">
          <span className="ins-label">Safety</span>

          <div>
            <label className="ins-field-label" htmlFor="policy">Restore point before cleaning</label>
            <select
              id="policy"
              className="ins-select"
              value={restorePointPolicy}
              onChange={e => setRestorePointPolicy(e.target.value as 'PROMPT' | 'ALWAYS' | 'NEVER')}
            >
              <option value="PROMPT">Ask me each time</option>
              <option value="ALWAYS">Always record one</option>
              <option value="NEVER">Never record one</option>
            </select>
          </div>

          <div>
            <label className="ins-field-label" htmlFor="restorepath">Default restore destination</label>
            <input
              id="restorepath"
              className="ins-input"
              type="text"
              value={customRestorePath}
              placeholder="Leave blank to use the original location"
              onChange={e => setCustomRestorePath(e.target.value)}
            />
          </div>

          <div className="ins-note ins-note--ok">
            <ShieldCheck size={15} /> Cleaning always moves items to the Recycle Bin, never deletes outright.
          </div>
        </div>

        {/* Alerts */}
        <div className="ins-card">
          <span className="ins-label">Alerts</span>

          <div>
            <label className="ins-field-label" htmlFor="threshold">Warn when AI storage exceeds (GB)</label>
            <input
              id="threshold"
              className="ins-input"
              type="number"
              min={1}
              value={cacheThresholdGb}
              onChange={e => setCacheThresholdGb(Number(e.target.value))}
            />
            <span className="ins-meta" style={{ marginTop: '5px', display: 'block' }}>
              A banner appears at the top of every screen once your footprint passes this.
            </span>
          </div>

          <div className="ins-well">
            <strong style={{ color: 'var(--ins-mist-50)', display: 'block', marginBottom: '3px' }}>
              No scheduled cleaning
            </strong>
            Background cleaning would need an always-on service. AICacheCleaner only runs while you have it open.
          </div>
        </div>

        {/* Updates */}
        <div className="ins-card">
          <span className="ins-label">Version</span>

          <div className="ins-well" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Installed</span>
            <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>
              {updateInfo?.currentVersion || 'v1.0.0'}
            </span>
          </div>
          <div className="ins-well" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Latest release</span>
            <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>
              {updateInfo?.latestVersion || '—'}
            </span>
          </div>

          {updateInfo?.updateAvailable && (
            <div className="ins-note ins-note--warn">
              <AlertTriangle size={15} /> {updateInfo.latestVersion} is available.
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--ins-space-2)', marginTop: 'auto' }}>
            <button className="ins-btn" onClick={handleCheckUpdate} disabled={checkingUpdate}>
              <RefreshCw size={14} className={checkingUpdate ? 'spin' : ''} />
              {checkingUpdate ? 'Checking' : 'Check for updates'}
            </button>
            {updateInfo?.downloadUrl && (
              <a
                className="ins-btn ins-btn--quiet"
                href={updateInfo.downloadUrl}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={13} /> Releases
              </a>
            )}
          </div>
        </div>

        {/* Install */}
        <div className="ins-card">
          <span className="ins-label">Installation</span>
          <p className="ins-meta" style={{ lineHeight: 1.5 }}>
            Running the portable build? Installing registers AICacheCleaner with the Start Menu and
            Add/Remove Programs.
          </p>
          <button className="ins-btn" onClick={handleInstallNative} disabled={installing} style={{ marginTop: 'auto' }}>
            <Download size={14} /> {installing ? 'Working…' : 'Install as a Windows app'}
          </button>
          {installMsg && (
            <div className={`ins-note ${installMsg.ok ? 'ins-note--ok' : 'ins-note--warn'}`}>
              {installMsg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {installMsg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
