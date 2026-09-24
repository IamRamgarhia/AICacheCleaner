import React, { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { GrowthPoint, GrowthReport, ToolGrowth } from '../lib/types/growth';
import { formatBytes } from '../lib/format';
import { toolColor } from '../lib/toolColors';
import { LoadingState } from './LoadingState';
import { apiJson, requireArrays } from '../lib/shape';

interface GrowthPanelProps {
  /** Change this (e.g. to the last scan timestamp) to refetch after a scan. */
  refreshKey?: string | number | null;
}

const TOP_TOOLS = 5;
const W = 240;
const H = 48;

const signed = (bytes: number | null) =>
  bytes === null ? '—' : bytes === 0 ? '0 B' : `${bytes > 0 ? '+' : '−'}${formatBytes(Math.abs(bytes))}`;

const deltaColor = (bytes: number | null) =>
  bytes && bytes > 0 ? 'var(--ins-review)' : bytes && bytes < 0 ? 'var(--ins-safe)' : 'var(--ins-mist-500)';

function Sparkline({ points }: { points: GrowthPoint[] }) {
  const values = points.map(p => p.totalBytes);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / range) * (H - 4);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Total AI storage from ${formatBytes(first.totalBytes)} on ${first.date} to ${formatBytes(last.totalBytes)} on ${last.date}`}
      style={{ width: '100%', height: `${H}px`, display: 'block' }}
    >
      <polyline points={`0,${H} ${line} ${W},${H}`} fill="var(--ins-graphite-750)" stroke="none" />
      <polyline points={line} fill="none" stroke="var(--ins-mist-300)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ToolRow({ tool, window: days }: { tool: ToolGrowth; window: 7 | 30 }) {
  const change = days === 7 ? tool.change7d : tool.change30d;
  return (
    <tr>
      <td>
        <span className="ins-tool-name">
          <span className="ins-dot" style={{ background: toolColor(tool.tool) }} />
          <span style={{ color: 'var(--ins-mist-50)' }}>{tool.tool}</span>
        </span>
      </td>
      <td className="ins-num ins-data" style={{ color: deltaColor(change) }}>{signed(change)}</td>
      <td className="ins-num ins-data ins-meta">{formatBytes(tool.currentBytes)}</td>
    </tr>
  );
}

/**
 * Overview panel: how total AI storage has moved over time and which tools
 * grew fastest. Built from one saved point per day of scanning.
 */
export const GrowthPanel: React.FC<GrowthPanelProps> = ({ refreshKey }) => {
  const [report, setReport] = useState<GrowthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30>(7);

  useEffect(() => {
    let alive = true;
    fetch('http://127.0.0.1:3333/api/growth')
      .then(async r => {
        const body = await apiJson(r);
        if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
        if (alive) { setReport(requireArrays<GrowthReport>(body, ['points', 'tools'])); setError(null); }
      })
      .catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [refreshKey]);

  const total = days === 7 ? report?.totalChange7d ?? null : report?.totalChange30d ?? null;
  const span = report ? Math.min(days, report.spanDays) : days;
  const tools = (report?.tools ?? [])
    .filter(t => (days === 7 ? t.change7d : t.change30d) !== null)
    .sort((a, b) => ((days === 7 ? b.change7d : b.change30d) ?? 0) - ((days === 7 ? a.change7d : a.change30d) ?? 0))
    .slice(0, TOP_TOOLS);

  return (
    <div className="ins-panel" style={{ padding: 'var(--ins-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-3)' }}>
      <div className="ins-section-head">
        <TrendingUp size={15} />
        <span className="ins-card-title">Growth</span>
        {report && report.points.length >= 2 && (
          <div className="ins-segmented" role="group" aria-label="Window" style={{ marginLeft: 'auto' }}>
            {([7, 30] as const).map(d => (
              <button key={d} className={days === d ? 'is-on' : ''} onClick={() => setDays(d)} aria-pressed={days === d}>
                {d} days
              </button>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p className="ins-meta">Growth history is unavailable: {error}</p>
      ) : !report ? (
        <LoadingState compact title="Reading growth history" />
      ) : report.points.length < 2 ? (
        <div className="ins-empty">
          <strong>Growth fills in after a few days of scans</strong>
          Each day you scan, the app saves one total per tool. After two or more days you will see the trend here and
          which tools are growing fastest.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ins-space-2)', flexWrap: 'wrap' }}>
            <span className="ins-data" style={{ fontSize: '1.25rem', color: deltaColor(total) }}>{signed(total)}</span>
            <span className="ins-meta">
              over the last {span} day{span === 1 ? '' : 's'} · now {formatBytes(report.points[report.points.length - 1].totalBytes)}
            </span>
          </div>
          <Sparkline points={report.points} />
          {tools.length > 0 && (
            <table className="ins-table">
              <thead>
                <tr>
                  <th>Fastest growing</th>
                  <th className="ins-num" style={{ width: '100px' }}>Change</th>
                  <th className="ins-num" style={{ width: '90px' }}>Now</th>
                </tr>
              </thead>
              <tbody>
                {tools.map(t => <ToolRow key={t.tool} tool={t} window={days} />)}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};
