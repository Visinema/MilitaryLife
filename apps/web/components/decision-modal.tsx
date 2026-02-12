'use client';

import { useState } from 'react';
import type { PendingDecision } from '@mls/shared/game-types';

interface DecisionModalProps {
  decision: PendingDecision;
  onChoose: (optionId: string) => Promise<void>;
}

export function DecisionModal({ decision, onChoose }: DecisionModalProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChoose = async (optionId: string) => {
    setLoadingId(optionId);
    setError(null);

    try {
      await onChoose(optionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply decision');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-md border border-border bg-panel p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Decision Required</p>
        <h2 className="mt-2 text-xl font-semibold text-text">{decision.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{decision.description}</p>

        <div className="mt-5 space-y-2">
          {decision.options.map((option) => (
            <button
              key={option.id}
              onClick={() => handleChoose(option.id)}
              disabled={Boolean(loadingId)}
              className="w-full rounded border border-border bg-bg px-4 py-3 text-left text-sm text-text transition hover:border-accent disabled:opacity-60"
            >
              {loadingId === option.id ? 'Applying...' : option.label}
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
