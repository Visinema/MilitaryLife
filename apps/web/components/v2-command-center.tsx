'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import { api, ApiError, type CommandAction } from '@/lib/api-client';
import { buildWorldV2 } from '@/lib/world-v2';
import { useGameStore } from '@/store/game-store';
import { AvatarFrame } from './avatar-frame';
import { PersonalStatsPanel } from './personal-stats-panel';

interface V2CommandCenterProps {
  snapshot: GameSnapshot;
}

type CommandPanelTab = 'status' | 'command' | 'location';

export function V2CommandCenter({ snapshot }: V2CommandCenterProps) {
  const [mobileTab, setMobileTab] = useState<'overview' | 'mission'>('overview');
  const [panelTab, setPanelTab] = useState<CommandPanelTab>('status');
  const [commandBusy, setCommandBusy] = useState<CommandAction | null>(null);
  const [showHierarchy, setShowHierarchy] = useState(false);
  const [commandNote, setCommandNote] = useState('');
  const [targetNpcId, setTargetNpcId] = useState<string>('');
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setError = useGameStore((state) => state.setError);
  const world = useMemo(() => buildWorldV2(snapshot), [snapshot]);
  const normalizedRank = snapshot.rankCode.toLowerCase();
  const commandUnlocked =
    (snapshot.rankIndex ?? 0) >= 8 ||
    normalizedRank.includes('captain') ||
    normalizedRank.includes('kapten') ||
    normalizedRank.includes('major') ||
    normalizedRank.includes('colonel') ||
    normalizedRank.includes('kolonel') ||
    normalizedRank.includes('general') ||
    normalizedRank.includes('jendral');

  const runCommandAction = async (action: CommandAction) => {
    if (!commandUnlocked) return;
    setCommandBusy(action);
    try {
      const result = await api.command(action, targetNpcId || undefined, commandNote || undefined);
      setSnapshot(result.snapshot);
      setError(null);
      if (action === 'PLAN_MISSION') setCommandNote('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Command action failed');
      }
    } finally {
      setCommandBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
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

      <section className="cyber-panel p-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted">UI V3 · Compact Theater</p>
        <div className="mt-1.5 grid gap-1.5 xl:grid-cols-[1.3fr,1fr]">
          <div className={`${mobileTab !== 'overview' ? 'hidden md:block' : ''}`}>
            <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">Main Avatar Frame · Service Profile</p>
            <AvatarFrame
              name={snapshot.playerName}
              subtitle={`${world.player.rankLabel} · ${snapshot.playerPosition}`}
              uniformTone={world.player.uniformTone}
              ribbons={world.player.ribbons}
              medals={world.player.medals}
              shoulderRankCount={Math.min(4, Math.max(2, snapshot.rankCode.length % 5))}
              details={[
                `Authority: ${Math.round(world.player.commandAuthority)}%`,
                `Position: ${snapshot.playerPosition}`,
                `Influence record buff: +${world.player.influenceRecord}`,
                `Mission assignment: every ${world.missionBrief.mandatoryAssignmentEveryDays} days`,
                `NPC Active/KIA: ${world.stats.active}/${world.stats.kia}`
              ]}
            />
          </div>

          <div className={`${mobileTab !== 'mission' ? 'hidden md:block' : ''} rounded-md border border-border/70 bg-bg/70 p-2`}>
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Indikator status negara dan militer</p>

            <div className="mt-2 grid grid-cols-3 gap-1">
              {([
                ['status', 'Status'],
                ['command', 'Perintah'],
                ['location', 'Pindah Lokasi']
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPanelTab(key)}
                  className={`rounded border px-2 py-1 text-[11px] ${panelTab === key ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {panelTab === 'status' ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-border/60 bg-bg/60 px-1.5 py-1 text-muted">Stabilitas Negara: <span className="text-text">{snapshot.nationalStability}%</span></div>
                  <div className="rounded border border-border/60 bg-bg/60 px-1.5 py-1 text-muted">Stabilitas Militer: <span className="text-text">{snapshot.militaryStability}%</span></div>
                  <div className="rounded border border-border/60 bg-bg/60 px-1.5 py-1 text-muted">Kas Militer: <span className="text-text">${Math.round(snapshot.militaryFundCents / 100).toLocaleString()}</span></div>
                  <div className="rounded border border-border/60 bg-bg/60 px-1.5 py-1 text-muted">Sekretaris: <span className="text-text">{snapshot.fundSecretaryNpc ?? 'Belum ditunjuk'}</span></div>
                  <div className="rounded border border-border/60 bg-bg/60 px-1.5 py-1 text-muted">Kursi kosong: <span className="text-text">{snapshot.secretaryVacancyDays} hari</span></div>
                  <div className="rounded border border-border/60 bg-bg/60 px-1.5 py-1 text-muted">Risiko eskalasi: <span className="text-text">{snapshot.secretaryEscalationRisk}</span></div>
                </div>

                <div className="mt-2 grid gap-1 sm:grid-cols-[1.2fr,1fr]">
                  <div className="rounded border border-border px-2 py-1.5 text-[11px] text-text">
                    Active: {world.stats.active} · Injured: {world.stats.injured} · Reserve: {world.stats.reserve}
                  </div>
                  <PersonalStatsPanel
                    title="Active Player"
                    seed={snapshot.gameDay + snapshot.age}
                    baseMorale={snapshot.morale}
                    baseHealth={snapshot.health}
                    baseReadiness={Math.round(world.player.commandAuthority)}
                  />
                </div>

                <div className="mt-2 rounded border border-border/70 bg-bg/60 p-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.1em] text-muted">Command Hierarchy</p>
                    <button
                      onClick={() => setShowHierarchy((v) => !v)}
                      className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text hover:border-accent"
                    >
                      {showHierarchy ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showHierarchy ? (
                    <div className="mt-1 grid gap-1">
                      {world.hierarchy.slice(0, 6).map((npc) => (
                        <div key={npc.id} className="grid grid-cols-[1.2fr,0.8fr,0.8fr] gap-1 rounded border border-border/60 px-1.5 py-1 text-[11px]">
                          <p className="truncate text-text">{npc.name}</p>
                          <p className="truncate text-muted">{npc.rank}</p>
                          <p className="truncate text-muted">{npc.role} · {npc.unit}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted">Hierarchy disembunyikan untuk menjaga dashboard tetap ringkas.</p>
                  )}
                </div>
              </>
            ) : null}

            {panelTab === 'command' ? (
              <div className="mt-2 rounded border border-border/70 bg-bg/60 p-2">
                <p className="text-xs uppercase tracking-[0.1em] text-muted">Commands</p>
                {commandUnlocked ? (
                  <>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <select
                        className="rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text"
                        value={targetNpcId}
                        onChange={(event) => setTargetNpcId(event.target.value)}
                      >
                        <option value="">Target NPC (optional)</option>
                        {world.hierarchy.slice(0, 8).map((npc) => (
                          <option key={npc.id} value={npc.id}>
                            {npc.name} · {npc.role}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text"
                        value={commandNote}
                        onChange={(event) => setCommandNote(event.target.value)}
                        placeholder="Command note / mission objective"
                        maxLength={240}
                      />
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      <button onClick={() => void runCommandAction('PLAN_MISSION')} disabled={Boolean(commandBusy)} className="rounded border border-accent bg-accent/20 px-1.5 py-1 text-[11px] text-text disabled:opacity-60">{commandBusy === 'PLAN_MISSION' ? 'Planning...' : 'Plan Mission'}</button>
                      <button onClick={() => void runCommandAction('ISSUE_PROMOTION')} disabled={Boolean(commandBusy)} className="rounded border border-border bg-panel px-1.5 py-1 text-[11px] text-text disabled:opacity-60">{commandBusy === 'ISSUE_PROMOTION' ? 'Issuing...' : 'Promote NPC'}</button>
                      <button onClick={() => void runCommandAction('ISSUE_SANCTION')} disabled={Boolean(commandBusy)} className="rounded border border-danger/60 bg-danger/10 px-1.5 py-1 text-[11px] text-danger disabled:opacity-60">{commandBusy === 'ISSUE_SANCTION' ? 'Issuing...' : 'Sanction NPC'}</button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted">Captain++ command unlocked: plan mission, command subordinates, issue sanction/promotion.</p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-muted">Locked. Current rank: {snapshot.rankCode}. Reach Captain/Kapten or higher to unlock Commands.</p>
                )}
              </div>
            ) : null}

            {panelTab === 'location' ? (
              <div className="mt-2 rounded border border-accent/40 bg-accent/10 p-2">
                <p className="text-xs uppercase tracking-[0.1em] text-muted">Kategori & Tabs (Pindah Lokasi)</p>
                <p className="mt-1 text-[10px] text-muted">Divisi terdaftar: {REGISTERED_DIVISIONS.map((item) => item.name).join(' · ')}</p>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  <Link href="/dashboard/people" className="rounded border border-accent bg-accent/20 px-2 py-1 text-center text-[11px] font-medium text-text shadow-neon">People</Link>
                  <Link href="/dashboard/hierarchy" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Hierarchy</Link>
                  <Link href="/dashboard/event-frame" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Event Frame</Link>
                  <Link href="/dashboard/decision-log" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Decision Log</Link>
                  <Link href="/dashboard/ceremony" className="rounded border border-accent bg-accent/20 px-2 py-1 text-center text-[11px] text-text shadow-neon">Upacara Medal</Link>
                  <Link href="/dashboard/recruitment" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Rekrutmen</Link>
                  <Link href="/dashboard/raider-attack" className="rounded border border-danger/60 bg-danger/10 px-2 py-1 text-center text-[11px] text-danger">Raider Alert</Link>
                  <Link href="/dashboard/news" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">News</Link>
                  <Link href="/dashboard/medals" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Medals V3</Link>
                  <Link href="/dashboard/division-ops" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Division Ops</Link>
                  <Link href="/dashboard/military-court" className="rounded border border-danger/60 bg-danger/10 px-2 py-1 text-center text-[11px] text-danger">Pending Sidang</Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
