import React, { useState, useEffect } from 'react';
import { Search, Eye, ShieldCheck, FileText, Lock, RefreshCw } from 'lucide-react';

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
  const [apiFailed, setApiFailed] = useState<boolean>(false);

  const fetchRealMemories = async () => {
    setLoading(true);
    setApiFailed(false);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/memories');
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      } else {
        setApiFailed(true);
      }
    } catch (e) {
      // Backend unavailable — show an honest empty state instead of fabricated data.
      setApiFailed(true);
      setMemories([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRealMemories();
  }, []);

  const filtered = memories.filter(m => 
    m.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.snippet.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.tool.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Eye size={20} color="#00f2fe" /> Privacy & AI Memory Inspector
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '4px' }}>
            Inspect real local vector DBs, MCP memory stores, and AI transcripts stored on disk
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchRealMemories}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.05)', padding: '8px 14px', borderRadius: '10px', width: '280px' }}>
            <Search size={16} color="#9ca3af" />
            <input
              type="text"
              placeholder="Search AI memories (e.g. .env, key)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.85rem', outline: 'none', width: '100%' }}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
          Scanning local AI memory stores...
        </div>
      ) : apiFailed ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#f87171' }}>
          Couldn't reach the local scan engine at <code>http://127.0.0.1:3333</code>.
          <br />Make sure AICacheCleaner is running, then click Refresh.
        </div>
      ) : memories.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
          No local AI memory stores found on this machine.
          <br />Supported stores include <code>.gemini</code>, <code>.mcp</code>, <code>.claude</code>, and <code>.cursor</code>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(item => (
            <div key={item.id} className="glass-card" style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={16} color="#00f2fe" />
                  <span style={{ fontWeight: 700, color: '#f3f4f6' }}>{item.title}</span>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'rgba(255, 255, 255, 0.08)', padding: '2px 8px', borderRadius: '4px' }}>
                    {item.tool}
                  </span>
                </div>

                {item.sensitiveFlag && (
                  <span className="badge badge-yellow" style={{ fontSize: '0.7rem' }}>
                    <Lock size={10} /> Contains Local Transcripts
                  </span>
                )}
              </div>

              <div style={{ fontSize: '0.82rem', color: '#9ca3af', fontFamily: 'monospace', background: 'rgba(0, 0, 0, 0.3)', padding: '10px', borderRadius: '6px', marginBottom: '10px' }}>
                {item.snippet}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#6b7280' }}>
                <span>Footprint: {item.size}</span>
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ShieldCheck size={12} /> Stored locally on hard drive
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
