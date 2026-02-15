'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { AvatarFrame, npcUniformTone } from '@/components/avatar-frame';
import { PersonalStatsPanel } from '@/components/personal-stats-panel';
import { api } from '@/lib/api-client';
import { buildWorldV2, type NpcV2Profile, type NpcStatus } from '@/lib/world-v2';
import { useGameStore } from '@/store/game-store';

function statusTone(status: NpcStatus) {
  if (status === 'ACTIVE') return 'text-ok border-ok/40 bg-ok/10';
  if (status === 'INJURED') return 'text-yellow-300 border-yellow-700/50 bg-yellow-700/10';
  if (status === 'RESERVE') return 'text-sky-300 border-sky-700/50 bg-sky-800/10';
  return 'text-danger border-danger/40 bg-danger/10';
}

function initialLog(npc: NpcV2Profile) {
  return [`${npc.name}: Ready for orders, command.`, `${npc.name}: Unit morale check complete.`];
}

export default function PeoplePage() {
  const storeSnapshot = useGameStore((state) => state.snapshot);
  const setStoreSnapshot = useGameStore((state) => state.setSnapshot);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(storeSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionMap, setInteractionMap] = useState<Record<string, string[]>>({});
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [lastInteraction, setLastInteraction] = useState<null | {
    type: 'MENTOR' | 'SUPPORT' | 'BOND' | 'DEBRIEF';
    moraleDelta: number;
    healthDelta: number;
    promotionPointsDelta: number;
    moneyDelta: number;
  }>(null);
  const [npcActivity, setNpcActivity] = useState<
    Record<
      string,
      {
        result: string;
        readiness: number;
        morale: number;
        rankInfluence: number;
        promotionRecommendation: 'STRONG_RECOMMEND' | 'RECOMMEND' | 'HOLD' | 'NOT_RECOMMENDED';
        notificationLetter: string | null;
      }
    >
  >({});

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

  const selectedNpc = useMemo(() => {
    if (!world) return null;
    return world.roster.find((npc) => npc.id === selectedId) ?? world.roster[0] ?? null;
  }, [selectedId, world]);

  useEffect(() => {
    if (!world) return;
    setInteractionMap((prev) => {
      const next = { ...prev };
      for (const npc of world.roster) {
        if (!next[npc.id]) next[npc.id] = initialLog(npc);
      }
      return next;
    });
  }, [world]);

  useEffect(() => {
    if (!selectedNpc) return;
    const selectedNpcId = selectedNpc.id;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const lines = [
        `${selectedNpc.name}: Requesting updated mission route.`,
        `${selectedNpc.name}: NPC squad synced with player movement.`,
        `${selectedNpc.name}: Executing hierarchy command protocol.`,
        `${selectedNpc.name}: Reporting contact status from ${selectedNpc.subdivision}.`,
        `${selectedNpc.name}: Awaiting sanction / reward decision from superior officer.`
      ];

      setInteractionMap((prev) => {
        const current = prev[selectedNpcId] ?? initialLog(selectedNpc);
        const message = lines[(current.length + selectedNpc.relationScore) % lines.length];
        return { ...prev, [selectedNpcId]: [...current.slice(-9), message] };
      });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [selectedNpc?.id]);

  useEffect(() => {
    const loadActivity = () => {
      api
        .npcActivity()
        .then((response) => {
          setNpcActivity(
            response.items.reduce<Record<string, { result: string; readiness: number; morale: number; rankInfluence: number; promotionRecommendation: 'STRONG_RECOMMEND' | 'RECOMMEND' | 'HOLD' | 'NOT_RECOMMENDED'; notificationLetter: string | null }>>((acc, item) => {
              acc[item.npcId] = {
                result: item.result,
                readiness: item.readiness,
                morale: item.morale,
                rankInfluence: item.rankInfluence,
                promotionRecommendation: item.promotionRecommendation,
                notificationLetter: item.notificationLetter
              };
              return acc;
            }, {})
          );
        })
        .catch((err: Error) => {
          setError(`NPC activity sync gagal: ${err.message}`);
        });
    };

    loadActivity();
    const timer = window.setInterval(loadActivity, 9000);
    return () => window.clearInterval(timer);
  }, []);

  const sendCommand = async (cmd: string, interaction: 'MENTOR' | 'SUPPORT' | 'BOND' | 'DEBRIEF') => {
    if (!selectedNpc) return;
    setInteractionBusy(true);
    const currentNpc = selectedNpc;
    setInteractionMap((prev) => {
      const current = prev[currentNpc.id] ?? initialLog(currentNpc);
      return {
        ...prev,
        [currentNpc.id]: [...current.slice(-8), `You: ${cmd}`, `${currentNpc.name}: Processing interaction...`].slice(-10)
      };
    });

    try {
      const response = await api.socialInteraction(`npc-${currentNpc.slot + 1}`, interaction, cmd);
      setSnapshot(response.snapshot);
      setStoreSnapshot(response.snapshot);
      const effect = (response.details?.effect ?? {}) as {
        moraleDelta?: number;
        healthDelta?: number;
        promotionPointsDelta?: number;
        moneyDelta?: number;
      };
      setLastInteraction({
        type: interaction,
        moraleDelta: effect.moraleDelta ?? 0,
        healthDelta: effect.healthDelta ?? 0,
        promotionPointsDelta: effect.promotionPointsDelta ?? 0,
        moneyDelta: effect.moneyDelta ?? 0
      });
      setInteractionMap((prev) => {
        const current = prev[currentNpc.id] ?? initialLog(currentNpc);
        return {
          ...prev,
          [currentNpc.id]: [...current.slice(-8), `${currentNpc.name}: Interaction complete. Cohesion updated.`].slice(-10)
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social interaction failed');
      setInteractionMap((prev) => {
        const current = prev[currentNpc.id] ?? initialLog(currentNpc);
        return {
          ...prev,
          [currentNpc.id]: [...current.slice(-8), `${currentNpc.name}: Unable to complete interaction now.`].slice(-10)
        };
      });
    } finally {
      setInteractionBusy(false);
    }
  };

  const activeLog = selectedNpc ? interactionMap[selectedNpc.id] ?? initialLog(selectedNpc) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between cyber-panel p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">People & NPC Console</p>
          <h1 className="text-base font-semibold text-text">Smart Social Ops · Realtime NPC</h1>
          <p className="text-[11px] text-muted">Layout ringkas, interaksi cepat, dampak langsung ke morale/health/promotion.</p>
        </div>
        <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
          Back to Dashboard
        </Link>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!world && !error ? <p className="text-sm text-muted">Loading people list...</p> : null}

      {world ? (
        <div className="grid gap-3 lg:grid-cols-[290px,1fr]">
          <aside className="cyber-panel p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-muted">NPC / People List (Scroll Box)</p>
            <div className="mt-2 max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
              {world.roster.map((npc) => (
                <button
                  key={npc.id}
                  onClick={() => setSelectedId(npc.id)}
                  className={`w-full rounded border px-3 py-2 text-left ${selectedNpc?.id === npc.id ? 'border-accent bg-accent/10' : 'border-border bg-bg/50'}`}
                >
                  <p className="text-sm font-semibold text-text">{npc.name}</p>
                  <p className="text-xs text-muted">{npc.rank} · {npc.division}</p>
                  <p className="text-xs text-muted">Behavior: {npc.behaviorTag} · Relation: {npc.relationScore} · Score: {npc.progressionScore}</p>
                  <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[10px] uppercase ${statusTone(npc.status)}`}>{npc.status}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-3">
            {selectedNpc ? (
              <>
                <AvatarFrame
                  name={selectedNpc.name}
                  subtitle={`${selectedNpc.rank} · ${selectedNpc.role}`}
                  uniformTone={npcUniformTone(selectedNpc)}
                  ribbons={selectedNpc.ribbons}
                  medals={selectedNpc.medals}
                  shoulderRankCount={2}
                  details={[
                    `${selectedNpc.division} / ${selectedNpc.subdivision}`,
                    `Behavior: ${selectedNpc.behaviorTag}`,
                    `Relation score: ${selectedNpc.relationScore}`,
                    `Status: ${selectedNpc.status}`,
                    `Progress score: ${selectedNpc.progressionScore}`,
                    `Server activity: ${npcActivity[`npc-${selectedNpc.slot + 1}`]?.result ?? 'syncing...'}`,
                    `Promotion rec: ${npcActivity[`npc-${selectedNpc.slot + 1}`]?.promotionRecommendation ?? 'HOLD'}`,
                    `Rank influence: ${npcActivity[`npc-${selectedNpc.slot + 1}`]?.rankInfluence ?? 1}`
                  ]}
                />
                <PersonalStatsPanel
                  title={selectedNpc.name}
                  seed={selectedNpc.slot + selectedNpc.lastSeenOnDay}
                  baseMorale={npcActivity[`npc-${selectedNpc.slot + 1}`]?.morale ?? Math.min(100, selectedNpc.relationScore)}
                  baseHealth={selectedNpc.status === 'INJURED' ? 58 : 82}
                  baseReadiness={npcActivity[`npc-${selectedNpc.slot + 1}`]?.readiness ?? selectedNpc.commandPower}
                />
                {npcActivity[`npc-${selectedNpc.slot + 1}`]?.notificationLetter ? (
                  <p className="rounded border border-border bg-bg/60 p-2 text-xs text-muted">
                    {npcActivity[`npc-${selectedNpc.slot + 1}`]?.notificationLetter}
                  </p>
                ) : null}
              </>
            ) : null}

            <div className="cyber-panel p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-muted">Realtime Interaction</p>
              <div className="mt-2 max-h-44 overflow-y-auto rounded border border-border bg-bg/60 p-2 text-xs text-muted">
                {activeLog.map((line, idx) => (
                  <p key={`${selectedNpc?.id ?? 'npc'}-${idx}-${line}`} className="mb-1">
                    {line}
                  </p>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-4">
                <button disabled={interactionBusy} onClick={() => void sendCommand('Mentor Uniting session: improve tactical discipline and mission confidence.', 'MENTOR')} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">
                  Mentor
                </button>
                <button disabled={interactionBusy} onClick={() => void sendCommand('Support Log package approved: supply, medkit, and morale brief delivered.', 'SUPPORT')} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">
                  Support
                </button>
                <button disabled={interactionBusy} onClick={() => void sendCommand('Trust-building sync: align goals and clarify personal concerns.', 'BOND')} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">
                  Build Trust
                </button>
                <button disabled={interactionBusy} onClick={() => void sendCommand('Post-action debrief: extract lessons and set immediate improvements.', 'DEBRIEF')} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">
                  Fast Debrief
                </button>
              </div>
              {lastInteraction ? (
                <p className="mt-2 rounded border border-border bg-bg/60 p-2 text-xs text-muted">
                  Last interaction ({lastInteraction.type}) · Morale {lastInteraction.moraleDelta >= 0 ? '+' : ''}
                  {lastInteraction.moraleDelta} · Health {lastInteraction.healthDelta >= 0 ? '+' : ''}
                  {lastInteraction.healthDelta} · Promotion {lastInteraction.promotionPointsDelta >= 0 ? '+' : ''}
                  {lastInteraction.promotionPointsDelta} · Funds {Math.round(lastInteraction.moneyDelta / 100)}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
