'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { GameSnapshot } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';
import { buildWorldV2 } from '@/lib/world-v2';

export default function HierarchyPage() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .snapshot()
      .then((res) => setSnapshot(res.snapshot))
      .catch((err: Error) => setError(err.message));
  }, []);

  const world = useMemo(() => (snapshot ? buildWorldV2(snapshot) : null), [snapshot]);
  const hierarchy = world?.hierarchy ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between cyber-panel p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Cyber Command Chain</p>
          <h1 className="text-lg font-semibold text-text">Hierarchy, Current Office Holders & NPC Profiles</h1>
        </div>
        <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
          Back to Dashboard
        </Link>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-muted">Loading hierarchy...</p> : null}

      {world ? (
        <div className="grid grid-cols-2 gap-2 cyber-panel p-3 text-xs text-muted sm:grid-cols-5">
          <p>Active: <span className="text-text">{world.stats.active}</span></p>
          <p>Injured: <span className="text-text">{world.stats.injured}</span></p>
          <p>Reserve: <span className="text-text">{world.stats.reserve}</span></p>
          <p>KIA: <span className="text-text">{world.stats.kia}</span></p>
          <p>Replacements: <span className="text-text">{world.stats.replacementsThisCycle}</span></p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hierarchy.map((npc, idx) => (
          <article key={npc.id} className="cyber-panel p-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Tier {idx + 1} Command</p>
            <h2 className="text-sm font-semibold text-text">{npc.name}</h2>
            <p className="mt-1 text-xs text-muted">{npc.role}</p>
            <p className="text-xs text-muted">{npc.rank} · {npc.branch}</p>
            <p className="text-xs text-muted">{npc.division} / {npc.subdivision}</p>
            <p className="mt-2 text-xs text-text">Medals: {npc.medals.join(' · ')}</p>
            <p className="text-xs text-text">Ribbons: {npc.ribbons.join(' · ')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
