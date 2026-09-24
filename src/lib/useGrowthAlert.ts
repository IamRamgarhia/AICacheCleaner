import { useEffect } from 'react';
import type { SystemMetrics } from '../types';
import type { GrowthReport } from './types/growth';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LAST_KEY = 'aicc_last_growth_alert_date';
const GB = 1024 ** 3;

interface GrowthAlertConfig { growthAlertGb?: number | null }

const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Pure decision, kept separate so it can be tested without timers. `lastDate`/`date` are YYYY-MM-DD. */
export function shouldAlertGrowth(totalBytes: number, thresholdGb: number | null | undefined, lastDate: string | null, date: string): boolean {
  if (typeof thresholdGb !== 'number' || !Number.isFinite(thresholdGb) || thresholdGb <= 0) return false;
  return totalBytes > thresholdGb * GB && lastDate !== date;
}

function readLast(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

/**
 * Opt-in alert: when total AI storage passes `growthAlertGb`, show one OS
 * notification per day at most. Checks on every new scan result and every
 * 6 hours from the growth history while the app stays open. Informs only.
 */
export function useGrowthAlert(cfg: GrowthAlertConfig | null, metrics: SystemMetrics | null): void {
  const thresholdGb = cfg?.growthAlertGb ?? null;
  const total = metrics?.totalAICacheBytes;

  useEffect(() => {
    if (typeof thresholdGb !== 'number' || thresholdGb <= 0) return;

    const check = (bytes: number) => {
      const date = today();
      if (!shouldAlertGrowth(bytes, thresholdGb, readLast(), date)) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const n = new Notification('AICacheCleaner', {
        body: `AI tools now use ${(bytes / GB).toFixed(1)} GB, over your ${thresholdGb} GB alert. Open the app to see what grew.`,
        icon: './app-icon.png'
      });
      n.onclick = () => window.focus();
      try { localStorage.setItem(LAST_KEY, date); } catch { /* private mode */ }
    };

    if (typeof total === 'number') check(total);

    const timer = setInterval(async () => {
      try {
        const report = (await (await fetch('http://127.0.0.1:3333/api/growth')).json()) as GrowthReport;
        const latest = report.points?.[report.points.length - 1];
        if (latest) check(latest.totalBytes);
      } catch {
        // Engine offline; try again next interval.
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [thresholdGb, total]);
}
