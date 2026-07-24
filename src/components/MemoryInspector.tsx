import React, { useState } from 'react';
import { Search, Eye, ShieldCheck, FileText, Lock } from 'lucide-react';

export const MemoryInspector: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState<string>('');

  const mockMemories = [
    { id: '1', title: 'Antigravity Session Transcript #142', tool: 'Antigravity', snippet: 'Project memory initialized. Configured local SQLite storage connection.', size: '4.2 MB', sensitiveFlag: false },
    { id: '2', title: 'MCP Memory Store (@modelcontextprotocol)', tool: 'MCP Memory', snippet: 'Stored user preferences and workspace path bindings.', size: '1.8 MB', sensitiveFlag: false },
    { id: '3', title: 'Cline Task History - Auth Refactor', tool: 'Cline / Roo Code', snippet: 'Task execution log: Refactored authentication module and JWT token handlers.', size: '12.4 MB', sensitiveFlag: true },
    { id: '4', title: 'Continue.dev SQLite Vector Index', tool: 'Continue.dev', snippet: 'Codebase embedding index for fast semantic search.', size: '45.1 MB', sensitiveFlag: false }
  ];

  const filtered = mockMemories.filter(m => 
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
            Search local vector DBs, MCP memory stores, and AI transcripts in plain text
          </p>
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.05)', padding: '8px 14px', borderRadius: '10px', width: '300px' }}>
          <Search size={16} color="#9ca3af" />
          <input
            type="text"
            placeholder="Search AI memories (e.g. .env, API key)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.85rem', outline: 'none', width: '100%' }}
          />
        </div>
      </div>

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
                  <Lock size={10} /> Contains Code Snippets
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
    </div>
  );
};
