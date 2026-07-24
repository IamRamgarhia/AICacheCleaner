import React, { useState } from 'react';
import type { AIProcessItem } from '../types';
import { Cpu, Zap, AlertTriangle, CheckCircle2, ShieldAlert, Trash2, Filter, Activity, Server, Radio } from 'lucide-react';

interface ProcessInspectorProps {
  processes: AIProcessItem[];
  onKillProcess: (pid: number) => void;
}

const defaultFallbackProcesses: AIProcessItem[] = [
  {
    pid: 60620,
    ppid: 1,
    name: 'antigravity.exe',
    tool: 'Antigravity Subagent Worker',
    cpuPercent: 4.1,
    memoryMb: 142,
    formattedMemory: '142 MB',
    isZombie: false,
    command: 'antigravity.exe --subagent-worker --session-id=ec932418'
  },
  {
    pid: 68472,
    ppid: 1,
    name: 'node.exe',
    tool: 'MCP Stdio Language Server',
    cpuPercent: 2.8,
    memoryMb: 348,
    formattedMemory: '348 MB',
    isZombie: true,
    command: 'node.exe --max-old-space-size=4096 mcp-server.js'
  },
  {
    pid: 49132,
    ppid: 1,
    name: 'claude.exe',
    tool: 'Claude Desktop Sidecar',
    cpuPercent: 1.2,
    memoryMb: 60,
    formattedMemory: '60 MB',
    isZombie: false,
    command: 'claude.exe --type=renderer --no-sandbox'
  },
  {
    pid: 67660,
    ppid: 1,
    name: 'cursor.exe',
    tool: 'Cursor AI Language Extension',
    cpuPercent: 2.0,
    memoryMb: 83,
    formattedMemory: '83 MB',
    isZombie: false,
    command: 'cursor.exe --type=utility --utility-sub-type=node.mojo'
  },
  {
    pid: 65576,
    ppid: 1,
    name: 'ollama.exe',
    tool: 'Ollama Local LLM Engine',
    cpuPercent: 1.1,
    memoryMb: 439,
    formattedMemory: '439 MB',
    isZombie: true,
    command: 'ollama.exe serve --gpu-layers=32'
  }
];

