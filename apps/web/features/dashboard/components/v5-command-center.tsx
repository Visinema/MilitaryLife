'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ExpansionStateV51, GameSnapshot } from '@mls/shared/game-types';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import { api, ApiError, type CommandAction } from '@/lib/api-client';
import { resolvePlayerAssignment } from '@/lib/player-assignment';
import { buildWorldV5 } from '@/lib/world-v5';
import { useGameStore } from '@/store/game-store';
import { useDashboardUiStore } from '@/store/dashboard-ui-store';
import { AvatarFrame } from '@/components/avatar-frame';
import { DASHBOARD_LINKS } from '@/features/dashboard/components/action-buttons';
import { PersonalStatsPanel } from '@/components/personal-stats-panel';

interface V5CommandCenterProps {
  snapshot: GameSnapshot;
  expansionState?: ExpansionStateV51 | null;
}

export function V5CommandCenter({ snapshot, expansionState }: V5CommandCenterProps) {
  const [mobileTab, setMobileTab] = useState<'overview' | 'mission'>('overview');
  const panelTab = useDashboardUiStore((state) => state.panelTab);
  const [commandBusy, setCommandBusy] = useState<CommandAction | null>(null);
  const [commandNote, setCommandNote] = useState('');
  const [targetNpcId, setTargetNpcId] = useState<string>('');
  const [runtimeNpcs, setRuntimeNpcs] = useState<Array<{ npcId: string; name: string; position: string; status: string }>>([]);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setError = useGameStore((state) => state.setError);
  const world = useMemo(() => buildWorldV5(snapshot), [snapshot]);
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

  useEffect(() => {
    api
      .v5Npcs({ limit: 120 })
      .then((res) => {
        setRuntimeNpcs(
          res.items.map((item) => ({
            npcId: item.npcId,
            name: item.name,
            position: item.position,
            status: item.status
          }))
        );
      })
      .catch((error: unknown) => {
        setRuntimeNpcs([]);
        const reason = error instanceof Error ? error.message : 'Gagal memuat NPC runtime.';
        setError(reason);
      });
  }, [snapshot.gameDay]);

  const runtimeActiveCount = runtimeNpcs.filter((item) => item.status === 'ACTIVE').length;
  const runtimeKiaCount = runtimeNpcs.filter((item) => item.status === 'KIA').length;

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
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted">UI V5 · Unified Layout</p>
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
                `NPC Active/KIA: ${runtimeNpcs.length > 0 ? runtimeActiveCount : world.stats.active}/${runtimeNpcs.length > 0 ? runtimeKiaCount : world.stats.kia}`
              ]}
              showQuickLinks={false}
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
                        {(runtimeNpcs.length > 0
                          ? runtimeNpcs
                          : world.hierarchy.slice(0, 8).map((npc) => ({
                              npcId: npc.id,
                              name: npc.name,
                              position: npc.role,
                              status: npc.status
                            }))).slice(0, 12).map((npc) => (
                          <option key={npc.npcId} value={npc.npcId}>
                            {npc.name} | {npc.position}
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
                <p className="mt-2 text-[10px] text-muted">
                  Menu inti sudah dikonsolidasikan pada navbar utama untuk mencegah duplikasi tombol dan konflik alur.
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.1em] text-muted">Operasi Lanjutan (unik)</p>
                <div className="mt-1 grid grid-cols-2 gap-1.5 md:grid-cols-3">
                  {[
                    '/dashboard/ceremony',
                    '/dashboard/recruitment',
                    '/dashboard/raider-attack',
                    '/dashboard/news',
                    '/dashboard/medals',
                    '/dashboard/division-ops',
                    '/dashboard/military-court',
                    '/dashboard/military-law'
                  ].filter((href, idx, arr) => arr.indexOf(href) === idx && !DASHBOARD_LINKS.some((entry) => entry.href === href)).map((href) => {
                    const labelMap: Record<string, string> = {
                      '/dashboard/ceremony': 'Upacara Medal',
                      '/dashboard/recruitment': 'Rekrutmen',
                      '/dashboard/raider-attack': 'Raider Alert',
                      '/dashboard/news': 'News',
                      '/dashboard/medals': 'Medals',
                      '/dashboard/division-ops': 'Division Ops',
                      '/dashboard/military-court': 'Pending Sidang',
                      '/dashboard/military-law': 'Military Law'
                    };
                    const label = labelMap[href] ?? href;
                    const danger = href === '/dashboard/raider-attack' || href === '/dashboard/military-court';
                    const accent = href === '/dashboard/ceremony' || href === '/dashboard/military-law';
                    const tone = danger
                      ? 'border-danger/60 bg-danger/10 text-danger'
                      : accent
                        ? 'border-accent bg-accent/20 text-text shadow-neon'
                        : 'border-border bg-panel text-text hover:border-accent';
                    return (
                      <Link key={href} href={href} className={`rounded border px-2 py-1 text-center text-[11px] ${tone}`}>
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

