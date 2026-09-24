import React from 'react';
import { Search, X } from 'lucide-react';

interface TitleBarProps {
  pageTitle: string;
  query: string;
  onQueryChange: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The window's own title bar. The OS window buttons are drawn over its right
 * edge (Electron titleBarOverlay), so the bar is draggable everywhere except
 * the search box.
 */
export const TitleBar: React.FC<TitleBarProps> = ({ pageTitle, query, onQueryChange, searchRef }) => (
  <header className="ins-titlebar">
    <div className="ins-titlebar-brand">
      <img src="./app-icon.png" alt="" width={16} height={16} />
      <span>AICacheCleaner</span>
      <span className="ins-titlebar-sep">/</span>
      <span className="ins-titlebar-page">{pageTitle}</span>
    </div>

    <label className="ins-titlebar-search">
      <Search size={13} aria-hidden />
      <input
        ref={searchRef}
        type="search"
        placeholder="Search locations  (Ctrl+F)"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { onQueryChange(''); e.currentTarget.blur(); } }}
        aria-label="Search locations"
        spellCheck={false}
      />
      {query && (
        <button type="button" onClick={() => onQueryChange('')} aria-label="Clear search">
          <X size={12} />
        </button>
      )}
    </label>

    <div className="ins-titlebar-spacer" />
  </header>
);
