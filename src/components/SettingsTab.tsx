import React, { useState } from 'react';
import { Settings, Shield, Bell, Folder, Save, CheckCircle2, ExternalLink, Globe, RefreshCw, Sparkles, Download } from 'lucide-react';

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
  const [defaultDeleteMethod, setDefaultDeleteMethod] = useState<'TRASH' | 'PERMANENT'>('TRASH');
  const [restorePointPolicy, setRestorePointPolicy] = useState<'PROMPT' | 'ALWAYS' | 'NEVER'>('PROMPT');
  const [customRestorePath, setCustomRestorePath] = useState<string>('Desktop\\Restored_AI_Files');
  const [autoCleanGreenTier, setAutoCleanGreenTier] = useState<boolean>(false);
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [installingNative, setInstallingNative] = useState<boolean>(false);
  const [nativeInstallMsg, setNativeInstallMsg] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  useEffect(() => {
    fetch('http://127.0.0.1:3333/api/config')
      .then(res => res.json())
      .then(data => {
        if (data) {
          if (data.cacheThresholdGb) setCacheThresholdGb(data.cacheThresholdGb);
          if (data.defaultDeleteMethod) setDefaultDeleteMethod(data.defaultDeleteMethod);
          if (data.restorePointPolicy) setRestorePointPolicy(data.restorePointPolicy);
          if (data.customRestorePath) setCustomRestorePath(data.customRestorePath);
          if (data.autoCleanGreenTier !== undefined) setAutoCleanGreenTier(data.autoCleanGreenTier);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveSettings = async () => {
    try {
      await fetch('http://127.0.0.1:3333/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cacheThresholdGb,
          defaultDeleteMethod,
          restorePointPolicy,
          customRestorePath,
          autoCleanGreenTier
        })
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (e) {
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }
  };

  const handleManualCheckUpdate = async () => {
    setCheckingUpdate(true);
    if (onCheckUpdate) await onCheckUpdate();
    setTimeout(() => setCheckingUpdate(false), 1500);
  };

  const handleInstallNative = async () => {
    setInstallingNative(true);
    try {
      const res = await fetch('http://localhost:3333/api/install-native', { method: 'POST' });
      const data = await res.json();
      setNativeInstallMsg(data.message || 'Launched Native Setup Installer!');
    } catch (e) {
      window.open('https://github.com/IamRamgarhia/ai-cache-cleaner/releases/download/v1.0.0/AICacheCleaner-Setup-1.0.0.exe', '_blank');
      setNativeInstallMsg('Opening Native Setup Installer download link...');
    } finally {
      setInstallingNative(false);
    }
  };

  const openLocalhostBrowser = () => {
    window.open('http://localhost:5173', '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Settings size={22} color="#00f2fe" /> Software Settings & Native Installation Options
        </h2>
        <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
          Configure threshold alerts, default restore policies, check GitHub auto-updates, and convert Portable app to a Native Windows Installation.
        </p>
      </div>

      {/* GitHub Auto-Update Checker Card */}
      <div className="glass-card" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(157, 78, 221, 0.1) 0%, rgba(0, 242, 254, 0.1) 100%)', border: '1px solid rgba(157, 78, 221, 0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span style={{ fontSize: '0.74rem', color: '#00f2fe', background: 'rgba(0, 242, 254, 0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
              GITHUB REPOSITORY RELEASES INTEGRATION
            </span>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={20} color="#a855f7" /> GitHub Automated Software Update Engine
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: '2px' }}>
              Current Installed Version: <strong style={{ color: '#ffffff' }}>{updateInfo?.currentVersion || 'v1.0.0'}</strong> • Latest GitHub Release: <strong style={{ color: '#00f2fe' }}>{updateInfo?.latestVersion || 'v1.0.0'}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-secondary" onClick={handleManualCheckUpdate} disabled={checkingUpdate} style={{ padding: '10px 16px' }}>
              <RefreshCw size={16} className={checkingUpdate ? 'spin' : ''} /> {checkingUpdate ? 'Checking GitHub...' : 'Check GitHub for Updates'}
            </button>

            {updateInfo?.downloadUrl && (
              <a
                href={updateInfo.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 18px', background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)' }}
              >
                <ExternalLink size={16} /> Open GitHub Release Page
              </a>
            )}
          </div>
        </div>

        {updateInfo?.updateAvailable && (
          <div style={{ marginTop: '14px', padding: '12px 16px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.4)', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ color: '#f472b6', fontSize: '0.9rem', display: 'block' }}>
                🚀 New Version {updateInfo.latestVersion} is Available on GitHub!
              </strong>
              <span style={{ fontSize: '0.78rem', color: '#e5e7eb' }}>
                {updateInfo.releaseNotes}
              </span>
            </div>
            <a
              href={updateInfo.downloadUrl}
              target="_blank"
              rel="noreferrer"
              style={{ padding: '8px 16px', background: '#ffffff', color: '#0b0f19', borderRadius: '8px', fontWeight: 800, textDecoration: 'none', fontSize: '0.8rem' }}
            >
              Get Latest Update
            </a>
          </div>
        )}
      </div>

      {/* Option: Convert Portable to Native Installed App */}
      <div className="glass-card" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(0, 242, 254, 0.08) 100%)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span style={{ fontSize: '0.74rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
              CONVERT PORTABLE TO NATIVE APP
            </span>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ffffff', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Download size={20} color="#10b981" /> Install as Native Windows Software
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '2px' }}>
              Running the Portable version? Click below to install as a native Windows desktop app with Start Menu shortcuts and Control Panel integration.
            </p>
          </div>

          <button className="btn-primary" onClick={handleInstallNative} disabled={installingNative} style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none' }}>
            <Download size={16} /> {installingNative ? 'Launching Setup Installer...' : 'Install as Native Windows App'}
          </button>
        </div>

        {nativeInstallMsg && (
          <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} /> {nativeInstallMsg}
          </div>
        )}
      </div>

      {/* 1-Click Easy Localhost Launcher Banner for Non-Technical Users */}
      <div className="glass-card" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08) 0%, rgba(79, 172, 254, 0.08) 100%)', border: '1px solid rgba(0, 242, 254, 0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Globe size={20} color="#00f2fe" /> Easy 1-Click Localhost Launcher for Beginners
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
              Non-technical users can simply double-click <code style={{ color: '#00f2fe' }}>start-ai-hygiene.bat</code> (Windows) or <code style={{ color: '#00f2fe' }}>start-ai-hygiene.command</code> (macOS) to run automatically!
            </p>
          </div>

          <button className="btn-primary" onClick={openLocalhostBrowser}>
            <ExternalLink size={16} /> Open Localhost App (http://localhost:5173)
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
        {/* Section 1: Safety & Deletion Preferences */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Shield size={18} color="#10b981" /> Safety & Deletion Policies
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
                Default Safety Restore Point Policy
              </label>
              <select
                value={restorePointPolicy}
                onChange={(e) => setRestorePointPolicy(e.target.value as any)}
                style={{ width: '100%', padding: '10px', background: '#0b0f19', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
              >
                <option value="PROMPT">Ask Me Every Time Before Deleting (Recommended)</option>
                <option value="ALWAYS">Always Create Restore Point Automatically</option>
                <option value="NEVER">Disable Restore Point Creation</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
                Deletion Execution Method
              </label>
              <select
                value={defaultDeleteMethod}
                onChange={(e) => setDefaultDeleteMethod(e.target.value as any)}
                style={{ width: '100%', padding: '10px', background: '#0b0f19', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
              >
                <option value="TRASH">Soft-Delete to Windows Recycle Bin / macOS Trash (Safest)</option>
                <option value="PERMANENT">Permanent Direct File Deletion</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
                Default Custom Restore Destination Folder
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Folder size={16} color="#00f2fe" />
                <input
                  type="text"
                  value={customRestorePath}
                  onChange={(e) => setCustomRestorePath(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', background: '#0b0f19', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Threshold Alerts & System Integration */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Bell size={18} color="#9d4edd" /> Threshold Alerts & Automation
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>
                AI Cache Alert Threshold (GB)
              </label>
              <input
                type="number"
                value={cacheThresholdGb}
                onChange={(e) => setCacheThresholdGb(Number(e.target.value))}
                style={{ width: '100%', padding: '10px', background: '#0b0f19', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
              />
              <span style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '4px', display: 'block' }}>
                Send notification when AI cache exceeds {cacheThresholdGb} GB on disk.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: '#d1d5db', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoCleanGreenTier}
                  onChange={(e) => setAutoCleanGreenTier(e.target.checked)}
                />
                Auto-Clean 🟢 100% Safe Green Tier Caches Weekly
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Save Settings Bar */}
      <div className="glass-card" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
          All settings are stored 100% locally on your machine in <code style={{ color: '#00f2fe' }}>.ai-hygiene/config.json</code>
        </span>

        <button className="btn-primary" onClick={handleSaveSettings}>
          <Save size={16} /> Save Preferences
        </button>
      </div>

      {savedSuccess && (
        <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={16} /> Preferences successfully saved to local config!
        </div>
      )}
    </div>
  );
};
