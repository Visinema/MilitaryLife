'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameSnapshot, NpcRuntimeState, NpcRuntimeStatus } from '@mls/shared/game-types';
import { universalRankLabelFromIndex } from '@mls/shared/ranks';
import { api } from '@/lib/api-client';
import { resolvePlayerAssignment } from '@/lib/player-assignment';
import { useGameStore } from '@/store/game-store';

function statusTone(status: NpcRuntimeStatus) {
  if (status === 'ACTIVE') return 'text-ok border-ok/40 bg-ok/10';
  if (status === 'INJURED') return 'text-yellow-300 border-yellow-700/50 bg-yellow-700/10';
  if (status === 'RESERVE') return 'text-sky-300 border-sky-700/50 bg-sky-800/10';
  if (status === 'RECRUITING') return 'text-indigo-300 border-indigo-700/50 bg-indigo-800/10';
  return 'text-danger border-danger/40 bg-danger/10';
}

export default function PeoplePage() {
  const storeSnapshot = useGameStore((state) => state.snapshot);
  const setStoreSnapshot = useGameStore((state) => state.setSnapshot);

  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(storeSnapshot);
  const [npcs, setNpcs] = useState<NpcRuntimeState[]>([]);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.v5NpcDetail>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    const [snapshotRes, npcRes] = await Promise.all([
      api.snapshot(),
      api.v5Npcs({ limit: 120 })
    ]);
    setSnapshot(snapshotRes.snapshot);
    setStoreSnapshot(snapshotRes.snapshot);
    setNpcs(npcRes.items);
    setSelectedNpcId((current) => current ?? npcRes.items[0]?.npcId ?? null);
  }, [setStoreSnapshot]);

  useEffect(() => {
    loadRoster().catch((err: Error) => setError(err.message));
  }, [loadRoster]);

  useEffect(() => {
    if (!selectedNpcId) {
      setDetail(null);
      return;
    }
    api
      .v5NpcDetail(selectedNpcId)
      .then((res) => setDetail(res))
      .catch((err: Error) => setError(err.message));
  }, [selectedNpcId]);

  const selectedNpc = useMemo(
    () => npcs.find((item) => item.npcId === selectedNpcId) ?? null,
    [npcs, selectedNpcId]
  );
  const playerAssignment = useMemo(() => resolvePlayerAssignment(snapshot), [snapshot]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between cyber-panel p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">People and NPC Console</p>
          <h1 className="text-base font-semibold text-text">People Runtime V5</h1>
          <p className="text-[11px] text-muted">Semua data roster dan detail NPC berasal dari backend V5 runtime.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              loadRoster().catch((err: Error) => setError(err.message));
            }}
            className="rounded border border-border bg-bg px-3 py-2 text-xs text-text"
          >
            Refresh
          </button>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
            Back to Dashboard
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-muted">Loading people list...</p> : null}

      {snapshot ? (
        <div className="grid gap-3 lg:grid-cols-[320px,1fr]">
          <aside className="cyber-panel p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-muted">Roster V5</p>
            <div className="mt-2 rounded border border-accent/50 bg-accent/10 px-3 py-2">
              <p className="text-sm font-semibold text-text">{snapshot.playerName} (You)</p>
              <p className="text-xs text-muted">
                {universalRankLabelFromIndex(snapshot.rankIndex ?? 0)} | {snapshot.branch} | {playerAssignment.divisionLabel} | {playerAssignment.positionLabel}
              </p>
            </div>
            <div className="mt-2 max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
              {npcs.map((npc) => (
                <button
                  key={npc.npcId}
                  onClick={() => setSelectedNpcId(npc.npcId)}
                  className={`w-full rounded border px-3 py-2 text-left ${selectedNpc?.npcId === npc.npcId ? 'border-accent bg-accent/10' : 'border-border bg-bg/50'}`}
                >
                  <p className="text-sm font-semibold text-text">{npc.name}</p>
                  <p className="text-xs text-muted">
                    {universalRankLabelFromIndex(npc.rankIndex)} | {npc.division} | {npc.position}
                  </p>
                  <p className="text-xs text-muted">
                    {npc.careerStage} | academy T{npc.academyTier} | {npc.strategyMode}
                  </p>
                  <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[10px] uppercase ${statusTone(npc.status)}`}>{npc.status}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-3">
            {selectedNpc ? (
              <div className="cyber-panel p-3 text-xs space-y-2">
                <h2 className="text-sm font-semibold text-text">{selectedNpc.name}</h2>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Identity</p>
                    <p className="text-muted">Rank: <span className="text-text">{universalRankLabelFromIndex(selectedNpc.rankIndex)}</span> (index {selectedNpc.rankIndex})</p>
                    <p className="text-muted">Division: <span className="text-text">{selectedNpc.division}</span></p>
                    <p className="text-muted">Unit: <span className="text-text">{selectedNpc.unit}</span></p>
                    <p className="text-muted">Position: <span className="text-text">{selectedNpc.position}</span></p>
                    <p className="text-muted">Status: <span className="text-text">{selectedNpc.status}</span></p>
                  </div>

                  <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Career Planner</p>
                    <p className="text-muted">Strategy: <span className="text-text">{selectedNpc.strategyMode}</span></p>
                    <p className="text-muted">Stage: <span className="text-text">{selectedNpc.careerStage}</span></p>
                    <p className="text-muted">Academy tier: <span className="text-text">{selectedNpc.academyTier}</span></p>
                    <p className="text-muted">Desired division: <span className="text-text">{selectedNpc.desiredDivision ?? '-'}</span></p>
                    {detail?.academyProgress ? (
                      <>
                        <p className="text-muted">Target tier: <span className="text-text">{detail.academyProgress.targetTier}</span></p>
                        <p className="text-muted">Remaining tier: <span className="text-text">{detail.academyProgress.remainingTier}</span></p>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Stats</p>
                    <p className="text-muted">Leadership {selectedNpc.leadership} | Competence {selectedNpc.competence} | Intelligence {selectedNpc.intelligence}</p>
                    <p className="text-muted">Resilience {selectedNpc.resilience} | Tactical {selectedNpc.tactical} | Support {selectedNpc.support}</p>
                    <p className="text-muted">Loyalty {selectedNpc.loyalty} | Integrity risk {selectedNpc.integrityRisk} | Betrayal risk {selectedNpc.betrayalRisk}</p>
                    <p className="text-muted">XP {selectedNpc.xp} | Promotion points {selectedNpc.promotionPoints}</p>
                    <p className="text-muted">Last task: <span className="text-text">{selectedNpc.lastTask ?? '-'}</span></p>
                  </div>

                  <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Pipeline and Academy</p>
                    <p className="text-muted">Active application: <span className="text-text">{detail?.careerPlan?.activeApplication?.status ?? '-'}</span></p>
                    <p className="text-muted">Application id: <span className="text-text">{detail?.careerPlan?.activeApplication?.applicationId ?? '-'}</span></p>
                    <p className="text-muted">Next action day: <span className="text-text">{detail?.careerPlan?.nextActionDay ?? '-'}</span></p>
                    <p className="text-muted">Last action day: <span className="text-text">{detail?.careerPlan?.lastActionDay ?? '-'}</span></p>
                    <p className="text-muted">Certifications: <span className="text-text">{detail?.certifications.length ?? 0}</span></p>
                  </div>
                </div>

                <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Recent Lifecycle Events</p>
                  {(detail?.lifecycleEvents ?? []).length === 0 ? (
                    <p className="text-muted">No lifecycle events yet.</p>
                  ) : (
                    <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                      {(detail?.lifecycleEvents ?? []).slice(0, 20).map((item) => (
                        <p key={`${item.id}-${item.eventType}`} className="rounded border border-border/50 bg-bg/70 px-2 py-1 text-muted">
                          Day {item.day} | {item.eventType}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="cyber-panel p-3 text-xs text-muted">Pilih NPC dari roster untuk melihat detail.</div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
