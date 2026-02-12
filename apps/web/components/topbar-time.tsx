'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { deriveLiveGameDay, inGameDateFromDay } from '@/lib/clock';

interface TopbarTimeProps {
  snapshot: GameSnapshot;
  clockOffsetMs: number;
}

export function TopbarTime({ snapshot, clockOffsetMs }: TopbarTimeProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const day = useMemo(() => deriveLiveGameDay(snapshot, clockOffsetMs), [snapshot, clockOffsetMs, tick]);
  const date = useMemo(() => inGameDateFromDay(day), [day]);

  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-panel px-4 py-3 shadow-panel">
      <div>
        <p className="text-xs uppercase tracking-[0.12em] text-muted">In-Game Date</p>
        <p className="text-lg font-semibold text-text">{date}</p>
      </div>
      <div className="text-right">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Game Day</p>
        <p className="text-lg font-semibold text-text">Day {day}</p>
      </div>
      <div className="rounded border border-border px-3 py-1 text-xs uppercase tracking-[0.12em] text-muted">
        {snapshot.paused ? 'Paused' : 'Running'}
      </div>
    </div>
  );
}
