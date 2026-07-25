import React, { useState } from 'react';
import type { AICacheItem } from '../types';
import { Sparkles, ShieldCheck, CheckCircle2, Trash2, FolderOpen, ExternalLink, Cpu, Info, Zap } from 'lucide-react';

interface SafeDeleteSectionProps {
  items: AICacheItem[];
  onCleanSelected: (itemIds: string[]) => void;
  onOpenFolder?: (path: string) => void;
  cleaning?: boolean;
}

export const SafeDeleteSection: React.FC<SafeDeleteSectionProps> = ({ items, onCleanSelected, onOpenFolder, cleaning }) => {
  const safeItems = items.filter(i => i.tier === 'GREEN' && i.canDelete);
  const totalSafeBytes = safeItems.reduce((acc, i) => acc + i.sizeBytes, 0);
  const [selectedIds, setSelectedIds] = useState<string[]>(safeItems.map(i => i.id));

  const formatBytesLocal = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleOpenFolder = async (folderPath: string) => {
    if (onOpenFolder) {
      onOpenFolder(folderPath);
      return;
    }
    try {
      await fetch('http://127.0.0.1:3333/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
    } catch (e) {
      console.warn('API offline - cannot launch Windows Explorer');
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: '24px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.08) 100%)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px', color: '#ffffff' }}>
              <ShieldCheck size={26} color="#34d399" /> 100% Safe to Delete Caches ({formatBytesLocal(totalSafeBytes)})
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '4px' }}>
              Temporary UI graphics, V8 bytecodes, and app crash logs. Deleting these is 100% risk-free and will not touch any project code or settings.
            </p>
          </div>

          <button
            className="btn-primary"
            disabled={safeItems.length === 0 || cleaning}
            onClick={() => onCleanSelected(selectedIds.length > 0 ? selectedIds : safeItems.map(i => i.id))}
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 4px 20px rgba(16, 185, 129, 0.4)',
              padding: '12px 24px',
              fontSize: '0.95rem',
              fontWeight: 800
            }}
          >
            <Sparkles size={18} /> Clean Selected Safe Files ({selectedIds.length} items)
          </button>
        </div>
      </div>

      {/* Grid of Safe Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {safeItems.map((item) => {
          const isSelected = selectedIds.includes(item.id);

          return (
            <div
              key={item.id}
              className="glass-card"
              style={{
                padding: '20px',
                background: 'rgba(17, 24, 39, 0.8)',
                border: isSelected ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid var(--border-color)',
                boxShadow: isSelected ? '0 0 20px rgba(16, 185, 129, 0.15)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                borderRadius: '16px',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>{item.name}</h3>
                      <span style={{
                        fontSize: '0.72rem',
                        color: '#00f2fe',
                        background: 'rgba(0, 242, 254, 0.1)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        display: 'inline-block',
                        marginTop: '4px'
                      }}>
                        {item.category}
                      </span>
                    </div>
                  </div>

                  <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>
                    <CheckCircle2 size={12} /> 100% SAFE
                  </span>
                </div>

                {/* Directory Path Link */}
                <div
                  onClick={() => handleOpenFolder(item.path)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.76rem',
                    color: '#60a5fa',
                    fontFamily: 'monospace',
                    marginBottom: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title="Click to open in Explorer"
                >
                  <FolderOpen size={14} color="#00f2fe" style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.path}</span>
                  <ExternalLink size={12} color="#60a5fa" style={{ flexShrink: 0 }} />
                </div>

                {/* Safety Explanation Box */}
                <div style={{
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  padding: '12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  color: '#34d399',
                  lineHeight: '1.4',
                  marginBottom: '16px'
                }}>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', color: '#10b981' }}>
                    <ShieldCheck size={14} /> WHY IT IS SAFE TO DELETE:
                  </strong>
                  {item.safeReason || item.impactDescription}
                </div>
              </div>

              {/* Bottom Footer Action Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div>
                  <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#34d399' }}>{item.formattedSize}</span>
                  <span style={{ fontSize: '0.7rem', color: '#6b7280', display: 'block' }}>Last modified: {item.lastModified}</span>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-secondary" onClick={() => handleOpenFolder(item.path)} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                    <FolderOpen size={13} /> Open
                  </button>

                  <button
                    className="btn-danger"
                    onClick={() => onCleanSelected([item.id])}
                    style={{ padding: '6px 12px', fontSize: '0.78rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none' }}
                  >
                    <Trash2 size={13} /> Clean
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
