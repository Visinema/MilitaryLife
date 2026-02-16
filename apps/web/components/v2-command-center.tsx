'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ExpansionStateV51, GameSnapshot } from '@mls/shared/game-types';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import { api, ApiError, type CommandAction } from '@/lib/api-client';
import { resolvePlayerAssignment } from '@/lib/player-assignment';
import { buildWorldV2 } from '@/lib/world-v2';
import { useGameStore } from '@/store/game-store';
import { useDashboardUiStore } from '@/store/dashboard-ui-store';
import { AvatarFrame } from './avatar-frame';
import { PersonalStatsPanel } from './personal-stats-panel';

interface V2CommandCenterProps {
  snapshot: GameSnapshot;
  expansionState?: ExpansionStateV51 | null;
}

export function V2CommandCenter({ snapshot, expansionState }: V2CommandCenterProps) {
  const [mobileTab, setMobileTab] = useState<'overview' | 'mission'>('overview');
  const panelTab = useDashboardUiStore((state) => state.panelTab);
  const [commandBusy, setCommandBusy] = useState<CommandAction | null>(null);
  const [commandNote, setCommandNote] = useState('');
  const [targetNpcId, setTargetNpcId] = useState<string>('');
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setError = useGameStore((state) => state.setError);
  const world = useMemo(() => buildWorldV2(snapshot), [snapshot]);
  const assignment = useMemo(() => resolvePlayerAssignment(snapshot), [snapshot]);
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
      <div className="sticky top-1 z-20 grid grid-cols-2 gap-1.5 rounded-md border-2 border-border bg-panel p-1 shadow-panel md:hidden">
        {(['overview', 'mission'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`rounded border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${mobileTab === tab ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="cyber-panel border-2 border-border/90 p-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted">UI V4 · Reworked Layout</p>
        <div className="mt-1.5 grid gap-1.5 xl:grid-cols-[1.3fr,1fr]">
          <div className={`${mobileTab !== 'overview' ? 'hidden md:block' : ''}`}>
            <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">Main Avatar Frame · Service Profile</p>
            <AvatarFrame
              name={snapshot.playerName}
              subtitle={`${world.player.rankLabel} · ${assignment.positionLabel}`}
              uniformTone={world.player.uniformTone}
              ribbons={world.player.ribbons}
              medals={world.player.medals}
              shoulderRankCount={Math.min(4, Math.max(2, snapshot.rankCode.length % 5))}
              details={[
                `Authority: ${Math.round(world.player.commandAuthority)}%`,
                `Division: ${assignment.divisionLabel}`,
                `Satuan: ${assignment.unitLabel}`,
                `Position: ${assignment.positionLabel}`,
                `Influence record buff: +${world.player.influenceRecord}`,
                `Mission assignment: every ${world.missionBrief.mandatoryAssignmentEveryDays} days`,
                `NPC Active/KIA: ${world.stats.active}/${world.stats.kia}`
              ]}
            />
          </div>

          <div className={`${mobileTab !== 'mission' ? 'hidden md:block' : ''} rounded-md border-2 border-border/85 bg-bg/70 p-2.5`}>
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Indikator status negara dan militer</p>

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

                <div className="mt-2 grid gap-1.5 xl:grid-cols-3">
                  <div className="rounded border border-border/70 bg-bg/60 p-2">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Division Quota Board</p>
                    {expansionState?.quotaBoard?.length ? (
                      <div className="mt-1 space-y-1 text-[10px] text-muted">
                        {expansionState.quotaBoard.slice(0, 3).map((item) => (
                          <p key={item.division} className="rounded border border-border/50 px-1.5 py-1">
                            <span className="text-text">{item.division}</span> | {item.quotaRemaining}/{item.quotaTotal} | {item.status}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] text-muted">Quota board belum tersedia.</p>
                    )}
                  </div>

                  <div className="rounded border border-border/70 bg-bg/60 p-2">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Recruitment Race</p>
                    {expansionState?.recruitmentRace?.top10?.length ? (
                      <div className="mt-1 space-y-1 text-[10px] text-muted">
                        {expansionState.recruitmentRace.top10.slice(0, 3).map((entry) => (
                          <p key={`${entry.holderType}-${entry.npcId ?? entry.name}`} className="rounded border border-border/50 px-1.5 py-1">
                            <span className="text-text">#{entry.rank} {entry.name}</span> | score {entry.compositeScore}
                          </p>
                        ))}
                        {typeof expansionState.recruitmentRace.playerRank === 'number' ? (
                          <p className="rounded border border-accent/60 bg-accent/10 px-1.5 py-1 text-text">Posisi pemain: #{expansionState.recruitmentRace.playerRank}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] text-muted">Belum ada race data.</p>
                    )}
                  </div>

                  <div className="rounded border border-border/70 bg-bg/60 p-2">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Academy Batch Status</p>
                    {expansionState?.academyBatch ? (
                      <div className="mt-1 space-y-1 text-[10px] text-muted">
                        <p>Track: <span className="text-text">{expansionState.academyBatch.track}</span> | Tier {expansionState.academyBatch.tier}</p>
                        <p>Progress: <span className="text-text">{expansionState.academyBatch.playerDayProgress}/{expansionState.academyBatch.totalDays}</span></p>
                        <p>Status: <span className="text-text">{expansionState.academyBatch.status}</span></p>
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] text-muted">Tidak ada batch academy aktif.</p>
                    )}
                  </div>
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
                    <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
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
              <div className="mt-2 rounded border border-accent/40 bg-accent/10 p-2.5">
                <p className="text-xs uppercase tracking-[0.1em] text-muted">Navigasi Cepat Dashboard</p>
                <p className="mt-1 text-[10px] text-muted">Divisi terdaftar: {REGISTERED_DIVISIONS.map((item) => item.name).join(' · ')}</p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.1em] text-muted">Operasi Inti</p>
                <div className="mt-1 grid grid-cols-2 gap-1.5 md:grid-cols-3">
                  <Link href="/dashboard/people" className="rounded border border-accent bg-accent/20 px-2 py-1 text-center text-[11px] font-medium text-text shadow-neon">People</Link>
                  <Link href="/dashboard/hierarchy" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Hierarchy</Link>
                  <Link href="/dashboard/social-profile" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Social Profile</Link>
                  <Link href="/dashboard/event-frame" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Event Frame</Link>
                  <Link href="/dashboard/decision-log" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Decision Log</Link>
                  <Link href="/dashboard/mailbox" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Mailbox</Link>
                  <Link href="/dashboard/ceremony" className="rounded border border-accent bg-accent/20 px-2 py-1 text-center text-[11px] text-text shadow-neon">Upacara Medal</Link>
                  <Link href="/dashboard/recruitment" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Rekrutmen</Link>
                </div>
                <p className="mt-2 text-[10px] uppercase tracking-[0.1em] text-muted">Operasi Lanjutan</p>
                <div className="mt-1 grid grid-cols-2 gap-1.5 md:grid-cols-3">
                  <Link href="/dashboard/raider-attack" className="rounded border border-danger/60 bg-danger/10 px-2 py-1 text-center text-[11px] text-danger">Raider Alert</Link>
                  <Link href="/dashboard/news" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">News</Link>
                  <Link href="/dashboard/medals" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Medals</Link>
                  <Link href="/dashboard/division-ops" className="rounded border border-border bg-panel px-2 py-1 text-center text-[11px] text-text hover:border-accent">Division Ops</Link>
                  <Link href="/dashboard/military-court" className="rounded border border-danger/60 bg-danger/10 px-2 py-1 text-center text-[11px] text-danger">Pending Sidang</Link>
                  <Link href="/dashboard/military-law" className="rounded border border-accent bg-accent/20 px-2 py-1 text-center text-[11px] text-text shadow-neon">Military Law</Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
