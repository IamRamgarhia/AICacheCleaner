import React, { useState, useEffect } from 'react';
import type { AISoftwareAppItem } from '../types';
import { RefreshCw, Zap } from 'lucide-react';
import { toolColor } from '../lib/toolColors';

interface AutoBotsTabProps {
  processes?: { pid: number; name: string; tool: string; memoryMb?: number; cpuPercent?: number }[];
  onKillBot?: (pid: number) => void;
}

// Agent / crawler tooling, identified from the real installed-software scan.
const BOT_SOFTWARE_IDS = ['sw-opendevin', 'sw-crawl4ai', 'sw-playwright', 'sw-anythingllm', 'sw-continue'];

export const AutoBotsTab: React.FC<AutoBotsTabProps> = ({ onKillBot }) => {
  const [bots, setBots] = useState<AISoftwareAppItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchBots = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/software');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setBots(
        (data.software || []).filter(
          (sw: AISoftwareAppItem) => BOT_SOFTWARE_IDS.includes(sw.id) && sw.status !== 'NOT INSTALLED'
        )
      );
    } catch (e) {
      setLoadError(`Could not scan for agents: ${(e as Error).message}`);
      setBots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBots();
  }, []);

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Agents &amp; crawlers</h1>
          <p className="ins-sub">
            Autonomous agents, headless browsers and scraping engines installed on this machine —
            OpenDevin, Crawl4AI, Playwright, Puppeteer and similar. These often leave large binaries behind.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ins-space-2)', alignItems: 'center' }}>
          <span className="ins-meta ins-data">{bots.length} found</span>
          <button className="ins-btn" onClick={fetchBots} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Scanning' : 'Rescan'}
          </button>
        </div>
      </header>

      {loadError && <div className="ins-note ins-note--error">{loadError}</div>}

      {!loading && bots.length === 0 && !loadError ? (
        <div className="ins-empty">
          <strong>No agents or crawlers found</strong>
          Nothing from the supported list is installed here.
        </div>
      ) : (
        <div className="ins-grid">
          {bots.map(bot => {
            const isRunning = bot.status === 'ACTIVE IN RAM';
            return (
              <div key={bot.id} className="ins-card ins-card--tool" style={{ borderLeftColor: toolColor(bot.name) }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ins-space-2)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ins-card-title ins-tool-name"><span className="ins-dot" style={{ background: toolColor(bot.name) }} />{bot.name}</div>
                    <span className="ins-meta">{bot.category}</span>
                  </div>
                  <span className={`ins-tier ${isRunning ? 'ins-tier--safe' : 'ins-tier--review'}`}>
                    {isRunning ? 'Running' : 'Idle on disk'}
                  </span>
                </div>

                <p className="ins-meta" style={{ lineHeight: 1.5 }}>{bot.description}</p>

                <div className="ins-well" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{isRunning && bot.pid ? `PID ${bot.pid}` : 'On disk'}</span>
                  <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>
                    {isRunning ? `${bot.ramMb ?? 0} MB RAM` : bot.formattedDiskSize}
                  </span>
                </div>

                {isRunning && bot.pid && onKillBot ? (
                  <button
                    className="ins-btn"
                    onClick={() => onKillBot(bot.pid!)}
                    style={{ justifyContent: 'center', marginTop: 'auto' }}
                  >
                    <Zap size={14} /> Stop process
                  </button>
                ) : (
                  <div className="ins-meta" style={{ marginTop: 'auto', textAlign: 'center', padding: '7px' }}>
                    Not running
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
