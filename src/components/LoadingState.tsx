import React, { useEffect, useState } from 'react';

interface LoadingStateProps {
  title: string;
  detail?: string;
  /** Show what the background scan is doing right now (from /api/status). */
  live?: boolean;
  /** Smaller inline version for use inside a section. */
  compact?: boolean;
}

/**
 * The one loading state every page uses: centred in the content area, with a
 * spinner, what is happening, and how long it has been going — instead of a
 * lone "Scanning" label in a corner above an empty page.
 */
export const LoadingState: React.FC<LoadingStateProps> = ({ title, detail, live = false, compact = false }) => {
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await (await fetch('http://127.0.0.1:3333/api/status')).json();
        if (!alive) return;
        const scan = s.scan;
        setPhase(scan?.running ? `${scan.phase}${scan.total ? ` · ${scan.done} of ${scan.total}` : ''}` : null);
      } catch { /* engine starting up */ }
      if (alive) timer = setTimeout(poll, 1500);
    };
    if (live) void poll();
    return () => { alive = false; clearInterval(tick); clearTimeout(timer); };
  }, [live]);

  return (
    <div className={`ins-loading${compact ? ' ins-loading--compact' : ''}`} role="status" aria-live="polite">
      <div className="ins-loading-orb" aria-hidden>
        <span />
      </div>
      <strong>{title}</strong>
      {phase && <span className="ins-loading-phase">{phase}</span>}
      {detail && <p>{detail}</p>}
      {elapsed >= 2 && <span className="ins-loading-time ins-data">{elapsed}s</span>}
    </div>
  );
};
