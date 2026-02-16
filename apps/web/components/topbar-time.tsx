'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { deriveLiveGameDay, inGameDateFromDay } from '@/lib/clock';

interface TopbarTimeProps {
  snapshot: GameSnapshot;
  clockOffsetMs: number;
  onManualPause: () => void;
  onManualContinue: () => void;
  controlBusy?: 'pause' | 'continue' | null;
  onToggleTimeScale: () => void;
  timeScaleBusy?: boolean;
}

export function TopbarTime({ snapshot, clockOffsetMs, onManualPause, onManualContinue, controlBusy, onToggleTimeScale, timeScaleBusy }: TopbarTimeProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const day = useMemo(() => deriveLiveGameDay(snapshot, clockOffsetMs), [snapshot, clockOffsetMs, tick]);
  const date = useMemo(() => inGameDateFromDay(day), [day]);

  return (
    <div className="grid grid-cols-[1fr,1fr,auto] items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 shadow-panel">
      <div>
        <p className="text-xs uppercase tracking-[0.12em] text-muted">In-Game Date</p>
        <p className="text-base font-semibold text-text">{date}</p>
      </div>
      <div className="text-right">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Game Day</p>
        <p className="text-base font-semibold text-text">Day {day}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="rounded border border-border px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-muted">
          {snapshot.paused ? 'Paused' : 'Running'}
        </div>

        <button
          onClick={onToggleTimeScale}
          disabled={Boolean(timeScaleBusy)}
          className={`rounded border px-2 py-1 text-[10px] ${snapshot.gameTimeScale === 3 ? 'border-accent bg-accent/20 text-text' : 'border-border text-muted'} disabled:opacity-50`}
          title="Percepat waktu dunia x3"
        >
          {timeScaleBusy ? '...' : `x${snapshot.gameTimeScale}`}
        </button>

        <button
          onClick={onManualPause}
          disabled={snapshot.paused || controlBusy === 'pause'}
          className="rounded border border-border px-2 py-1 text-[10px] text-text disabled:opacity-50"
          title="Manual pause untuk recovery saat bug"
        >
          {controlBusy === 'pause' ? '...' : 'Pause'}
        </button>
        <button
          onClick={onManualContinue}
          disabled={!snapshot.paused || controlBusy === 'continue'}
          className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-[10px] text-text disabled:opacity-50"
          title="Manual continue untuk recovery saat stuck"
        >
          {controlBusy === 'continue' ? '...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
