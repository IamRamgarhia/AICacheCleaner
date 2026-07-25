import React from 'react';
import type { SystemMetrics } from '../types';
import { HardDrive, Cpu, Trash2, ShieldCheck, RefreshCw, RotateCcw, Zap, FolderGit2 } from 'lucide-react';

interface HeaderGaugeProps {
  metrics: SystemMetrics | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenRestoreModal: () => void;
  onEmergencyClean?: () => void;
  onSelectTab: (tab: 'SAFE_DELETE' | 'STORAGE' | 'PROCESSES' | 'HISTORY') => void;
}

export const HeaderGauge: React.FC<HeaderGaugeProps> = ({ metrics, loading, onRefresh, onOpenRestoreModal, onEmergencyClean, onSelectTab }) => {
  const score = metrics?.hygieneScore ?? 100;
  let scoreColor = '#10b981'; // Green
  if (score < 75) scoreColor = '#f59e0b'; // Yellow
  if (score < 50) scoreColor = '#ef4444'; // Red

  const projectsMemoryFormatted = metrics?.totalAIProjectsFormatted || '24.80 GB';

  return (
    <header className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 15px rgba(0, 242, 254, 0.4)'
          }}>
            <ShieldCheck size={28} color="#0b0f19" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #ffffff, #9ca3af)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              AICacheCleaner Safety Optimizer
            </h1>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '2px' }}>
              100% Private • Offline • Free AI Memory, Cache & Process Cleaner
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {onEmergencyClean && (
            <button className="btn-danger" onClick={onEmergencyClean} style={{ background: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)' }}>
              <Zap size={16} /> 1-Click Turbo Clean
            </button>
          )}

          <button className="btn-secondary" onClick={onOpenRestoreModal}>
            <RotateCcw size={16} /> Restore Point
          </button>

          <button className="btn-primary" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Scan System
          </button>
        </div>
      </div>

      {/* Clickable Metrics Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
        {/* Metric 1: Total AI Projects Memory (Click -> Storage tab) */}
        <div
          className="glass-card"
          onClick={() => onSelectTab('STORAGE')}
          style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', cursor: 'pointer', transition: 'all 0.2s ease' }}
          title="Click to view all AI Projects on disk"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600 }}>
            <FolderGit2 size={16} color="#60a5fa" /> AI Projects Memory
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '8px', color: '#60a5fa' }}>
            {projectsMemoryFormatted}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
            Click to view all projects ➔
          </div>
        </div>

        {/* Metric 2: Total AI Disk Cache (Click -> Storage tab) */}
        <div
          className="glass-card"
          onClick={() => onSelectTab('STORAGE')}
          style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', cursor: 'pointer', transition: 'all 0.2s ease' }}
          title="Click to view all AI Caches & Storage items"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600 }}>
            <HardDrive size={16} color="#00f2fe" /> Total AI Disk Cache
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '8px', color: '#00f2fe' }}>
            {metrics ? metrics.totalAICacheFormatted : '1.98 GB'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
            Click to view all caches ➔
          </div>
        </div>

        {/* Metric 3: Total AI RAM Usage (Click -> Processes tab) */}
        <div
          className="glass-card"
          onClick={() => onSelectTab('PROCESSES')}
          style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', cursor: 'pointer', transition: 'all 0.2s ease' }}
          title="Click to inspect active AI processes & RAM usage"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600 }}>
            <Cpu size={16} color="#9d4edd" /> Active AI RAM Usage
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '8px', color: '#c084fc' }}>
            {metrics ? metrics.totalAIRAMFormatted : '1.89 GB (1937 MB)'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
            Click to manage processes ➔
          </div>
        </div>

        {/* Metric 4: Safe Reclaimable Space (Click -> Safe Delete tab) */}
        <div
          className="glass-card"
          onClick={() => onSelectTab('SAFE_DELETE')}
          style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', cursor: 'pointer', transition: 'all 0.2s ease' }}
          title="Click to view 100% Safe to Delete files"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600 }}>
            <Trash2 size={16} color="#10b981" /> Safe Reclaimable
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '8px', color: '#34d399' }}>
            {metrics ? metrics.reclaimableFormatted : '1.98 GB'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
            Click to clean safe files ➔
          </div>
        </div>

        {/* Metric 5: AI Health Score (Click -> History tab) */}
        <div
          className="glass-card"
          onClick={() => onSelectTab('HISTORY')}
          style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', cursor: 'pointer', transition: 'all 0.2s ease' }}
          title="Click to view History & Safety Restore Points"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600 }}>
            <ShieldCheck size={16} color={scoreColor} /> AI Health Score
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '8px', color: scoreColor }}>
            {metrics ? `${metrics.hygieneScore} / 100` : '87 / 100'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
            Click to view restore points ➔
          </div>
        </div>
      </div>
    </header>
  );
};
