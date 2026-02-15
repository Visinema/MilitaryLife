'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { buildWorldV2 } from '@/lib/world-v2';
import { AvatarFrame } from './avatar-frame';
import { PersonalStatsPanel } from './personal-stats-panel';

interface V2CommandCenterProps {
  snapshot: GameSnapshot;
}

export function V2CommandCenter({ snapshot }: V2CommandCenterProps) {
  const [mobileTab, setMobileTab] = useState<'overview' | 'mission'>('overview');
  const world = useMemo(() => buildWorldV2(snapshot), [snapshot]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 md:hidden">
        {(['overview', 'mission'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`rounded border px-2 py-1.5 text-[11px] uppercase tracking-[0.08em] ${mobileTab === tab ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="cyber-panel p-2.5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">UI V2 · Cybernetic Theater</p>
        <p className="mt-1 text-[11px] text-muted">Conflict-safe layout: avatar frame and mission cards are isolated to reduce frequent merge collisions.</p>
        <div className="mt-2 grid gap-2.5 xl:grid-cols-[1.25fr,1fr]">
          <div className={`${mobileTab !== 'overview' ? 'hidden md:block' : ''}`}>
            <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">Main Avatar Frame · Service Profile</p>
            <AvatarFrame
              name={`${world.player.branchLabel} · ${snapshot.rankCode}`}
              subtitle={`Track: ${world.player.rankTrack} · Universal: ${world.player.universalRank}`}
              uniformTone={world.player.uniformTone}
              ribbons={world.player.ribbons}
              medals={world.player.medals}
              shoulderRankCount={Math.min(4, Math.max(2, snapshot.rankCode.length % 5))}
              details={[
                `Authority: ${Math.round(world.player.commandAuthority)}%`,
                `Influence record buff: +${world.player.influenceRecord}`,
                `Mission assignment: every ${world.missionBrief.mandatoryAssignmentEveryDays} days`,
                `NPC Active/KIA: ${world.stats.active}/${world.stats.kia}`
              ]}
            />
            <div className="mt-1.5">
              <PersonalStatsPanel
                title="Active Player"
                seed={snapshot.gameDay + snapshot.age}
                baseMorale={snapshot.morale}
                baseHealth={snapshot.health}
                baseReadiness={Math.round(world.player.commandAuthority)}
              />
            </div>
          </div>

          <div className={`${mobileTab !== 'mission' ? 'hidden md:block' : ''} rounded-md border border-border/70 bg-bg/70 p-2.5`}>
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Mission Protocol & Command AI</p>
            <h3 className="mt-2 text-sm font-semibold text-text">{world.missionBrief.title}</h3>
            <p className="mt-1 text-xs text-muted">{world.missionBrief.objective}</p>
            <p className="mt-2 text-xs text-muted">{world.missionBrief.commandRule}</p>
            <p className="mt-2 text-xs text-muted">Sanctions: {world.missionBrief.sanctions}</p>
            <div className="mt-2 rounded border border-border px-2.5 py-1.5 text-[11px] text-text">
              Active: {world.stats.active} · Injured: {world.stats.injured} · Reserve: {world.stats.reserve}
            </div>

            <div className="mt-2 rounded border border-accent/40 bg-accent/10 p-2">
              <p className="text-xs uppercase tracking-[0.1em] text-muted">People & Interaction Hub</p>
              <p className="mt-1 text-xs text-muted">NPC list dipindah ke halaman terpisah dengan scroll-box dan profile frame real-time untuk menghemat layar utama.</p>
              <Link href="/dashboard/people" className="mt-2 inline-flex rounded border border-accent bg-accent/20 px-2.5 py-1.5 text-[11px] font-medium text-text shadow-neon">
                Open NPC / People Console
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
