'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { AvatarFrame, npcUniformTone } from '@/components/avatar-frame';
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
    }, 3200);
    return () => window.clearInterval(timer);
  }, [selectedNpc?.id]);

  const sendCommand = (cmd: string) => {
    if (!selectedNpc) return;
    setInteractionMap((prev) => {
      const current = prev[selectedNpc.id] ?? initialLog(selectedNpc);
      return {
        ...prev,
        [selectedNpc.id]: [...current.slice(-8), `You: ${cmd}`, `${selectedNpc.name}: Command acknowledged.`].slice(-10)
      };
    });
  };

  const activeLog = selectedNpc ? interactionMap[selectedNpc.id] ?? initialLog(selectedNpc) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between cyber-panel p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">People & NPC Console</p>
          <h1 className="text-lg font-semibold text-text">Realtime NPC Profiles, Avatars, and Interactions</h1>
        </div>
        <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
          Back to Dashboard
        </Link>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!world && !error ? <p className="text-sm text-muted">Loading people list...</p> : null}

      {world ? (
        <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
          <aside className="cyber-panel p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-muted">NPC / People List (Scroll Box)</p>
            <div className="mt-2 max-h-[540px] space-y-2 overflow-y-auto pr-1">
              {world.roster.map((npc) => (
                <button
                  key={npc.id}
                  onClick={() => setSelectedId(npc.id)}
                  className={`w-full rounded border px-3 py-2 text-left ${selectedNpc?.id === npc.id ? 'border-accent bg-accent/10' : 'border-border bg-bg/50'}`}
                >
                  <p className="text-sm font-semibold text-text">{npc.name}</p>
                  <p className="text-xs text-muted">{npc.rank} · {npc.division}</p>
                  <p className="text-xs text-muted">Behavior: {npc.behaviorTag} · Relation: {npc.relationScore}</p>
                  <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[10px] uppercase ${statusTone(npc.status)}`}>{npc.status}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-3">
            {selectedNpc ? (
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
                  `Status: ${selectedNpc.status}`
                ]}
              />
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
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => sendCommand('Hold position and secure perimeter')} className="rounded border border-border px-2 py-1 text-xs text-text">
                  Hold Position
                </button>
                <button onClick={() => sendCommand('Proceed with recon and report every 5 min')} className="rounded border border-border px-2 py-1 text-xs text-text">
                  Recon
                </button>
                <button onClick={() => sendCommand('Assist wounded unit and regroup')} className="rounded border border-border px-2 py-1 text-xs text-text">
                  Assist Unit
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
