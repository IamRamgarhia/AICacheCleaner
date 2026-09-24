import { useEffect } from 'react';
import type { SystemMetrics } from '../types';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const AT_MOST_EVERY_MS = 24 * 60 * 60 * 1000;
const LAST_KEY = 'aicc_last_reminder_at';

interface ReminderConfig { reminderEnabled?: boolean; reminderGb?: number }

/** Pure decision, kept separate so it can be tested without timers. */
export function shouldRemind(reclaimableBytes: number, cfg: ReminderConfig, lastAt: number, now: number): boolean {
  if (!cfg.reminderEnabled || !cfg.reminderGb) return false;
  if (reclaimableBytes < cfg.reminderGb * 1024 ** 3) return false;
  return now - lastAt >= AT_MOST_EVERY_MS;
}

function readLast(): number {
  try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; }
}

/**
 * Opt-in reminder: while the app is open it re-checks every 6 hours and shows
 * one OS notification a day at most. It only informs — cleaning always needs
 * the user to open the app and confirm.
 */
export function useReclaimReminder(cfg: ReminderConfig | null, metrics: SystemMetrics | null): void {
  const enabled = Boolean(cfg?.reminderEnabled);
  const gb = cfg?.reminderGb ?? 0;
  const bytes = metrics?.reclaimableBytes;

  useEffect(() => {
    if (!enabled) return;
    const settings = { reminderEnabled: enabled, reminderGb: gb };

    const notify = (reclaimable: number) => {
      const now = Date.now();
      if (!shouldRemind(reclaimable, settings, readLast(), now)) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const n = new Notification('AICacheCleaner', {
        body: `${(reclaimable / 1024 ** 3).toFixed(1)} GB of caches is safe to reclaim. Open the app to review — nothing is deleted without you.`,
        icon: './app-icon.png'
      });
      n.onclick = () => window.focus();
      try { localStorage.setItem(LAST_KEY, String(now)); } catch { /* private mode */ }
    };

    if (typeof bytes === 'number') notify(bytes);

    const timer = setInterval(async () => {
      try {
        const res = await fetch('http://127.0.0.1:3333/api/scan?refresh=1');
        const data = await res.json();
        notify(data.metrics?.reclaimableBytes ?? 0);
      } catch {
        // Engine offline; try again next interval.
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [enabled, gb, bytes]);
}
