/**
 * Live progress for the running export.
 *
 * Archiving a large project takes tens of seconds (2.4 GB took 42 s), and the
 * UI previously showed a static "Packaging…" label for the whole time with no
 * indication of whether it was working, stuck, or nearly done.
 *
 * archiver already emits per-entry progress; this just holds the latest value
 * so a polling endpoint can report it. Only one export runs at a time from the
 * UI, so a single slot is enough — no job registry needed.
 */
export interface ExportProgress {
  active: boolean;
  label: string;
  filesProcessed: number;
  bytesProcessed: number;
  /** Files archiver has queued so far. Grows while it enumerates. */
  filesTotal: number;
  /** Bytes archiver has queued. Used for the percentage; 0 when unknown. */
  totalBytes: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

const idle: ExportProgress = {
  active: false,
  label: '',
  filesProcessed: 0,
  bytesProcessed: 0,
  filesTotal: 0,
  totalBytes: 0,
  startedAt: 0
};

let current: ExportProgress = { ...idle };

export function beginExport(label: string, totalBytes: number): void {
  current = { ...idle, active: true, label, totalBytes, startedAt: Date.now() };
}

export function updateExport(
  filesProcessed: number,
  bytesProcessed: number,
  filesTotal?: number,
  bytesTotal?: number
): void {
  if (!current.active) return;
  current.filesProcessed = filesProcessed;
  current.bytesProcessed = bytesProcessed;
  // Prefer the archiver's own totals: they cover exactly what is being written,
  // excluding node_modules/.git, so the percentage actually reaches 100%.
  if (typeof filesTotal === 'number' && filesTotal > 0) current.filesTotal = filesTotal;
  if (typeof bytesTotal === 'number' && bytesTotal > 0) current.totalBytes = bytesTotal;
}

export function finishExport(error?: string): void {
  current = { ...current, active: false, finishedAt: Date.now(), error };
}

export function getExportProgress(): ExportProgress & { elapsedMs: number; percent: number } {
  const elapsedMs = current.startedAt ? (current.finishedAt ?? Date.now()) - current.startedAt : 0;
  // Compressed output is smaller than the source, so the ratio can overshoot;
  // clamp so the bar never reports more than 99% until it actually finishes.
  const raw = current.totalBytes > 0 ? (current.bytesProcessed / current.totalBytes) * 100 : 0;
  const percent = current.active ? Math.min(99, Math.max(0, raw)) : current.finishedAt ? 100 : 0;
  return { ...current, elapsedMs, percent };
}
