import React, { useState } from 'react';
import type { AICacheItem } from '../types';
import { HardDrive, AlertTriangle, CheckCircle2, ShieldAlert, Trash2, Info, FolderOpen, ExternalLink, Cpu, FolderGit2, Layers, ListFilter, Play, Rocket, Globe, Calendar, Clock, Flame, ArrowUpDown, ChevronDown, ChevronRight, FolderTree } from 'lucide-react';

interface TargetListTableProps {
  items: AICacheItem[];
  onCleanSelected: (selectedIds: string[]) => void;
  cleaning?: boolean;
  onOpenFolder?: (path: string) => void;
}

export const TargetListTable: React.FC<TargetListTableProps> = ({ items, onCleanSelected, cleaning, onOpenFolder }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'COMPACT' | 'PARENT_GROUPED' | 'FULL'>('COMPACT');
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE_MONTH' | 'OLD_INACTIVE' | 'HEAVY' | 'PROJECTS' | 'GREEN' | 'YELLOW'>('ALL');
  const [sortBy, setSortBy] = useState<'ACTIVE_TOP' | 'SIZE_DESC' | 'DATE_OLD' | 'DATE_NEW'>('ACTIVE_TOP');
  const [activeReasonItem, setActiveReasonItem] = useState<AICacheItem | null>(null);
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<{ [key: string]: boolean }>({ 'D:\\calude': true });

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const selectAllSafe = () => {
    const safeItemIds = items.filter(i => i.canDelete).map(i => i.id);
    setSelectedIds(safeItemIds);
  };

  const handleOpenFolder = async (folderPath: string) => {
    try {
      await fetch('http://localhost:3333/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
    } catch (e) {
      console.warn('API offline - cannot launch Windows Explorer');
    }
  };

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

  const toggleParentExpand = (parentDir: string) => {
    setExpandedParents(prev => ({ ...prev, [parentDir]: !prev[parentDir] }));
  };

  const getDriveLetter = (fullPath: string) => {
    const parts = fullPath.split(':');
    return parts.length > 1 ? `${parts[0].toUpperCase()}:` : 'C:';
  };

  const getParentDirectory = (fullPath: string) => {
    const parts = fullPath.split('\\');
    if (parts.length > 2) {
      return parts.slice(0, 3).join('\\');
    }
    return parts.slice(0, 2).join('\\');
  };

  // Helper to check if item is a legitimate Localhost Web Project (only show Launch Localhost button for these!)
  const isRunnableProject = (item: AICacheItem): boolean => {
    const pathLower = item.path.toLowerCase();
    const nameLower = item.name.toLowerCase();

    // Skip log files, crash logs, UI caches, and raw dot extension folders
    if (pathLower.includes('logs') || pathLower.includes('cache') || nameLower.includes('.jpg') || nameLower.includes('.mp4') || nameLower.includes('.pdf') || nameLower.includes('.png')) {
      return false;
    }

    return pathLower.includes('calude') || pathLower.includes('ai memroy ext') || nameLower.includes('project');
  };

  // STRICT JUNK & NON-AI FOLDER FILTER
  const isJunkFolder = (item: AICacheItem): boolean => {
    const nameLower = item.name.toLowerCase();
    const pathLower = item.path.toLowerCase();

    const junkExts = [
      '.avif', '.crdownload', '.doc', '.docx', '.exe', '.gz', '.jpeg', '.jpg',
      '.png', '.gif', '.svg', '.webp', '.psd', '.ai', '.pdf', '.xlsx', '.pptx',
      '.zip', '.rar', '.7z', '.tar', '.dll', '.iso', '.mp4', '.avi', '.mov', '.mp3'
    ];

    if (junkExts.some(ext => nameLower.includes(ext) || pathLower.includes(ext))) return true;
    if (pathLower.includes('\\downl') || pathLower.includes('\\downloads') || pathLower.includes('\\temp')) return true;

    return false;
  };

  // Base Mode Filter - Exclude non-AI junk files
  const modeFilteredItems = items.filter(i => {
    if (isJunkFolder(i)) return false;

    if (viewMode === 'COMPACT') {
      const isCoreTarget = !i.id.startsWith('secondary-') && !i.name.includes('/') && !i.path.includes('.zip');
      const isMainProject = i.path.toLowerCase() === 'd:\\calude' || i.path.toLowerCase() === 'd:\\calude\\ai memroy ext' || i.id.startsWith('d-drive-');
      return isCoreTarget || isMainProject;
    }
    return true;
  });

  // Filter & Activity Calculation
  const filteredItems = modeFilteredItems.filter(i => {
    if (filter === 'ACTIVE_MONTH') {
      return i.lastModified.startsWith('2026-07');
    }
    if (filter === 'OLD_INACTIVE') {
      return i.lastModified.startsWith('2026-06') || i.lastModified.startsWith('2026-05') || i.lastModified < '2026-07-01';
    }
    if (filter === 'HEAVY') {
      return i.sizeBytes >= 1000000000;
    }
    if (filter === 'PROJECTS') {
      return i.path.startsWith('D:') || i.path.startsWith('d:') || i.name.toLowerCase().includes('project') || i.category === 'Antigravity';
    }
    if (filter === 'GREEN') {
      return i.tier === 'GREEN';
    }
    if (filter === 'YELLOW') {
      return i.tier === 'YELLOW';
    }
    return true;
  });

  // Sorting Logic
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortBy === 'ACTIVE_TOP') {
      const aRecent = a.lastModified.startsWith('2026-07');
      const bRecent = b.lastModified.startsWith('2026-07');

      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      return b.lastModified.localeCompare(a.lastModified);
    }
    if (sortBy === 'SIZE_DESC') {
      return b.sizeBytes - a.sizeBytes;
    }
    if (sortBy === 'DATE_OLD') {
      return a.lastModified.localeCompare(b.lastModified);
    }
    if (sortBy === 'DATE_NEW') {
      return b.lastModified.localeCompare(a.lastModified);
    }
    return 0;
  });

  // Group items by parent directory for PARENT_GROUPED mode
  const parentGroups = sortedItems.reduce((acc, item) => {
    const parentDir = getParentDirectory(item.path);
    if (!acc[parentDir]) {
      acc[parentDir] = [];
    }
    acc[parentDir].push(item);
    return acc;
  }, {} as { [key: string]: AICacheItem[] });

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      {/* Table Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderGit2 size={20} color="#00f2fe" /> AI Memory & Multi-Drive Projects Footprint
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: '2px' }}>
            100% verified AI projects & software (downloads and non-AI file extension folders excluded)
          </p>
        </div>

        {/* View Mode Toggle Switch (Compact vs Parent Grouped vs Full List) */}
        <div style={{ display: 'flex', background: 'rgba(0, 0, 0, 0.4)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
          <button
            onClick={() => setViewMode('COMPACT')}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: 'none',
              background: viewMode === 'COMPACT' ? 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' : 'transparent',
              color: viewMode === 'COMPACT' ? '#ffffff' : '#9ca3af',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Layers size={13} /> Compact Main Folders
          </button>

          <button
            onClick={() => setViewMode('PARENT_GROUPED')}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: 'none',
              background: viewMode === 'PARENT_GROUPED' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'transparent',
              color: viewMode === 'PARENT_GROUPED' ? '#ffffff' : '#9ca3af',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <FolderTree size={13} /> 📁 Group by Parent Folder
          </button>

          <button
            onClick={() => setViewMode('FULL')}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: 'none',
              background: viewMode === 'FULL' ? 'linear-gradient(135deg, #9d4edd 0%, #7b2cbf 100%)' : 'transparent',
              color: viewMode === 'FULL' ? '#ffffff' : '#9ca3af',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <ListFilter size={13} /> Full Deep List ({sortedItems.length})
          </button>
        </div>
      </div>

      {/* SMART ACTIVITY & SIZE FILTER PILLS BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilter('ALL')}
            className={`badge ${filter === 'ALL' ? 'badge-green' : ''}`}
            style={{ cursor: 'pointer', background: filter === 'ALL' ? '#00f2fe' : 'rgba(255, 255, 255, 0.05)', color: filter === 'ALL' ? '#0b0f19' : '#fff' }}
          >
            Show All ({modeFilteredItems.length})
          </button>

          <button
            onClick={() => setFilter('ACTIVE_MONTH')}
            className="badge"
            style={{ cursor: 'pointer', background: filter === 'ACTIVE_MONTH' ? '#10b981' : 'rgba(16, 185, 129, 0.15)', color: filter === 'ACTIVE_MONTH' ? '#fff' : '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}
          >
            ⚡ Active This Month ({modeFilteredItems.filter(i => i.lastModified.startsWith('2026-07')).length})
          </button>

          <button
            onClick={() => setFilter('OLD_INACTIVE')}
            className="badge"
            style={{ cursor: 'pointer', background: filter === 'OLD_INACTIVE' ? '#f59e0b' : 'rgba(245, 158, 11, 0.15)', color: filter === 'OLD_INACTIVE' ? '#fff' : '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }}
          >
            🕰️ Old Untouched ({modeFilteredItems.filter(i => i.lastModified.startsWith('2026-06') || i.lastModified < '2026-07-01').length})
          </button>

          <button
            onClick={() => setFilter('HEAVY')}
            className="badge"
            style={{ cursor: 'pointer', background: filter === 'HEAVY' ? '#c084fc' : 'rgba(192, 132, 252, 0.15)', color: filter === 'HEAVY' ? '#fff' : '#c084fc', border: '1px solid rgba(192, 132, 252, 0.3)' }}
          >
            🔥 Heavy (&gt;1 GB) ({modeFilteredItems.filter(i => i.sizeBytes >= 1000000000).length})
          </button>

          <button
            onClick={() => setFilter('PROJECTS')}
            className="badge"
            style={{ cursor: 'pointer', background: filter === 'PROJECTS' ? '#60a5fa' : 'rgba(96, 165, 250, 0.15)', color: filter === 'PROJECTS' ? '#fff' : '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)' }}
          >
            📁 AI Projects Only
          </button>
        </div>

        {/* SORT CONTROL DROPDOWN */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowUpDown size={14} color="#9ca3af" />
          <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              padding: '6px 12px',
              background: '#0b0f19',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: '#00f2fe',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <option value="ACTIVE_TOP">⚡ Active Top (Newest First, Untouched Bottom)</option>
            <option value="SIZE_DESC">Largest Size First</option>
            <option value="DATE_OLD">Oldest Untouched First</option>
            <option value="DATE_NEW">Recently Modified First</option>
          </select>
        </div>
      </div>

      {/* Action Selection Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '10px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={selectAllSafe}>
            Select All Deletable Items
          </button>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
            Selected: <strong style={{ color: '#fff' }}>{selectedIds.length}</strong> items
          </span>
        </div>

        <button
          className="btn-danger"
          disabled={selectedIds.length === 0 || cleaning}
          onClick={() => onCleanSelected(selectedIds)}
          style={{ opacity: selectedIds.length === 0 ? 0.5 : 1 }}
        >
          <Trash2 size={16} /> Clean Selected Items
        </button>
      </div>

      {/* AUDIT TABLE: PARENT GROUPED ACCORDION VIEW OR FLAT TABLE VIEW */}
      {viewMode === 'PARENT_GROUPED' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {Object.entries(parentGroups).map(([parentDir, childItems]) => {
            const isExpanded = expandedParents[parentDir] !== false;
            
            // Calculate group size without double-counting nested subfolders
            const sortedGroup = [...childItems].sort((a, b) => a.path.length - b.path.length);
            const groupRoots: string[] = [];
            let totalGroupSize = 0;
            for (const item of sortedGroup) {
              const norm = item.path.toLowerCase();
              const isEnclosed = groupRoots.some(r => norm === r || norm.startsWith(r + '\\') || norm.startsWith(r + '/'));
              if (!isEnclosed) {
                groupRoots.push(norm);
                totalGroupSize += item.sizeBytes;
              }
            }


            return (
              <div key={parentDir} className="glass-card" style={{ padding: '0', overflow: 'hidden', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
                {/* Parent Folder Header Bar */}
                <div
                  onClick={() => toggleParentExpand(parentDir)}
                  style={{
                    padding: '14px 18px',
                    background: 'rgba(0, 242, 254, 0.08)',
                    display: 'flex',
                    justify: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {isExpanded ? <ChevronDown size={18} color="#00f2fe" /> : <ChevronRight size={18} color="#00f2fe" />}
                    <FolderOpen size={18} color="#00f2fe" />
                    <div>
                      <strong style={{ fontSize: '0.95rem', color: '#ffffff' }}>📁 Parent Directory: {parentDir}</strong>
                      <span style={{ fontSize: '0.74rem', color: '#9ca3af', display: 'block' }}>
                        Contains {childItems.length} subfolders & AI project targets
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="badge badge-green" style={{ fontSize: '0.78rem', fontWeight: 800 }}>
                      Group Size: {totalGroupSize >= 1073741824 ? `${(totalGroupSize / 1073741824).toFixed(2)} GB` : totalGroupSize >= 1048576 ? `${(totalGroupSize / 1048576).toFixed(2)} MB` : totalGroupSize >= 1024 ? `${(totalGroupSize / 1024).toFixed(2)} KB` : `${totalGroupSize} B`}
                    </span>


                    <button
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenFolder(parentDir);
                      }}
                      style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    >
                      Open Parent in Explorer
                    </button>
                  </div>
                </div>

                {/* Child Items Table inside Accordion */}
                {isExpanded && (
                  <div style={{ padding: '12px 16px', background: 'rgba(0, 0, 0, 0.2)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <tbody>
                        {childItems.map((item) => {
                          const isSelected = selectedIds.includes(item.id);
                          const isRecent = item.lastModified.startsWith('2026-07');
                          const canLaunch = isRunnableProject(item);

                          return (
                            <tr key={item.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                              <td style={{ padding: '10px 12px', width: '30px' }}>
                                <input
                                  type="checkbox"
                                  disabled={!item.canDelete}
                                  checked={isSelected}
                                  onChange={() => toggleSelect(item.id)}
                                />
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <span style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.88rem' }}>
                                  ↳ {item.name}
                                </span>
                                <div
                                  onClick={() => handleOpenFolder(item.path)}
                                  style={{ fontSize: '0.74rem', color: '#60a5fa', fontFamily: 'monospace', cursor: 'pointer', textDecoration: 'underline', marginTop: '2px' }}
                                >
                                  {item.path}
                                </div>
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <span style={{ fontSize: '0.74rem', color: isRecent ? '#34d399' : '#fbbf24' }}>
                                  {isRecent ? '⚡ Active' : '🕰️ Untouched'} ({item.lastModified})
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', fontWeight: 700, color: '#fff' }}>
                                {item.formattedSize}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                  {canLaunch && (
                                    <button
                                      className="btn-primary"
                                      onClick={() => handleLaunchLocalhost(item.path)}
                                      disabled={launchingPath === item.path}
                                      style={{ padding: '4px 10px', fontSize: '0.74rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                                    >
                                      <Rocket size={12} /> Localhost
                                    </button>
                                  )}
                                  <button className="btn-secondary" onClick={() => handleOpenFolder(item.path)} style={{ padding: '4px 10px', fontSize: '0.74rem' }}>
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
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* STANDARD FLAT TABLE VIEW */
        <div style={{ overflowX: 'auto', width: '100%', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <table style={{ width: '100%', minWidth: '850px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: '#9ca3af', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 16px', width: '40px' }}>
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) selectAllSafe();
                      else setSelectedIds([]);
                    }}
                    checked={selectedIds.length > 0 && selectedIds.length === sortedItems.filter(i => i.canDelete).length}
                  />
                </th>
                <th style={{ padding: '12px 16px' }}>Target Name & Directory Path</th>
                <th style={{ padding: '12px 16px' }}>Activity & Modified</th>
                <th style={{ padding: '12px 16px' }}>Safety Assessment</th>
                <th style={{ padding: '12px 16px' }}>Disk Size</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const driveLetter = getDriveLetter(item.path);
                const canLaunch = isRunnableProject(item);
                const isRecent = item.lastModified.startsWith('2026-07');

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      background: isSelected ? 'rgba(0, 242, 254, 0.05)' : 'transparent',
                      transition: 'background 0.2s ease'
                    }}
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <input
                        type="checkbox"
                        disabled={!item.canDelete}
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                      />
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{
                          background: driveLetter === 'D:' ? 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' : 'rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 800
                        }}>
                          Drive {driveLetter}
                        </span>

                        <span style={{
                          background: 'rgba(0, 242, 254, 0.12)',
                          border: '1px solid rgba(0, 242, 254, 0.3)',
                          color: '#00f2fe',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          <Cpu size={12} /> {item.category}
                        </span>

                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ffffff' }}>
                          {item.name}
                        </span>
                      </div>

                      <div
                        onClick={() => handleOpenFolder(item.path)}
                        style={{
                          fontSize: '0.78rem',
                          color: '#60a5fa',
                          fontFamily: 'monospace',
                          marginTop: '2px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          textDecoration: 'underline'
                        }}
                        title="Click to open folder in Windows Explorer / Finder"
                      >
                        <FolderOpen size={14} color="#00f2fe" />
                        <span>{item.path}</span>
                        <ExternalLink size={12} color="#60a5fa" />
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        fontSize: '0.76rem',
                        color: isRecent ? '#34d399' : '#fbbf24',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        {isRecent ? <Clock size={13} color="#34d399" /> : <Calendar size={13} color="#fbbf24" />}
                        {isRecent ? 'Active This Month' : 'Old / Untouched'}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#6b7280', display: 'block', marginTop: '2px' }}>
                        {item.lastModified}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
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
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: item.tier === 'RED' ? '#9ca3af' : '#ffffff' }}>
                      {item.formattedSize}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canLaunch && (
                          <button
                            className="btn-primary"
                            onClick={() => handleLaunchLocalhost(item.path)}
                            disabled={launchingPath === item.path}
                            style={{
                              padding: '5px 12px',
                              fontSize: '0.78rem',
                              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                              border: 'none',
                              boxShadow: '0 2px 10px rgba(16, 185, 129, 0.4)'
                            }}
                            title="Launch project on an available open localhost port with 0 conflict"
                          >
                            <Rocket size={13} /> {launchingPath === item.path ? 'Launching...' : '🚀 Launch Localhost'}
                          </button>
                        )}

                        <button
                          className="btn-secondary"
                          onClick={() => handleOpenFolder(item.path)}
                          style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                          title="Open Folder in Windows Explorer"
                        >
                          <FolderOpen size={13} /> Open Folder
                        </button>

                        {item.safeReason && (
                          <button
                            className="btn-secondary"
                            onClick={() => setActiveReasonItem(item)}
                            style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                          >
                            <Info size={13} /> Why Safe?
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Safety Reason Dialog */}
      {activeReasonItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          padding: '20px'
        }}>
          <div className="glass-card" style={{ maxWidth: '540px', width: '100%', padding: '24px', border: '1px solid var(--border-glow)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Info size={20} color="#00f2fe" /> Safety Assessment Explanation
            </h3>
            <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
              <strong style={{ color: '#00f2fe' }}>Software:</strong> {activeReasonItem.category}<br />
              <strong style={{ color: '#00f2fe' }}>Location:</strong> <code style={{ color: '#60a5fa', cursor: 'pointer' }} onClick={() => handleOpenFolder(activeReasonItem.path)}>{activeReasonItem.path}</code>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#d1d5db', lineHeight: '1.5', marginBottom: '20px' }}>
              {activeReasonItem.safeReason}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn-secondary" onClick={() => handleOpenFolder(activeReasonItem.path)}>
                <FolderOpen size={14} /> Open in Explorer
              </button>
              <button className="btn-primary" onClick={() => setActiveReasonItem(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
