'use client';

import { useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { buildWorldV2, type NpcStatus } from '@/lib/world-v2';

interface V2CommandCenterProps {
  snapshot: GameSnapshot;
}

function statusTone(status: NpcStatus) {
  if (status === 'ACTIVE') return 'text-ok border-ok/40 bg-ok/10';
  if (status === 'INJURED') return 'text-yellow-300 border-yellow-700/50 bg-yellow-700/10';
  if (status === 'RESERVE') return 'text-sky-300 border-sky-700/50 bg-sky-800/10';
  return 'text-danger border-danger/40 bg-danger/10';
}

export function V2CommandCenter({ snapshot }: V2CommandCenterProps) {
  const [mobileTab, setMobileTab] = useState<'overview' | 'npc' | 'mission'>('overview');
  const world = useMemo(() => buildWorldV2(snapshot), [snapshot]);


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 md:hidden">
        {(['overview', 'npc', 'mission'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`rounded border px-2 py-2 text-xs uppercase tracking-[0.08em] ${mobileTab === tab ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {(mobileTab === 'overview' || mobileTab === 'npc' || mobileTab === 'mission') && (
        <section className="cyber-panel p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">UI V2 · Cybernetic Theater</p>
          <div className="mt-3 grid gap-4 md:grid-cols-[1.15fr,1fr]">
            <div className={`rounded-md border border-border/70 bg-bg/70 p-4 ${mobileTab !== 'overview' ? 'hidden md:block' : ''}`}>
              <p className="text-xs uppercase tracking-[0.12em] text-muted">Player Avatar · Cyber Uniform Link</p>
              <div className="mt-4 flex items-end gap-4">
                <div className="relative h-36 w-24 overflow-hidden rounded-t-[2.5rem] border border-border bg-[#2f3b36]">
                  <div className="mx-auto mt-2 h-10 w-10 rounded-full bg-[#c49377]" />
                  <div className="mx-auto mt-2 h-16 w-16 rounded-md" style={{ background: world.player.uniformTone }} />
                  <div className="absolute right-1 top-[5.2rem] grid gap-1">
                    {world.player.ribbons.slice(0, 4).map((r) => (
                      <div key={r} className="h-2 w-5 rounded-sm border border-border bg-accent/80" title={r} />
                    ))}
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-text">{world.player.branchLabel} · {snapshot.rankCode}</p>
                  <p className="text-muted">Track: {world.player.rankTrack}</p>
                  <p className="text-muted">Authority: {Math.round(world.player.commandAuthority)}%</p>
                  <p className="text-muted">Recruitment: {world.missionBrief.recruitmentWindow}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {world.player.medals.map((m) => (
                  <div key={m} className="rounded border border-border px-3 py-2 text-xs text-text">
                    {m}
                  </div>
                ))}
              </div>
            </div>

            <div className={`rounded-md border border-border/70 bg-bg/70 p-4 ${mobileTab !== 'mission' ? 'hidden md:block' : ''}`}>
              <p className="text-xs uppercase tracking-[0.12em] text-muted">Mission Protocol & Command AI</p>
              <h3 className="mt-2 text-sm font-semibold text-text">{world.missionBrief.title}</h3>
              <p className="mt-1 text-xs text-muted">{world.missionBrief.objective}</p>
              <p className="mt-2 text-xs text-muted">{world.missionBrief.commandRule}</p>
              <p className="mt-2 text-xs text-muted">Sanctions: {world.missionBrief.sanctions}</p>
              <div className="mt-3 rounded border border-border px-3 py-2 text-xs text-text">
                Active NPC: {world.stats.active}/{world.roster.length} · Injured: {world.stats.injured} · Reserve: {world.stats.reserve}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className={`cyber-panel p-4 ${mobileTab !== 'npc' ? 'hidden md:block' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Dynamic NPC Lifecycle Grid</p>
          <p className="text-xs text-muted">spawn-replacement lifecycle · replacements this cycle: {world.stats.replacementsThisCycle}</p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {world.roster.map((npc) => (
            <article key={npc.id} className="rounded border border-border/80 bg-bg/60 p-3 shadow-neon">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text">{npc.name}</h3>
                <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${statusTone(npc.status)}`}>{npc.status}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{npc.rank} · {npc.role}</p>
              <p className="text-xs text-muted">{npc.division} / {npc.subdivision}</p>
              <p className="mt-1 text-xs text-text">Medals: {npc.medals.join(' · ')}</p>
              <p className="text-xs text-text">Ribbons: {npc.ribbons.join(' · ')}</p>
              <p className="text-[11px] text-muted">Joined day {npc.joinedOnDay} · last seen day {npc.lastSeenOnDay}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
