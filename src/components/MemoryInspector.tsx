import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, Lock } from 'lucide-react';

interface MemoryItem {
  id: string;
  title: string;
  tool: string;
  snippet: string;
  size: string;
  sensitiveFlag: boolean;
  path?: string;
}

export const MemoryInspector: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  const fetchRealMemories = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/memories');
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      } else {
        setFailed(true);
      }
    } catch (e) {
      setFailed(true);
      setMemories([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRealMemories();
  }, []);

  const q = searchTerm.toLowerCase();
  const filtered = memories.filter(
    m =>
      m.title.toLowerCase().includes(q) ||
      m.snippet.toLowerCase().includes(q) ||
      m.tool.toLowerCase().includes(q)
  );

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Stored transcripts</h1>
          <p className="ins-sub">
            Where your AI tools keep conversation history and memory on this disk. Nothing here is read or
            sent anywhere — this view lists locations and sizes so you can decide what to keep.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ins-space-2)', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ins-mist-500)' }}
            />
            <input
              className="ins-input"
              style={{ paddingLeft: '28px', width: '220px' }}
              type="text"
              placeholder="Filter by tool or path"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="ins-btn" onClick={fetchRealMemories} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </header>

      {loading ? (
        <div className="ins-empty">Reading local storage locations…</div>
      ) : failed ? (
        <div className="ins-note ins-note--error">
          Can&apos;t reach the local engine on port 3333. Make sure AICacheCleaner is running, then refresh.
        </div>
      ) : filtered.length === 0 ? (
        <div className="ins-empty">
          <strong>{memories.length === 0 ? 'No stored transcripts found' : 'Nothing matches that filter'}</strong>
          {memories.length === 0
            ? 'Supported locations include .claude, .gemini, .cursor and .mcp.'
            : 'Clear the filter to see all locations.'}
        </div>
      ) : (
        <div className="ins-panel" style={{ padding: 'var(--ins-space-4)' }}>
          <table className="ins-table">
            <thead>
              <tr>
                <th>Location</th>
                <th style={{ width: '110px' }}>Tool</th>
                <th style={{ width: '140px' }}>Contents</th>
                <th style={{ width: '90px' }} className="ins-num">Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ color: 'var(--ins-mist-50)' }}>{item.title}</div>
                    <span className="ins-data ins-meta">{item.path ?? item.snippet}</span>
                  </td>
                  <td className="ins-meta">{item.tool}</td>
                  <td>
                    {item.sensitiveFlag ? (
                      <span className="ins-tier ins-tier--review">
                        <Lock size={9} style={{ marginLeft: '-2px' }} /> Conversations
                      </span>
                    ) : (
                      <span className="ins-meta">Config &amp; cache</span>
                    )}
                  </td>
                  <td className="ins-num ins-data">{item.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
