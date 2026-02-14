'use client';

import type { PendingDecision } from '@mls/shared/game-types';

interface DecisionModalProps {
  decision: PendingDecision;
  onOpenFrame: () => void;
}

export function DecisionModal({ decision, onOpenFrame }: DecisionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-md border border-border bg-panel p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Event Triggered · Chance & Condition</p>
        <h2 className="mt-2 text-xl font-semibold text-text">{decision.title}</h2>
        <p className="mt-2 text-sm text-muted">{decision.description}</p>

        <div className="mt-4 grid gap-2 rounded border border-border bg-bg/60 p-3 text-xs text-muted md:grid-cols-2">
          <p>Chance: <span className="text-text">{decision.chancePercent}%</span></p>
          <p>Condition: <span className="text-text">{decision.conditionLabel}</span></p>
        </div>

        <div className="mt-4 rounded border border-accent/40 bg-accent/10 p-3">
          <p className="text-xs text-muted">Pilih tindakan pada frame opsi khusus. Dampak bisa ke diri sendiri atau seluruh organisasi militer.</p>
          <button
            onClick={onOpenFrame}
            className="mt-3 rounded border border-accent bg-accent/20 px-4 py-2 text-sm font-medium text-text"
          >
            Buka Frame Pilihan Event
          </button>
        </div>
      </div>
    </div>
  );
}
