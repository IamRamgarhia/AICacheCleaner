// Daily history of how much AI storage there is, per tool, so the overview
// can show which tool is growing. One point per local day (latest scan wins),
// kept for RETENTION_DAYS, written atomically next to the app's other data.

import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AICacheItem } from '../src/types';
import type { GrowthPoint, GrowthReport, ToolGrowth } from '../src/lib/types/growth';
import { calculateNonOverlappingSize } from './scanner';

export const RETENTION_DAYS = 120;
const DEFAULT_FILE = path.join(os.homedir(), '.ai-cache-cleaner', 'growth-history.json');
const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Totals for one scan. Nested items are counted once, like the headline total. */
export function pointFromItems(items: AICacheItem[], date: string): GrowthPoint {
  const byTool = new Map<string, AICacheItem[]>();
  for (const item of items) {
    const list = byTool.get(item.category);
    if (list) list.push(item);
    else byTool.set(item.category, [item]);
  }
  const perTool = Object.fromEntries([...byTool].map(([tool, list]) => [tool, calculateNonOverlappingSize(list)]));
  return { date, totalBytes: calculateNonOverlappingSize(items), perTool };
}

/** Insert or replace the point for its day, sorted, trimmed to the retention window. */
export function addPoint(points: GrowthPoint[], point: GrowthPoint): GrowthPoint[] {
  const merged = [...points.filter(p => p.date !== point.date), point].sort((a, b) => a.date.localeCompare(b.date));
  const newest = dayNumber(merged[merged.length - 1].date);
  return merged.filter(p => newest - dayNumber(p.date) < RETENTION_DAYS);
}

/**
 * Baseline for an N-day change: the newest point at least N days old, or the
 * oldest point when history is shorter than N days. Null with a single point.
 */
function baseline(points: GrowthPoint[], days: number): GrowthPoint | null {
  if (points.length < 2) return null;
  const latest = dayNumber(points[points.length - 1].date);
  const older = points.filter(p => latest - dayNumber(p.date) >= days);
  return older.length > 0 ? older[older.length - 1] : points[0];
}

export function computeGrowth(points: GrowthPoint[]): GrowthReport {
  const latest = points[points.length - 1];
  if (!latest) return { points: [], spanDays: 0, totalChange7d: null, totalChange30d: null, tools: [] };
  const b7 = baseline(points, 7);
  const b30 = baseline(points, 30);
  const change = (base: GrowthPoint | null, tool: string) => (base ? (latest.perTool[tool] ?? 0) - (base.perTool[tool] ?? 0) : null);

  const names = new Set([...Object.keys(latest.perTool), ...Object.keys(b7?.perTool ?? {}), ...Object.keys(b30?.perTool ?? {})]);
  const tools: ToolGrowth[] = [...names].map(tool => ({
    tool,
    currentBytes: latest.perTool[tool] ?? 0,
    change7d: change(b7, tool),
    change30d: change(b30, tool)
  }));
  const rank = (t: ToolGrowth) => t.change7d ?? t.change30d ?? 0;
  tools.sort((a, b) => rank(b) - rank(a) || (b.change30d ?? 0) - (a.change30d ?? 0) || b.currentBytes - a.currentBytes);

  return {
    points,
    spanDays: dayNumber(latest.date) - dayNumber(points[0].date),
    totalChange7d: b7 ? latest.totalBytes - b7.totalBytes : null,
    totalChange30d: b30 ? latest.totalBytes - b30.totalBytes : null,
    tools
  };
}

const validPoint = (p: unknown): p is GrowthPoint => {
  const o = p as GrowthPoint;
  return !!o && typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
    Number.isFinite(o.totalBytes) && !!o.perTool && typeof o.perTool === 'object' &&
    Object.values(o.perTool).every(v => Number.isFinite(v));
};

async function readPoints(file: string): Promise<GrowthPoint[]> {
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf-8'));
    return Array.isArray(data?.points) ? data.points.filter(validPoint) : [];
  } catch {
    // Missing or corrupt: start a fresh history rather than fail the scan.
    return [];
  }
}

async function writePoints(file: string, points: GrowthPoint[]): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ version: 1, points }), 'utf-8');
  await fsp.rename(tmp, file);
}

// Serialises read-modify-write so two scans finishing together cannot drop a point.
let queue: Promise<unknown> = Promise.resolve();

export interface GrowthOptions { file?: string; now?: Date }

/** Record the result of a completed full scan. Rejects only if the file cannot be written. */
export function recordScan(items: AICacheItem[], opts: GrowthOptions = {}): Promise<void> {
  // An empty result is a failed or interrupted scan, not a machine with 0 bytes.
  if (items.length === 0) return Promise.resolve();
  const file = opts.file ?? DEFAULT_FILE;
  const point = pointFromItems(items, localDate(opts.now ?? new Date()));
  const run = queue.then(async () => writePoints(file, addPoint(await readPoints(file), point)));
  queue = run.catch(() => undefined);
  return run;
}

export async function getGrowth(opts: GrowthOptions = {}): Promise<GrowthReport> {
  await queue;
  return computeGrowth(await readPoints(opts.file ?? DEFAULT_FILE));
}
