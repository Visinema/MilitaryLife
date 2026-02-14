'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function EventFramePage() {
  const router = useRouter();
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) return;
    void api.snapshot().then((res) => setSnapshot(res.snapshot));
  }, [setSnapshot, snapshot]);

  const pending = snapshot?.pendingDecision ?? null;

  const header = useMemo(() => {
    if (!pending) return 'Tidak ada event aktif.';
    return `${pending.title} · Chance ${pending.chancePercent}%`;
  }, [pending]);

  const choose = async (optionId: string) => {
    if (!pending) return;
    setBusy(optionId);
    setError(null);
    try {
      const response = await api.chooseDecision(pending.eventId, optionId);
      setSnapshot(response.snapshot);
      setResultText(
        `Hasil: uang ${response.result.applied.moneyDelta}, morale ${response.result.applied.moraleDelta}, health ${response.result.applied.healthDelta}, promotion ${response.result.applied.promotionPointDelta}.`
      );
      window.setTimeout(() => {
        router.replace('/dashboard');
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses event');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-4 py-3 shadow-panel">
        <h1 className="text-base font-semibold text-text">Event / Chance Frame</h1>
        <Link href="/dashboard" className="text-xs text-muted underline">Kembali</Link>
      </div>

      <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Frame Status</p>
        <p className="mt-1 text-sm text-text">{header}</p>

        {pending ? (
          <>
            <p className="mt-2 text-sm text-muted">Condition: {pending.conditionLabel}</p>
            <div className="mt-4 space-y-2">
              {pending.options.map((option) => (
                <button
                  key={option.id}
                  disabled={Boolean(busy)}
                  onClick={() => choose(option.id)}
                  className="w-full rounded border border-border bg-bg px-4 py-3 text-left text-sm text-text hover:border-accent disabled:opacity-60"
                >
                  <p>{busy === option.id ? 'Memproses...' : option.label}</p>
                  <p className="mt-1 text-xs text-muted">Impact: {option.impactScope} · {option.effectPreview}</p>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {resultText ? <p className="mt-4 text-sm text-ok">{resultText} Mengembalikan ke dashboard...</p> : null}
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
