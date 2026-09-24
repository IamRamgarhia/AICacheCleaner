import React, { useState, useEffect } from 'react';
import { RefreshCw, Save, CheckCircle2, AlertTriangle, ExternalLink, ShieldCheck, Download, FolderOpen, Bell } from 'lucide-react';
import { downloadUpdate, isElectron, pickFolder, type UpdateAsset } from '../lib/native';
import { formatBytes } from '../lib/format';

interface SettingsTabProps {
  updateInfo?: {
    updateAvailable: boolean;
    latestVersion?: string;
    currentVersion?: string;
    downloadUrl?: string;
    releaseNotes?: string;
    assets?: UpdateAsset[];
  } | null;
  onCheckUpdate?: () => void;
  /** Lets the app pick up changed preferences (threshold, reminder) at once. */
  onSaved?: () => void;
}

/** The asset matching how this copy runs: portable exe unless installed. */
function pickAsset(assets: UpdateAsset[] = []): UpdateAsset | undefined {
  // Windows builds only for now; other platforms get the Releases link.
  if (!navigator.userAgent.includes('Windows')) return undefined;
  return assets.find(a => /portable.*\.exe$/i.test(a.name)) ?? assets.find(a => /\.exe$/i.test(a.name));
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ updateInfo, onCheckUpdate, onSaved }) => {
  const [cacheThresholdGb, setCacheThresholdGb] = useState<number>(20);
  const [restorePointPolicy, setRestorePointPolicy] = useState<'PROMPT' | 'ALWAYS' | 'NEVER'>('PROMPT');
  const [customRestorePath, setCustomRestorePath] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);
  const [installMsg, setInstallMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderGb, setReminderGb] = useState(5);
  const [download, setDownload] = useState<{ pct: number; text: string; ok?: boolean } | null>(null);

  useEffect(() => {
    fetch('http://127.0.0.1:3333/api/config')
      .then(res => res.json())
      .then(data => {
        if (!data) return;
        if (data.cacheThresholdGb) setCacheThresholdGb(data.cacheThresholdGb);
        if (data.restorePointPolicy) setRestorePointPolicy(data.restorePointPolicy);
        if (data.customRestorePath) setCustomRestorePath(data.customRestorePath);
        if (typeof data.reminderEnabled === 'boolean') setReminderEnabled(data.reminderEnabled);
        if (typeof data.reminderGb === 'number') setReminderGb(data.reminderGb);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheThresholdGb, restorePointPolicy, customRestorePath, reminderEnabled, reminderGb })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server returned ${res.status}`);
      }
      setSaved({ ok: true, text: 'Preferences saved.' });
      onSaved?.();
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

  const toggleReminder = async (on: boolean) => {
    // The OS asks once; without permission a reminder could never show.
    if (on && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    setReminderEnabled(on);
  };

  const chooseRestoreFolder = async () => {
    const chosen = await pickFolder('Default restore destination', customRestorePath || undefined);
    if (chosen) setCustomRestorePath(chosen);
  };

  const asset = pickAsset(updateInfo?.assets);
  const handleDownload = async () => {
    if (!asset) return;
    setDownload({ pct: 0, text: 'Starting download…' });
    const res = await downloadUpdate(asset, (received, total) =>
      setDownload({ pct: total ? Math.round((received / total) * 100) : 0, text: `${formatBytes(received)} of ${formatBytes(total)}` }));
    setDownload(res.ok
      ? { pct: 100, ok: true, text: `Saved to ${res.path}${res.verified ? ' · checksum verified' : ''}. Close this app and start the new version.` }
      : { pct: 0, ok: false, text: res.error || 'Download failed.' });
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
            <div style={{ display: 'flex', gap: 'var(--ins-space-2)' }}>
              <input
                id="restorepath"
                className="ins-input"
                type="text"
                value={customRestorePath}
                placeholder="Leave blank to use the original location"
                onChange={e => setCustomRestorePath(e.target.value)}
              />
              {isElectron() && (
                <button className="ins-btn" onClick={chooseRestoreFolder} title="Choose folder">
                  <FolderOpen size={13} /> Browse
                </button>
              )}
            </div>
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
              A warning appears in the status bar once your footprint passes this.
            </span>
          </div>

          <div>
            <label className="ins-check">
              <input type="checkbox" checked={reminderEnabled} onChange={e => void toggleReminder(e.target.checked)} />
              <Bell size={13} /> Notify me when this much is safe to reclaim (GB)
            </label>
            <input
              className="ins-input"
              type="number"
              min={0.5}
              step={0.5}
              value={reminderGb}
              disabled={!reminderEnabled}
              onChange={e => setReminderGb(Number(e.target.value))}
              aria-label="Reminder threshold in GB"
              style={{ marginTop: '6px' }}
            />
            <span className="ins-meta" style={{ marginTop: '5px', display: 'block' }}>
              Off by default. While the app is open it re-checks every 6 hours and shows at most one notification a
              day. It only tells you — it never deletes anything by itself.
            </span>
          </div>
        </div>

        {/* Updates */}
        <div className="ins-card">
          <span className="ins-label">Version</span>

          <div className="ins-well" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Installed</span>
            <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>
              {updateInfo?.currentVersion || '—'}
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
            {updateInfo?.updateAvailable && asset && isElectron() && (
              <button className="ins-btn ins-btn--primary" onClick={handleDownload} disabled={download !== null && download.ok === undefined}>
                <Download size={14} /> Download {updateInfo.latestVersion} ({formatBytes(asset.sizeBytes)})
              </button>
            )}
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
          {download && (
            <div className={`ins-note ${download.ok === false ? 'ins-note--error' : 'ins-note--ok'}`} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <span>{download.text}</span>
              {download.ok === undefined && (
                <div className="ins-progress"><div className="ins-progress__fill" style={{ width: `${download.pct}%` }} /></div>
              )}
            </div>
          )}
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
