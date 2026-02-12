import type { GameSnapshot } from '@mls/shared/game-types';
import { formatMoney } from '@/lib/clock';

interface StatGridProps {
  snapshot: GameSnapshot;
}

export function StatGrid({ snapshot }: StatGridProps) {
  const items = [
    { label: 'Age', value: String(snapshot.age) },
    { label: 'Rank', value: snapshot.rankCode },
    { label: 'Branch', value: snapshot.branch.replace('ID_', '').replace('_', ' ') },
    { label: 'Money', value: formatMoney(snapshot.moneyCents) },
    { label: 'Morale', value: `${snapshot.morale}%` },
    { label: 'Health', value: `${snapshot.health}%` }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border bg-panel p-3 shadow-panel">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">{item.label}</p>
          <p className="mt-2 text-base font-semibold text-text">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
