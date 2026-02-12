'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PausedRouteGuard } from '@/components/paused-route-guard';
import { api } from '@/lib/api-client';

interface DecisionLogItem {
  id: number;
  event_id: number;
  game_day: number;
  selected_option: string;
  consequences: Record<string, unknown>;
  created_at: string;
}

export default function DecisionLogPage() {
  const [items, setItems] = useState<DecisionLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (cursor?: number) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.decisionLogs(cursor, 20);
      setItems((prev) => (cursor ? [...prev, ...(response.items as DecisionLogItem[])] : (response.items as DecisionLogItem[])));
      setNextCursor(response.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decision log');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <PausedRouteGuard />
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-4 py-3 shadow-panel">
        <h1 className="text-lg font-semibold">Decision Log</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-md border border-border bg-panel p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Game Day {item.game_day}</p>
            <p className="mt-1 text-sm text-text">Event #{item.event_id} - Option {item.selected_option}</p>
            <pre className="mt-3 overflow-auto rounded border border-border bg-bg p-2 text-xs text-muted">
              {JSON.stringify(item.consequences, null, 2)}
            </pre>
          </article>
        ))}
      </div>

      <div className="flex items-center gap-3">
        {nextCursor ? (
          <button
            onClick={() => void load(nextCursor)}
            disabled={busy}
            className="rounded border border-border bg-panel px-4 py-2 text-sm text-text hover:border-accent disabled:opacity-60"
          >
            {busy ? 'Loading...' : 'Load More'}
          </button>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
