import { useMemo } from 'react';

interface PersonalStatsPanelProps {
  title: string;
  seed: number;
  baseMorale: number;
  baseHealth: number;
  baseReadiness: number;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function PersonalStatsPanel({ title, seed, baseMorale, baseHealth, baseReadiness }: PersonalStatsPanelProps) {
  const stats = useMemo(() => {
    const rhythm = ((seed % 11) - 5) * 2;
    return {
      morale: clamp(baseMorale + rhythm),
      health: clamp(baseHealth - Math.floor(rhythm / 2)),
      readiness: clamp(baseReadiness + Math.floor(rhythm / 2)),
      stress: clamp(100 - baseMorale + Math.abs(rhythm * 2))
    };
  }, [baseHealth, baseMorale, baseReadiness, seed]);

  return (
    <div className="rounded border border-border/70 bg-bg/60 p-1.5">
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Stats · {title}</p>
      <div className="mt-1 grid grid-cols-4 gap-1 text-[11px] leading-none">
        <p className="rounded border border-border px-1.5 py-1 text-text">M {stats.morale}</p>
        <p className="rounded border border-border px-1.5 py-1 text-text">H {stats.health}</p>
        <p className="rounded border border-border px-1.5 py-1 text-text">R {stats.readiness}</p>
        <p className="rounded border border-border px-1.5 py-1 text-text">S {stats.stress}</p>
      </div>
    </div>
  );
}
