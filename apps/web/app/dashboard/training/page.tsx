'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PausedRouteGuard } from '@/components/paused-route-guard';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function TrainingPage() {
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) return;
    void api.snapshot().then((response) => setSnapshot(response.snapshot));
  }, [setSnapshot, snapshot]);

  const runTraining = async (intensity: 'LOW' | 'MEDIUM' | 'HIGH') => {
    setBusy(intensity);
    setMessage(null);
    try {
      const response = await api.training(intensity);
      setSnapshot(response.snapshot);
      const injured = response.details.injury ? 'Injury reported.' : 'Training completed.';
      setMessage(`${intensity} intensity complete. ${injured}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Training failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <PausedRouteGuard />
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-4 py-3 shadow-panel">
        <h1 className="text-lg font-semibold">Training</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
        <p className="text-sm text-muted">Choose intensity based on budget, risk, and promotion point goals.</p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {(['LOW', 'MEDIUM', 'HIGH'] as const).map((intensity) => (
            <button
              key={intensity}
              onClick={() => runTraining(intensity)}
              disabled={Boolean(busy)}
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-text hover:border-accent disabled:opacity-60"
            >
              {busy === intensity ? 'Running...' : `${intensity} Training`}
            </button>
          ))}
        </div>

        {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
      </div>
    </div>
  );
}
