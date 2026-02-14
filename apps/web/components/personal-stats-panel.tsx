'use client';

import { useMemo } from 'react';

interface PersonalStatsPanelProps {
  title: string;
  seed: number;
  baseMorale: number;
  baseHealth: number;
  baseReadiness: number;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function PersonalStatsPanel({ title, seed, baseMorale, baseHealth, baseReadiness }: PersonalStatsPanelProps) {
  const stats = useMemo(() => {
    const rhythm = (seed % 9) - 4;
    return {
      morale: clamp(baseMorale + rhythm),
      health: clamp(baseHealth - Math.floor(rhythm / 2)),
      readiness: clamp(baseReadiness + Math.floor(rhythm / 2)),
      stress: clamp(100 - baseMorale + Math.abs(rhythm * 2))
    };
  }, [baseHealth, baseMorale, baseReadiness, seed]);

  return (
    <div className="rounded border border-border bg-bg/60 p-3">
      <p className="text-xs uppercase tracking-[0.1em] text-muted">Personal Stats · {title}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <p className="rounded border border-border px-2 py-1 text-text">Morale: {stats.morale}</p>
        <p className="rounded border border-border px-2 py-1 text-text">Health: {stats.health}</p>
        <p className="rounded border border-border px-2 py-1 text-text">Readiness: {stats.readiness}</p>
        <p className="rounded border border-border px-2 py-1 text-text">Stress: {stats.stress}</p>
      </div>
    </div>
  );
}
