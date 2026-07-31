import React, { useState } from 'react';
import type { AIProcessItem } from '../types';
import { Zap } from 'lucide-react';

interface ProcessInspectorProps {
  processes: AIProcessItem[];
  onKillProcess: (pid: number) => void;
  /** True while the initial scan is still running. */
  loading?: boolean;
}

type Filter = 'ALL' | 'IDLE' | 'AGENTS' | 'MCP';

export const ProcessInspector: React.FC<ProcessInspectorProps> = ({ processes, onKillProcess, loading }) => {
  const [filter, setFilter] = useState<Filter>('ALL');

  const idle = processes.filter(p => p.isZombie);
  const idleMemoryMb = idle.reduce((acc, p) => acc + p.memoryMb, 0);

  const matches = (p: AIProcessItem, f: Filter) => {
    if (f === 'IDLE') return p.isZombie;
    if (f === 'AGENTS') return p.tool.toLowerCase().includes('subagent') || p.name.toLowerCase().includes('antigravity');
    if (f === 'MCP') return p.tool.toLowerCase().includes('mcp') || p.name.toLowerCase().includes('node');
    return true;
  };

  const filtered = processes.filter(p => matches(p, filter));

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: processes.length },
    { id: 'IDLE', label: 'Idle', count: idle.length },
    { id: 'AGENTS', label: 'Agents', count: processes.filter(p => matches(p, 'AGENTS')).length },
    { id: 'MCP', label: 'MCP servers', count: processes.filter(p => matches(p, 'MCP')).length }
  ];

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Running processes</h1>
          <p className="ins-sub">
            Background AI sidecars, language servers and agent workers, with live CPU and memory.
            &ldquo;Idle&rdquo; means holding more than 300&nbsp;MB while using almost no CPU.
          </p>
        </div>

        {idle.length > 0 && (
          <button className="ins-btn" onClick={() => idle.forEach(p => onKillProcess(p.pid))}>
            <Zap size={14} /> Stop {idle.length} idle ({idleMemoryMb} MB)
          </button>
        )}
      </header>

      <div style={{ display: 'flex', gap: 'var(--ins-space-1)', flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button
            key={f.id}
            className={`ins-btn${filter === f.id ? '' : ' ins-btn--quiet'}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label} <span className="ins-data" style={{ color: 'var(--ins-mist-500)' }}>{f.count}</span>
          </button>
        ))}
      </div>

      <div className="ins-panel" style={{ padding: 'var(--ins-space-4)' }}>
        {loading && processes.length === 0 ? (
          // Without this the empty state claimed "nothing is running" for the
          // whole duration of the first scan, which is simply untrue.
          <div className="ins-empty">
            <strong>Reading running processes…</strong>
            Collecting live CPU and memory for each AI process.
          </div>
        ) : filtered.length === 0 ? (
          <div className="ins-empty">
            <strong>No processes match</strong>
            {processes.length === 0
              ? 'No background AI processes are running right now.'
              : 'Try a different filter.'}
          </div>
        ) : (
          <table className="ins-table">
            <thead>
              <tr>
                <th>Process</th>
                <th style={{ width: '110px' }}>State</th>
                <th style={{ width: '90px' }} className="ins-num">Memory</th>
                <th style={{ width: '70px' }} className="ins-num">CPU</th>
                <th style={{ width: '90px' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(proc => (
                <tr key={proc.pid}>
                  <td>
                    <div style={{ color: 'var(--ins-mist-50)' }}>{proc.tool}</div>
                    <span className="ins-data ins-meta">
                      {proc.name} · PID {proc.pid}
                    </span>
                  </td>
                  <td>
                    {proc.isZombie ? (
                      <span className="ins-tier ins-tier--review">Idle</span>
                    ) : (
                      <span className="ins-tier ins-tier--safe">Active</span>
                    )}
                  </td>
                  <td className="ins-num ins-data">{proc.memoryMb} MB</td>
                  <td className="ins-num ins-data">{proc.cpuPercent}%</td>
                  <td>
                    <button
                      className="ins-btn ins-btn--quiet"
                      onClick={() => onKillProcess(proc.pid)}
                      style={{ marginLeft: 'auto' }}
                    >
                      Stop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