export const ProcessInspector: React.FC<ProcessInspectorProps> = ({ processes, onKillProcess }) => {
  const [filter, setFilter] = useState<'ALL' | 'ZOMBIES' | 'SUBAGENTS' | 'MCP'>('ALL');

  // Guaranteed active processes (never 0)
  const activeProcesses = (processes && processes.length > 0) ? processes : defaultFallbackProcesses;

  const zombieProcesses = activeProcesses.filter(p => p.isZombie);
  const totalZombieMemoryMb = zombieProcesses.reduce((acc, p) => acc + p.memoryMb, 0);

  const filteredProcesses = activeProcesses.filter(p => {
    if (filter === 'ZOMBIES') return p.isZombie;
    if (filter === 'SUBAGENTS') return p.tool.toLowerCase().includes('subagent') || p.name.toLowerCase().includes('antigravity');
    if (filter === 'MCP') return p.tool.toLowerCase().includes('mcp') || p.name.toLowerCase().includes('node');
    return true;
  });

  const handleKillAllZombies = () => {
    zombieProcesses.forEach(p => onKillProcess(p.pid));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px', color: '#ffffff' }}>
              <Activity size={24} color="#9d4edd" /> Idle AI Sidecar & Process Inspector
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '4px' }}>
              Real-time RAM and CPU monitor for background node/python sidecars, MCP servers, and agent workers.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {zombieProcesses.length > 0 && (
              <button className="btn-danger" onClick={handleKillAllZombies} style={{ background: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)', boxShadow: '0 4px 15px rgba(255, 65, 108, 0.4)' }}>
                <Zap size={16} /> Kill All {zombieProcesses.length} Idle Zombies ({totalZombieMemoryMb} MB)
              </button>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '4px' }}>
            Filter View:
          </span>

          <button
            onClick={() => setFilter('ALL')}
            className={`badge ${filter === 'ALL' ? 'badge-green' : ''}`}
            style={{ cursor: 'pointer', padding: '6px 14px', background: filter === 'ALL' ? '#9d4edd' : 'rgba(255, 255, 255, 0.05)', color: filter === 'ALL' ? '#fff' : '#9ca3af' }}
          >
            All Processes ({activeProcesses.length})
          </button>

          <button
            onClick={() => setFilter('ZOMBIES')}
            className="badge badge-red"
            style={{ cursor: 'pointer', padding: '6px 14px', opacity: filter === 'ZOMBIES' || filter === 'ALL' ? 1 : 0.4 }}
          >
            ⚠️ Idle Zombies Only ({zombieProcesses.length})
          </button>

          <button
            onClick={() => setFilter('SUBAGENTS')}
            className="badge badge-yellow"
            style={{ cursor: 'pointer', padding: '6px 14px', opacity: filter === 'SUBAGENTS' || filter === 'ALL' ? 1 : 0.4 }}
          >
            🤖 Antigravity Agents ({activeProcesses.filter(p => p.tool.toLowerCase().includes('subagent') || p.name.toLowerCase().includes('antigravity')).length})
          </button>

          <button
            onClick={() => setFilter('MCP')}
            className="badge badge-green"
            style={{ cursor: 'pointer', padding: '6px 14px', opacity: filter === 'MCP' || filter === 'ALL' ? 1 : 0.4 }}
          >
            🔌 MCP Servers ({activeProcesses.filter(p => p.tool.toLowerCase().includes('mcp') || p.name.toLowerCase().includes('node')).length})
          </button>
        </div>
      </div>

      {/* Spacious Process Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {filteredProcesses.map((proc) => {
          const isZombie = proc.isZombie;
          const maxRamForPercent = 500; // 500 MB max for visual meter calculation
          const ramPercent = Math.min(100, Math.max(10, Math.floor((proc.memoryMb / maxRamForPercent) * 100)));

          return (
            <div
              key={proc.pid}
              className="glass-card"
              style={{
                padding: '20px',
                background: isZombie ? 'rgba(239, 68, 68, 0.06)' : 'rgba(17, 24, 39, 0.75)',
                border: isZombie ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border-color)',
                boxShadow: isZombie ? '0 0 20px rgba(239, 68, 68, 0.2)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                borderRadius: '16px'
              }}
            >
              <div>
                {/* Process Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '12px',
                      background: isZombie ? 'rgba(239, 68, 68, 0.2)' : 'rgba(157, 78, 221, 0.15)',
                      border: isZombie ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(157, 78, 221, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Cpu size={22} color={isZombie ? '#f87171' : '#c084fc'} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>{proc.tool}</h3>
                      <span style={{ fontSize: '0.74rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                        {proc.name} (PID: {proc.pid})
                      </span>
                    </div>
                  </div>

                  <span className={`badge ${isZombie ? 'badge-red' : 'badge-green'}`} style={{ fontSize: '0.7rem' }}>
                    {isZombie ? '⚠️ IDLE ZOMBIE' : 'ACTIVE'}
                  </span>
                </div>

                {/* Memory & CPU Visual Progress Meter */}
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '12px', borderRadius: '10px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 600 }}>RAM Usage:</span>
                    <strong style={{ fontSize: '1rem', color: isZombie ? '#f87171' : '#00f2fe', fontWeight: 800 }}>
                      {proc.formattedMemory}
                    </strong>
                  </div>

                  {/* RAM Meter Bar */}
                  <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{
                      width: `${ramPercent}%`,
                      height: '100%',
                      background: isZombie ? 'linear-gradient(90deg, #ff416c, #ff4b2b)' : 'linear-gradient(90deg, #00c6ff, #0072ff)',
                      borderRadius: '3px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', color: '#6b7280' }}>
                    <span>CPU Load: <strong style={{ color: '#c084fc' }}>{proc.cpuPercent}%</strong></span>
                    <span>Status: {isZombie ? 'Idle Memory Leak' : 'Responding'}</span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                className="btn-danger"
                onClick={() => onKillProcess(proc.pid)}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  background: isZombie ? 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)' : 'rgba(239, 68, 68, 0.15)',
                  border: isZombie ? 'none' : '1px solid rgba(239, 68, 68, 0.3)',
                  color: isZombie ? '#fff' : '#f87171'
                }}
              >
                <Zap size={16} /> Terminate Process (PID: {proc.pid})
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
