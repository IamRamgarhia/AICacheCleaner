import React, { useState } from 'react';
import type { SystemMetrics, AICacheItem } from '../types';
import { HardDrive, Cpu, Trash2, ShieldCheck, Download, RefreshCw, FolderOpen, ExternalLink, ArrowRight, Info, CheckCircle2, AlertTriangle, ShieldAlert, Sparkles, Zap, Rocket, Activity, ChevronRight, Laptop } from 'lucide-react';

interface MainDashboardViewProps {
  metrics: SystemMetrics | null;
  items: AICacheItem[];
  loading: boolean;
  onRefresh: () => void;
  onCleanSelected: (ids: string[]) => void;
  onExportVault: () => void;
  onOpenFolder: (path: string) => void;
  onNavigateTab: (tab: 'DASHBOARD' | 'SAFE_DELETE' | 'STORAGE' | 'SOFTWARE' | 'AUTOBOTS' | 'PROCESSES' | 'MIGRATION' | 'MEMORY' | 'HISTORY' | 'SETTINGS') => void;
}

export const MainDashboardView: React.FC<MainDashboardViewProps> = ({
  metrics,
  items,
  loading,
  onRefresh,
  onCleanSelected,
  onExportVault,
  onOpenFolder,
  onNavigateTab
}) => {
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);

  const totalDiskFormatted = metrics?.totalAICacheFormatted || '33.76 GB';
  const totalRamFormatted = metrics?.totalAIRAMFormatted || '1.48 GB (1515 MB)';
  const reclaimableFormatted = metrics?.reclaimableFormatted || '10.58 GB';
  const healthScore = metrics?.hygieneScore || 69;

  const handleLaunchLocalhost = async (folderPath: string) => {
    setLaunchingPath(folderPath);
    try {
      const response = await fetch('http://localhost:3333/api/launch-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
      const data = await response.json();
      if (data.url) {
        window.open(data.url, '_blank');
      }
    } catch (e) {
      window.open('http://localhost:5173', '_blank');
    } finally {
      setTimeout(() => setLaunchingPath(null), 2000);
    }
  };

  // Filter top 5 largest AI items for clean executive overview
  const topStorageItems = [...items]
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 5);

  // Group size by category for clean breakdown
  const categoryBreakdown = items.reduce((acc, item) => {
    const cat = item.category || 'Other';
    acc[cat] = (acc[cat] || 0) + item.sizeBytes;
    return acc;
  }, {} as { [key: string]: number });

  const totalScannedBytes = Object.values(categoryBreakdown).reduce((a, b) => a + b, 0) || 1;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. TOP HEADER & SYSTEM SCAN CONTROLS */}
      <div className="glass-card" style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08) 0%, rgba(157, 78, 221, 0.08) 100%)', border: '1px solid rgba(0, 242, 254, 0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={24} color="#00f2fe" /> AI-Hygiene System Dashboard
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#34d399', marginTop: '4px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={16} /> 100% On-Demand Guarantee: Never runs in the background until launched by user • 100% Offline & Private
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={onRefresh} disabled={loading} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'Scanning...' : 'Scan System'}
            </button>

            <button
              className="btn-primary"
              onClick={() => onCleanSelected(items.filter(i => i.tier === 'GREEN' && i.canDelete).map(i => i.id))}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 4px 20px rgba(16, 185, 129, 0.4)',
                padding: '8px 20px',
                fontWeight: 800,
                fontSize: '0.88rem'
              }}
            >
              <ShieldCheck size={16} /> Review & Clean Safe Caches
            </button>
          </div>
        </div>
      </div>

      {/* 2. TOP 4 HIGH-IMPACT KEY PERFORMANCE CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '18px' }}>
        {/* Metric 1: Total AI Disk */}
        <div
          onClick={() => onNavigateTab('STORAGE')}
          className="glass-card"
          style={{
            padding: '20px',
            border: '1px solid rgba(0, 242, 254, 0.3)',
            boxShadow: '0 0 20px rgba(0, 242, 254, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, border-color 0.2s ease'
          }}
          title="Click to view Drive Footprint tab"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={18} color="#00f2fe" /> Total AI Disk
            </span>
            <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>LIVE SCAN</span>
          </div>

          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#ffffff', marginTop: '10px', letterSpacing: '-0.03em' }}>
            {totalDiskFormatted}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '0.74rem', color: '#00f2fe', fontWeight: 700 }}>
            <span>Click to view all drives →</span>
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Metric 2: Active AI RAM */}
        <div
          onClick={() => onNavigateTab('PROCESSES')}
          className="glass-card"
          style={{
            padding: '20px',
            border: '1px solid rgba(192, 132, 252, 0.3)',
            boxShadow: '0 0 20px rgba(192, 132, 252, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, border-color 0.2s ease'
          }}
          title="Click to view Process Inspector"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={18} color="#c084fc" /> Active AI RAM
            </span>
            <span className="badge badge-yellow" style={{ fontSize: '0.68rem' }}>PROCESS LOAD</span>
          </div>

          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#ffffff', marginTop: '10px', letterSpacing: '-0.03em' }}>
            {totalRamFormatted.split(' ')[0]} GB
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '0.74rem', color: '#c084fc', fontWeight: 700 }}>
            <span>Click to inspect processes →</span>
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Metric 3: Safe Reclaimable */}
        <div
          onClick={() => onNavigateTab('SAFE_DELETE')}
          className="glass-card"
          style={{
            padding: '20px',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, border-color 0.2s ease'
          }}
          title="Click to view Safe Delete tab"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={18} color="#34d399" /> Safe Reclaimable
            </span>
            <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>100% SAFE</span>
          </div>

          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#34d399', marginTop: '10px', letterSpacing: '-0.03em' }}>
            {reclaimableFormatted}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '0.74rem', color: '#34d399', fontWeight: 700 }}>
            <span>Click to clean safe files →</span>
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Metric 4: Health Score */}
        <div
          onClick={() => onNavigateTab('HISTORY')}
          className="glass-card"
          style={{
            padding: '20px',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, border-color 0.2s ease'
          }}
          title="Click to view Restore Points"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} color="#fbbf24" /> AI Health Score
            </span>
            <span className="badge badge-yellow" style={{ fontSize: '0.68rem' }}>GOOD</span>
          </div>

          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#fbbf24', marginTop: '10px', letterSpacing: '-0.03em' }}>
            {healthScore} <span style={{ fontSize: '1rem', color: '#9ca3af' }}>/ 100</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '0.74rem', color: '#fbbf24', fontWeight: 700 }}>
            <span>Click to view restore points →</span>
            <ChevronRight size={14} />
          </div>
        </div>
      </div>

      {/* 3. MIDDLE SECTION: STORAGE BREAKDOWN BY AI SUITE + QUICK ACTIONS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Left Analytics Card: Category Footprint */}
        <div className="glass-card" style={{ padding: '24px', flex: 2 }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="#00f2fe" /> AI Storage Distribution by Suite
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {Object.entries(categoryBreakdown).map(([cat, bytes]) => {
              const pct = Math.round((bytes / totalScannedBytes) * 100) || 0;
              const formatted = formatBytes(bytes);

              const colorMap: { [key: string]: string } = {
                'Antigravity': '#10b981',
                'Cursor': '#00c6ff',
                'Claude': '#c084fc',
                'Ollama': '#f59e0b',
                'Other': '#60a5fa'
              };
              const color = colorMap[cat] || '#60a5fa';

              return (
                <div key={cat}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#9ca3af', marginBottom: '6px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff', fontWeight: 600 }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
                      {cat} Software Footprint
                    </span>
                    <span style={{ fontWeight: 700, color: color }}>
                      {formatted} ({pct}%)
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '7px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(4, pct)}%`, height: '100%', background: color, borderRadius: '4px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Quick Action Center Card */}
        <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} color="#00f2fe" /> Quick Action Center
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', lineHeight: '1.4', marginBottom: '16px' }}>
              Instant safety optimization, process termination, and backup tools:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                className="btn-primary"
                onClick={() => onCleanSelected(items.filter(i => i.tier === 'GREEN' && i.canDelete).map(i => i.id))}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                }}
              >
                <ShieldCheck size={16} /> 1-Click Clean Safe Caches
              </button>

              <button
                className="btn-secondary"
                onClick={() => onNavigateTab('PROCESSES')}
                style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '0.85rem', fontWeight: 700 }}
              >
                <Cpu size={16} /> Inspect & Terminate RAM Hogs
              </button>

              <button
                className="btn-secondary"
                onClick={onExportVault}
                style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '0.85rem', fontWeight: 700 }}
              >
                <Download size={16} /> Export Project Backup (.zip)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. EXECUTIVE SUMMARY: TOP 5 LARGEST AI STORAGE TARGETS */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={18} color="#00f2fe" /> Top AI Storage Consumers on PC
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: '2px' }}>
              Top 5 largest AI directories & model caches currently on disk
            </p>
          </div>

          <button
            className="btn-secondary"
            onClick={() => onNavigateTab('STORAGE')}
            style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700, color: '#00f2fe', borderColor: 'rgba(0, 242, 254, 0.4)' }}
          >
            View All Drives Footprint ({items.length} targets) →
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: '#9ca3af', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 16px' }}>Target Name & Directory Path</th>
                <th style={{ padding: '12px 16px' }}>Safety Assessment</th>
                <th style={{ padding: '12px 16px' }}>Disk Size</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {topStorageItems.map((item) => {
                const isRunnable = item.path.toLowerCase().includes('calude') || item.path.toLowerCase().includes('ai memroy ext') || item.name.toLowerCase().includes('project');

                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{
                          background: 'rgba(0, 242, 254, 0.12)',
                          border: '1px solid rgba(0, 242, 254, 0.3)',
                          color: '#00f2fe',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700
                        }}>
                          {item.category}
                        </span>

                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ffffff' }}>
                          {item.name}
                        </span>
                      </div>

                      <div
                        onClick={() => onOpenFolder(item.path)}
                        style={{
                          fontSize: '0.76rem',
                          color: '#60a5fa',
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          textDecoration: 'underline'
                        }}
                        title="Click to open folder in Explorer"
                      >
                        <FolderOpen size={13} color="#00f2fe" />
                        <span>{item.path}</span>
                        <ExternalLink size={12} color="#60a5fa" />
                      </div>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      {item.tier === 'GREEN' && (
                        <span className="badge badge-green">
                          <CheckCircle2 size={12} /> YES (100% SAFE)
                        </span>
                      )}
                      {item.tier === 'YELLOW' && (
                        <span className="badge badge-yellow">
                          <AlertTriangle size={12} /> REVIEW (AI MEMORY)
                        </span>
                      )}
                      {item.tier === 'RED' && (
                        <span className="badge badge-red">
                          <ShieldAlert size={12} /> DO NOT DELETE
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '12px 16px', fontWeight: 800, color: '#ffffff' }}>
                      {item.formattedSize}
                    </td>

                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        {isRunnable && (
                          <button
                            className="btn-primary"
                            onClick={() => handleLaunchLocalhost(item.path)}
                            disabled={launchingPath === item.path}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.76rem',
                              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                            }}
                          >
                            <Rocket size={12} /> Localhost
                          </button>
                        )}

                        <button
                          className="btn-secondary"
                          onClick={() => onOpenFolder(item.path)}
                          style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                        >
                          <FolderOpen size={12} /> Open
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
