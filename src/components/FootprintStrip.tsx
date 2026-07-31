import React, { useState } from 'react';
import type { AICacheItem } from '../types';
import { toolColor } from '../lib/toolColors';

interface FootprintStripProps {
  items: AICacheItem[];
  totalBytes: number;
  reclaimableBytes: number;
  onSelectCategory?: (category: string | null) => void;
  selectedCategory?: string | null;
}

/**
 * The signature element: the machine's AI footprint drawn to scale.
 *
 * This replaces four stat cards that each had a different decorative border
 * colour and a "Click to view →" affordance. A storage tool's whole job is to
 * show proportion, and a number in a box does not do that — you cannot see
 * that Antigravity is as large as Claude and that Cursor is a rounding error
 * until the widths are real.
 *
 * Segments carry each tool's identity colour (see lib/toolColors). That is a
 * second, independent data channel from the safety tiers: identity hues are
 * desaturated and only ever used as markers/segments, never as a fill behind
 * text, so they cannot be mistaken for a safety state.
 */

// Below this share a segment would be sub-pixel, so it is omitted from the bar
// and marked in the legend instead. Drawing a visible sliver for 1.7 KB out of
// 32 GB would misrepresent the proportion the strip exists to communicate.
const MIN_VISIBLE_PCT = 0.15;

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`;
}

export const FootprintStrip: React.FC<FootprintStripProps> = ({
  items,
  totalBytes,
  reclaimableBytes,
  onSelectCategory,
  selectedCategory
}) => {
  const [hovered, setHovered] = useState<string | null>(null);

  // Group by tool, largest first. Uses the non-overlapping total from the
  // backend as the denominator so segment widths stay honest even though
  // nested caches are listed separately.
  const byCategory = new Map<string, number>();
  for (const item of items) {
    // Skip items enclosed by another listed item, otherwise a parent and its
    // child cache would both be counted and the strip would over-report.
    const isNested = items.some(other => {
      if (other.id === item.id) return false;
      const outer = other.path.toLowerCase().replace(/[\\/]+$/, '');
      return item.path.toLowerCase().startsWith(outer + '\\') || item.path.toLowerCase().startsWith(outer + '/');
    });
    if (isNested) continue;
    byCategory.set(item.category, (byCategory.get(item.category) || 0) + item.sizeBytes);
  }

  const segments = [...byCategory.entries()]
    .map(([category, bytes]) => ({ category, bytes }))
    .sort((a, b) => b.bytes - a.bytes);

  const denominator = totalBytes > 0 ? totalBytes : segments.reduce((a, s) => a + s.bytes, 0) || 1;
  const reclaimablePct = Math.min(100, (reclaimableBytes / denominator) * 100);

  return (
    <div className="ins-panel" style={{ padding: 'var(--ins-space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--ins-space-4)' }}>
        <span className="ins-label">AI footprint on this machine</span>
        <span className="ins-data" style={{ fontSize: '1.75rem', fontWeight: 500, letterSpacing: '-0.02em' }}>
          {formatBytes(totalBytes)}
        </span>
      </div>

      {/* The strip itself */}
      <div
        role="img"
        aria-label={`Total AI storage ${formatBytes(totalBytes)}. ${segments
          .map(s => `${s.category} ${formatBytes(s.bytes)}`)
          .join(', ')}.`}
        style={{
          display: 'flex',
          height: '34px',
          borderRadius: '3px',
          overflow: 'hidden',
          background: 'var(--ins-graphite-850)',
          border: '1px solid var(--ins-graphite-700)'
        }}
      >
        {segments.map((seg) => {
          const pct = (seg.bytes / denominator) * 100;
          if (pct < MIN_VISIBLE_PCT) return null;
          const isActive = selectedCategory === seg.category;
          const isDim = selectedCategory !== null && selectedCategory !== undefined && !isActive;
          return (
            <button
              key={seg.category}
              onClick={() => onSelectCategory?.(isActive ? null : seg.category)}
              onMouseEnter={() => setHovered(seg.category)}
              onMouseLeave={() => setHovered(null)}
              title={`${seg.category} — ${formatBytes(seg.bytes)} (${pct.toFixed(1)}%)`}
              aria-pressed={isActive}
              style={{
                width: `${pct}%`,
                background: toolColor(seg.category),
                border: 'none',
                borderRight: '2px solid var(--ins-graphite-900)',
                cursor: 'pointer',
                padding: 0,
                opacity: isDim ? 0.3 : 1,
                filter: hovered === seg.category ? 'brightness(1.15)' : 'none',
                transition: 'opacity 0.12s ease, filter 0.12s ease'
              }}
            />
          );
        })}
      </div>

      {/* Reclaimable is shown as a measurement UNDER the strip rather than a
          slice inside it: it is a subset of the bar above, not a sibling. */}
      <div style={{ marginTop: 'var(--ins-space-2)', position: 'relative', height: '18px' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${Math.max(reclaimablePct, 0.4)}%`,
            height: '4px',
            background: 'var(--ins-safe)',
            borderRadius: '2px'
          }}
        />
        <span
          className="ins-data"
          style={{ position: 'absolute', top: '7px', left: 0, fontSize: '0.75rem', color: 'var(--ins-safe)' }}
        >
          {formatBytes(reclaimableBytes)} safe to reclaim
        </span>
      </div>

      {/* Legend doubles as the filter control */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ins-space-4)', marginTop: 'var(--ins-space-5)' }}>
        {segments.map((seg) => {
          const isActive = selectedCategory === seg.category;
          const pct = (seg.bytes / denominator) * 100;
          // Tools too small to draw still appear here, flagged — otherwise the
          // legend claims a segment the bar never shows.
          const tooSmallToDraw = pct < MIN_VISIBLE_PCT;
          return (
            <button
              key={seg.category}
              onClick={() => onSelectCategory?.(isActive ? null : seg.category)}
              className="ins-btn ins-btn--quiet"
              style={{
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '2px',
                background: isActive ? 'var(--ins-graphite-750)' : 'transparent',
                borderColor: isActive ? 'var(--ins-graphite-700)' : 'transparent'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '2px',
                    background: toolColor(seg.category),
                    opacity: tooSmallToDraw ? 0.4 : 1,
                    flexShrink: 0
                  }}
                />
                <span style={{ fontSize: '0.8125rem', color: 'var(--ins-mist-300)' }}>{seg.category}</span>
              </span>
              <span
                className="ins-data"
                style={{
                  fontSize: '0.875rem',
                  color: tooSmallToDraw ? 'var(--ins-mist-500)' : 'var(--ins-mist-50)',
                  paddingLeft: '14px'
                }}
              >
                {formatBytes(seg.bytes)}
                {tooSmallToDraw && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--ins-mist-500)' }}> · too small to chart</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
