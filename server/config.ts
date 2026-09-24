import path from 'path';

// Persistent Local Configuration Engine
export interface AppConfig {
  cacheThresholdGb: number;
  restorePointPolicy: 'PROMPT' | 'ALWAYS' | 'NEVER';
  customRestorePath: string;
  /** Opt-in: notify (never delete) when this much is safe to reclaim. */
  reminderEnabled: boolean;
  reminderGb: number;
}

/** Keep only known keys with sane values; the body is untrusted input. */
export function sanitizeConfig(input: unknown): Partial<AppConfig> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<AppConfig> = {};
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  const threshold = num(o.cacheThresholdGb, 0, 100_000);
  if (threshold !== undefined) out.cacheThresholdGb = threshold;
  if (o.restorePointPolicy === 'PROMPT' || o.restorePointPolicy === 'ALWAYS' || o.restorePointPolicy === 'NEVER') {
    out.restorePointPolicy = o.restorePointPolicy;
  }
  if (typeof o.customRestorePath === 'string' && o.customRestorePath.length < 1024 && path.isAbsolute(o.customRestorePath)) {
    out.customRestorePath = o.customRestorePath;
  }
  if (typeof o.reminderEnabled === 'boolean') out.reminderEnabled = o.reminderEnabled;
  const reminder = num(o.reminderGb, 0.5, 10_000);
  if (reminder !== undefined) out.reminderGb = reminder;
  return out;
}
