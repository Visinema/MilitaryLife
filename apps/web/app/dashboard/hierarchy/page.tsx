'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { GameSnapshot } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';
import { buildWorldV2 } from '@/lib/world-v2';
import { useGameStore } from '@/store/game-store';

type SortMode = 'RANK_DESC' | 'AZ' | 'RANK_ASC' | 'DIVISION' | 'MOST_MEDAL';

type MemberView = {
  id: string;
  name: string;
  rank: string;
  role: string;
  division: string;
  subdivision: string;
  unit: string;
  medals: string[];
  ribbonNames: string[];
  commandPower: number;
  type: 'NPC' | 'PLAYER';
};

const RANK_ORDER = [
  'General',
  'Lieutenant General',
  'Major General',
  'Brigadier General',
  'Colonel',
  'Major',
  'Captain',
  'Lieutenant',
  'Warrant Officer',
  'Staff Sergeant',
  'Sergeant',
  'Corporal',
  'Private',
  'Recruit'
];

const RANK_SCORE = new Map(RANK_ORDER.map((rank, idx) => [rank.toLowerCase(), RANK_ORDER.length - idx]));

function rankScore(rank: string): number {
  return RANK_SCORE.get(rank.toLowerCase()) ?? 0;
}

function sortMembers(members: MemberView[], mode: SortMode): MemberView[] {
  const clone = [...members];
  if (mode === 'AZ') {
    return clone.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'RANK_ASC') {
    return clone.sort((a, b) => rankScore(a.rank) - rankScore(b.rank) || a.name.localeCompare(b.name));
  }
  if (mode === 'DIVISION') {
    return clone.sort((a, b) => a.division.localeCompare(b.division) || rankScore(b.rank) - rankScore(a.rank));
  }
  if (mode === 'MOST_MEDAL') {
    return clone.sort((a, b) => b.medals.length - a.medals.length || rankScore(b.rank) - rankScore(a.rank));
  }
  return clone.sort((a, b) => rankScore(b.rank) - rankScore(a.rank) || a.commandPower - b.commandPower);
}

export default function HierarchyPage() {
  const storeSnapshot = useGameStore((state) => state.snapshot);
  const setStoreSnapshot = useGameStore((state) => state.setSnapshot);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(storeSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('RANK_DESC');
  const [expandedFrames, setExpandedFrames] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (storeSnapshot) {
      setSnapshot(storeSnapshot);
      return;
    }

    api
      .snapshot()
      .then((res) => {
        setSnapshot(res.snapshot);
        setStoreSnapshot(res.snapshot);
      })
      .catch((err: Error) => setError(err.message));
  }, [setStoreSnapshot, storeSnapshot]);

  const world = useMemo(() => (snapshot ? buildWorldV2(snapshot) : null), [snapshot]);

  const allMembers = useMemo<MemberView[]>(() => {
    if (!snapshot || !world) return [];

    const player: MemberView = {
      id: 'player-command-slot',
      name: snapshot.playerName,
      rank: snapshot.rankCode,
      role: snapshot.playerPosition,
      division: snapshot.playerDivision,
      subdivision: 'HQ Command',
      unit: 'Player Strategic Unit',
      medals: snapshot.playerMedals ?? [],
      ribbonNames: snapshot.playerRibbons ?? [],
      commandPower: 101,
      type: 'PLAYER'
    };

    const npcs: MemberView[] = world.hierarchy.map((npc) => ({
      id: npc.id,
      name: npc.name,
      rank: npc.rank,
      role: npc.role,
      division: npc.division,
      subdivision: npc.subdivision,
      unit: npc.unit,
      medals: npc.medals,
      ribbonNames: npc.ribbons.map((item) => item.name),
      commandPower: npc.commandPower,
      type: 'NPC'
    }));

    return [player, ...npcs];
  }, [snapshot, world]);

  const sortedMembers = useMemo(() => sortMembers(allMembers, sortMode), [allMembers, sortMode]);

  const groupedFrames = useMemo(() => {
    const groups = new Map<string, MemberView[]>();
    for (const member of sortedMembers) {
      const key = member.division || 'Unassigned Division';
      const row = groups.get(key) ?? [];
      row.push(member);
      groups.set(key, row);
    }

    return Array.from(groups.entries())
      .map(([frame, members]) => ({ frame, members }))
      .sort((a, b) => a.frame.localeCompare(b.frame));
  }, [sortedMembers]);

  useEffect(() => {
    if (groupedFrames.length === 0) return;
    setExpandedFrames((prev) => {
      const next: Record<string, boolean> = {};
      for (const group of groupedFrames) {
        next[group.frame] = prev[group.frame] ?? false;
      }
      if (!Object.values(next).some(Boolean)) {
        next[groupedFrames[0].frame] = true;
      }
      return next;
    });
  }, [groupedFrames]);

  const toggleFrame = (frame: string) => {
    setExpandedFrames((prev) => ({ ...prev, [frame]: !prev[frame] }));
  };

  const refreshSnapshot = () => {
    api
      .snapshot()
      .then((res) => {
        setSnapshot(res.snapshot);
        setStoreSnapshot(res.snapshot);
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 cyber-panel p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Cyber Command Chain</p>
          <h1 className="text-lg font-semibold text-text">Hierarchy Realtime · Divisi/Korps/Satuan</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={refreshSnapshot} className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
            Refresh
          </button>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <section className="cyber-panel p-3 text-xs">
        <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Sort Hierarchy</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-5">
          {([
            ['RANK_DESC', 'Pangkat Tertinggi'],
            ['AZ', 'A-Z'],
            ['RANK_ASC', 'Pangkat Terendah'],
            ['DIVISION', 'Divisi/Korps'],
            ['MOST_MEDAL', 'Most Medal']
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`rounded border px-2 py-1 text-[11px] ${sortMode === mode ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-muted">Loading hierarchy...</p> : null}

      {world ? (
        <section className="cyber-panel p-3 text-xs space-y-2">
          <h2 className="text-sm font-semibold text-text">Frame Divisi/Korps/Satuan (Collapsible)</h2>
          <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
            {groupedFrames.map((group) => {
              const expanded = Boolean(expandedFrames[group.frame]);
              return (
                <div key={group.frame} className="rounded border border-border/60 bg-bg/60">
                  <button
                    type="button"
                    onClick={() => toggleFrame(group.frame)}
                    className="flex w-full items-center justify-between px-2 py-2 text-left"
                  >
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted">{group.frame}</span>
                    <span className="text-[10px] text-text">{expanded ? 'Collapse' : 'Expand'} · {group.members.length} personel</span>
                  </button>

                  {expanded ? (
                    <div className="space-y-1 border-t border-border/40 px-2 py-2">
                      {group.members.map((member) => (
                        <div key={member.id} className="grid gap-1 rounded border border-border/40 px-2 py-1 sm:grid-cols-[1.3fr,1fr,1fr,auto]">
                          <p className="truncate text-text">
                            {member.name} <span className="text-[10px] text-muted">({member.type})</span>
                          </p>
                          <p className="truncate text-muted">{member.rank} · {member.role}</p>
                          <p className="truncate text-muted">{member.subdivision} / {member.unit}</p>
                          <p className="text-muted">Medal {member.medals.length}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
