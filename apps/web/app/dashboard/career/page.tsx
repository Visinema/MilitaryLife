'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PausedRouteGuard } from '@/components/paused-route-guard';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function CareerPage() {
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) return;
    void api.snapshot().then((response) => setSnapshot(response.snapshot));
  }, [setSnapshot, snapshot]);

  const runReview = async () => {
    setBusy(true);
    setMessage(null);
    setLetter(null);
    try {
      const response = await api.careerReview();
      setSnapshot(response.snapshot);
      const recommendation = String(response.details.promotionRecommendation ?? 'HOLD');
      const vacancy = Number(response.details.vacancyAvailabilityPercent ?? 0);
      setMessage(
        response.details.promoted
          ? `Promotion approved. Recommendation: ${recommendation}.`
          : `No promotion this review cycle. Recommendation: ${recommendation} · Vacancy ${vacancy}%`
      );
      setLetter((response.details.rejectionLetter as string | null) ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Career review failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PausedRouteGuard />
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-4 py-3 shadow-panel">
        <h1 className="text-lg font-semibold">Career</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
        <p className="text-sm text-muted">Run promotion board evaluation based on rank tenure, performance points, morale, and health.</p>
        <button
          onClick={runReview}
          disabled={busy}
          className="mt-4 rounded border border-accent bg-accent/20 px-4 py-2 text-sm font-medium text-text disabled:opacity-60"
        >
          {busy ? 'Evaluating...' : 'Run Career Review'}
        </button>
        {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
        {letter ? <p className="mt-2 rounded border border-border bg-bg/60 p-3 text-xs text-muted">{letter}</p> : null}
      </div>
    </div>
  );
}
