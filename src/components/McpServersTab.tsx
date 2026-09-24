import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import type { McpInventory, McpServer } from '../lib/types/mcp';
import { LoadingState } from './LoadingState';
import { apiJson, requireArrays } from '../lib/shape';

interface McpServersTabProps {
  onOpenFolder?: (p: string) => void;
}

const API = 'http://127.0.0.1:3333';

const scopeLabel = (s: McpServer) => {
  const scopes = [...new Set(s.definitions.map(d => d.scope))];
  if (scopes.length === 1) return scopes[0] === 'global' ? 'Global' : scopes[0].split(/[\\/]/).filter(Boolean).pop() ?? scopes[0];
  return scopes.includes('global') ? `Global + ${scopes.length - 1} project${scopes.length > 2 ? 's' : ''}` : `${scopes.length} projects`;
};

const commandLine = (s: McpServer) =>
  s.transport === 'stdio' ? [s.command, ...s.args].filter(Boolean).join(' ') : s.url ?? '';

function RunningCell({ server }: { server: McpServer }) {
  if (server.running) {
    return (
      <>
        <span className="ins-tier ins-tier--safe">Running</span>
        <div className="ins-meta ins-data">
          {server.running.memoryMb} MB · {server.running.processCount} proc
        </div>
      </>
    );
  }
  if (server.disabled) return <span className="ins-tier ins-tier--locked">Disabled</span>;
  if (server.transport !== 'stdio') return <span className="ins-meta">Remote</span>;
  return <span className="ins-meta">Not running</span>;
}

function Details({ server, onClose, onOpenFolder }: { server: McpServer; onClose: () => void; onOpenFolder?: (p: string) => void }) {
  return (
    <aside className="ins-details" aria-label={`Details for ${server.name}`}>
      <div className="ins-details-head">
        <strong className="ins-details-title">{server.name}</strong>
        <button className="ins-btn ins-btn--quiet" onClick={onClose} aria-label="Close details">
          <X size={14} />
        </button>
      </div>
      <div className="ins-details-body">
        <section>
          <span className="ins-label">{server.transport === 'stdio' ? 'Command' : `${server.transport.toUpperCase()} endpoint`}</span>
          <div className="ins-well ins-data ins-selectable" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
            {commandLine(server) || '—'}
          </div>
          <p className="ins-meta">Secrets such as API keys and tokens are replaced with [redacted].</p>
        </section>

        <section>
          <span className="ins-label">Environment variables</span>
          {server.envNames.length === 0 ? (
            <p className="ins-meta">None set in the config.</p>
          ) : (
            <p className="ins-details-text ins-data">{server.envNames.join(', ')}</p>
          )}
          <p className="ins-meta">Names only — values are never read out of the config.</p>
        </section>

        {server.running && (
          <section>
            <span className="ins-label">Live</span>
            <p className="ins-details-text">
              {server.running.processCount} process{server.running.processCount === 1 ? '' : 'es'} ·{' '}
              <span className="ins-data">{server.running.memoryMb} MB</span> ·{' '}
              <span className="ins-data">{server.running.cpuPercent}% CPU</span>
            </p>
            <p className="ins-meta ins-data">PID {server.running.pids.join(', ')}</p>
          </section>
        )}

        <section>
          <span className="ins-label">Defined in</span>
          {server.definitions.map((d, i) => (
            <div key={`${d.configPath}-${d.scope}-${i}`} className="ins-card" style={{ gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ins-space-2)' }}>
                <span style={{ color: 'var(--ins-mist-50)', flex: 1 }}>{d.client}</span>
                {d.disabled && <span className="ins-tier ins-tier--locked">Disabled</span>}
              </div>
              <span className="ins-meta">{d.scope === 'global' ? 'Global' : `Project: ${d.scope}`}</span>
              <span className="ins-path" title={d.configPath}>{d.configPath}</span>
              {onOpenFolder && (
                <button className="ins-btn ins-btn--quiet" style={{ alignSelf: 'flex-start' }} onClick={() => onOpenFolder(d.configPath)}>
                  <FolderOpen size={13} /> Open folder
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}

/**
 * Every MCP server configured across AI clients, whether it is running now and
 * what it costs in RAM. Read-only: edit servers in the client that owns them.
 */
export const McpServersTab: React.FC<McpServersTabProps> = ({ onOpenFolder }) => {
  const [data, setData] = useState<McpInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/mcp-servers`);
      const body = await apiJson(res);
      if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
      setData(requireArrays<McpInventory>(body, ['servers', 'configs']));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const servers = data?.servers ?? [];
  const running = servers.filter(s => s.running);
  const ramMb = running.reduce((a, s) => a + (s.running?.memoryMb ?? 0), 0);
  const unreadable = data?.configs.filter(c => c.status === 'unreadable') ?? [];
  const selected = servers.find(s => s.id === selectedId) ?? null;

  return (
    <div className="ins-page ins-page--split">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">MCP servers</h1>
          <p className="ins-sub">
            Every MCP server set up in Claude, Cursor, VS Code, Windsurf, Gemini, Codex and their extensions, merged
            where several apps use the same one. {data && <>{running.length} of {servers.length} running, using {ramMb} MB.</>}
          </p>
        </div>
        <div className="ins-toolbar">
          <button className="ins-btn ins-btn--quiet" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> {loading ? 'Reading' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="ins-note ins-note--error">Could not load MCP servers: {error}</div>}
      {unreadable.map(c => (
        <div key={c.path} className="ins-note ins-note--warn">
          {c.client}: {c.error ?? 'unreadable'} — <span className="ins-data">{c.path}</span>
        </div>
      ))}

      <div className="ins-split">
        <div className="ins-panel ins-split-list" aria-label="MCP servers">
          {!data && !error ? (
            <LoadingState title="Reading MCP configs" detail="Checking each AI client's config and matching running processes." />
          ) : servers.length === 0 ? (
            <div className="ins-empty">
              <strong>No MCP servers found</strong>
              None of the supported AI clients has an MCP server configured.
            </div>
          ) : (
            <table className="ins-table ins-table--interactive">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Clients</th>
                  <th style={{ width: '80px' }}>Transport</th>
                  <th style={{ width: '120px' }}>Running</th>
                  <th style={{ width: '150px' }}>Scope</th>
                </tr>
              </thead>
              <tbody>
                {servers.map(s => (
                  <tr
                    key={s.id}
                    className={s.id === selectedId ? 'is-focused' : undefined}
                    onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                    aria-selected={s.id === selectedId}
                  >
                    <td>
                      <div style={{ color: 'var(--ins-mist-50)' }}>{s.name}</div>
                      <span className="ins-path" title={commandLine(s)}>{commandLine(s)}</span>
                    </td>
                    <td className="ins-meta">{s.clients.join(', ')}</td>
                    <td className="ins-data ins-meta">{s.transport}</td>
                    <td><RunningCell server={s} /></td>
                    <td className="ins-meta" title={scopeLabel(s)}>{scopeLabel(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {selected && <Details server={selected} onClose={() => setSelectedId(null)} onOpenFolder={onOpenFolder} />}
      </div>
    </div>
  );
};
