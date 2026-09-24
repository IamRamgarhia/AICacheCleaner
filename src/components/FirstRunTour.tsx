import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';

const DONE_KEY = 'aicc_tour_done_v1';

const STEPS: { title: string; body: string; tab?: string }[] = [
  {
    title: 'Welcome to AICacheCleaner',
    body: 'It measures what AI tools, app caches and dev toolchains store on your drives, and helps you reclaim the parts that rebuild themselves. It runs only while you have it open.'
  },
  {
    title: 'Three safety colours',
    body: 'Green “Rebuilds itself” is safe to remove. Amber “Your data” needs a decision you make yourself. Red “Protected” is never deleted by this app. Everything you delete goes to the Recycle Bin after a confirmation, and anything too big for the bin is refused.',
    tab: 'SAFE_DELETE'
  },
  {
    title: 'Find anything',
    body: 'Ctrl+F searches every location. In lists, use ↑/↓, Space to select, Enter to open the folder, Delete to delete (it still asks). Right-click a row for more. Ctrl+R rescans.',
    tab: 'STORAGE'
  },
  {
    title: 'Where did my space go?',
    body: 'Disk explorer shows any folder or drive largest-first, and Safe to delete lists Windows items (hibernation file, update leftovers) with step-by-step instructions.',
    tab: 'EXPLORER'
  }
];

function isDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; }
}

/** Shown once on first launch; skippable at any step. */
export const FirstRunTour: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [step, setStep] = useState<number | null>(() => (isDone() ? null : 0));
  if (step === null) return null;

  const finish = () => {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode: show again next time */ }
    setStep(null);
  };
  const go = (n: number) => {
    if (n >= STEPS.length) return finish();
    if (STEPS[n].tab) onNavigate(STEPS[n].tab!);
    setStep(n);
  };
  const s = STEPS[step];

  return (
    <div className="ins-tour" role="dialog" aria-modal="false" aria-label="Getting started">
      <div className="ins-tour-head">
        <ShieldCheck size={15} style={{ color: 'var(--ins-safe)' }} />
        <strong>{s.title}</strong>
        <button className="ins-btn ins-btn--quiet" onClick={finish} aria-label="Skip tour" style={{ marginLeft: 'auto' }}>
          <X size={14} />
        </button>
      </div>
      <p className="ins-details-text">{s.body}</p>
      <div className="ins-tour-foot">
        <span className="ins-meta">{step + 1} / {STEPS.length}</span>
        {step > 0 && <button className="ins-btn ins-btn--quiet" onClick={() => go(step - 1)}>Back</button>}
        <button className="ins-btn ins-btn--primary" onClick={() => go(step + 1)} autoFocus>
          {step === STEPS.length - 1 ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
};
