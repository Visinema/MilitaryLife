'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MissionInstanceV5, NpcRuntimeState, NpcRuntimeStatus } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';
import { useWorldDerivations } from '@/hooks/use-world-derivations';
import { useWorldSync } from '@/hooks/use-world-sync';

const MISSION_TYPES: MissionInstanceV5['missionType'][] = ['RECON', 'COUNTER_RAID', 'BLACK_OPS', 'TRIBUNAL_SECURITY'];
const DANGER_TIERS: MissionInstanceV5['dangerTier'][] = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
const NPC_STATUS_FILTERS: Array<{ label: string; value: NpcRuntimeStatus | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Injured', value: 'INJURED' },
  { label: 'Reserve', value: 'RESERVE' },
  { label: 'KIA', value: 'KIA' },
  { label: 'Recruiting', value: 'RECRUITING' }
];

function statusTone(status: NpcRuntimeStatus): string {
  if (status === 'ACTIVE') return 'text-green-300 border-green-500/40 bg-green-600/10';
  if (status === 'INJURED') return 'text-amber-200 border-amber-500/40 bg-amber-500/10';
  if (status === 'RESERVE') return 'text-sky-200 border-sky-500/40 bg-sky-500/10';
  if (status === 'RECRUITING') return 'text-indigo-200 border-indigo-500/40 bg-indigo-500/10';
  return 'text-red-200 border-red-500/40 bg-red-500/10';
}

export default function DashboardV5Page() {
  const { snapshot, delta, loading, error, forceSync, resetWorld } = useWorldSync();
  const [npcs, setNpcs] = useState<NpcRuntimeState[]>([]);
  const [statusFilter, setStatusFilter] = useState<NpcRuntimeStatus | 'ALL'>('ALL');
  const [cursor, setCursor] = useState<number | null>(null);
  const cursorRef = useRef<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [missionType, setMissionType] = useState<MissionInstanceV5['missionType']>('RECON');
  const [dangerTier, setDangerTier] = useState<MissionInstanceV5['dangerTier']>('MEDIUM');
  const [strategy, setStrategy] = useState('Layered recon with reserve fallback and casualty containment.');
  const [objective, setObjective] = useState('Secure forward corridor and stabilize command chain.');
  const [prepChecklist, setPrepChecklist] = useState('intel-sync, medevac-standby, route-check, comms-backup');
  const [notice, setNotice] = useState<string | null>(null);

  const derived = useWorldDerivations(npcs);

  const applyDeltaToRoster = useCallback((changes: NpcRuntimeState[]) => {
    if (changes.length === 0) return;
    setNpcs((prev) => {
      const map = new Map(prev.map((item) => [item.npcId, item]));
      for (const item of changes) map.set(item.npcId, item);
      return [...map.values()].sort((a, b) => a.slotNo - b.slotNo);
    });
  }, []);

  useEffect(() => {
    if (!delta) return;
    applyDeltaToRoster(delta.changedNpcStates ?? []);
  }, [delta, applyDeltaToRoster]);

  const loadNpcPage = useCallback(
    async (replace = false) => {
      try {
        const response = await api.v5Npcs({
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          cursor: replace ? undefined : cursorRef.current ?? undefined,
          limit: 24
        });

        cursorRef.current = response.nextCursor;
        setCursor(response.nextCursor);
        setNpcs((prev) => {
          if (replace) return response.items;
          const map = new Map(prev.map((item) => [item.npcId, item]));
          for (const item of response.items) map.set(item.npcId, item);
          return [...map.values()].sort((a, b) => a.slotNo - b.slotNo);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load NPC roster';
        setNotice(message);
      }
    },
    [statusFilter]
  );

  useEffect(() => {
    cursorRef.current = null;
    setCursor(null);
    void loadNpcPage(true);
  }, [statusFilter, loadNpcPage]);

  const handleMissionPlan = async () => {
    setBusy('plan');
    try {
      const response = await api.v5MissionPlan({
        missionType,
        dangerTier,
        strategy,
        objective,
        prepChecklist: prepChecklist
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        participantNpcIds: npcs
          .filter((item) => item.status === 'ACTIVE')
          .slice(0, 6)
          .map((item) => item.npcId)
      });
      setNotice(`Mission planned: ${response.mission.missionId}`);
      await forceSync();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Mission planning failed';
      setNotice(message);
    } finally {
      setBusy(null);
    }
  };

  const handleMissionExecute = async () => {
    if (!snapshot?.activeMission) {
      setNotice('No active mission to execute.');
      return;
    }
    setBusy('execute');
    try {
      const response = await api.v5MissionExecute({ missionId: snapshot.activeMission.missionId, playerParticipates: true });
      setNotice(`Mission resolved: success=${String(response.mission.execution?.success ?? false)} casualties=${String(response.mission.execution?.casualties ?? 0)}`);
      await forceSync();
      await loadNpcPage(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mission execution failed';
      setNotice(message);
    } finally {
      setBusy(null);
    }
  };

  const handleCeremonyComplete = async () => {
    setBusy('ceremony');
    try {
      await api.v5CeremonyComplete();
      setNotice('Ceremony completed and command morale updated.');
      await forceSync();
      await loadNpcPage(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ceremony completion failed';
      setNotice(message);
    } finally {
      setBusy(null);
    }
  };

  const handleAcademy = async () => {
    setBusy('academy');
    try {
      const target = npcs.find((item) => item.status === 'ACTIVE');
      const response = await api.v5AcademyEnroll({
        enrolleeType: target ? 'NPC' : 'PLAYER',
        npcId: target?.npcId,
        track: 'HIGH_COMMAND',
        tier: 2
      });
      setNotice(`Academy result: passed=${String(response.passed)} score=${String(response.score)}`);
      await forceSync();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Academy enrollment failed';
      setNotice(message);
    } finally {
      setBusy(null);
    }
  };

  const handleCertification = async () => {
    setBusy('cert');
    try {
      const response = await api.v5CertificationExam({ holderType: 'PLAYER', certCode: 'HIGH_COMMAND_STRATEGY', score: 86 });
      setNotice(`Certification exam submitted: passed=${String(response.passed)} grade=${response.grade}`);
      await forceSync();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Certification exam failed';
      setNotice(message);
    } finally {
      setBusy(null);
    }
  };

  const visibleRoster = useMemo(() => npcs.slice(0, 28), [npcs]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-panel px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">V5 Micro-Sim Console</p>
            <h1 className="text-base font-semibold text-text">World Session Command</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/legacy" className="rounded border border-border bg-bg px-2 py-1 text-xs text-text">Legacy Dashboard</Link>
            <button onClick={() => void resetWorld()} className="rounded border border-danger/60 bg-danger/10 px-2 py-1 text-xs text-text">Reset V5</button>
          </div>
        </div>
        {snapshot ? (
          <div className="mt-2 grid gap-1 text-xs text-muted md:grid-cols-3">
            <p>Day: <span className="text-text">{snapshot.world.currentDay}</span></p>
            <p>Version: <span className="text-text">{snapshot.stateVersion}</span></p>
            <p>Session TTL: <span className="text-text">{snapshot.world.sessionActiveUntilMs ? `${Math.max(0, Math.round((snapshot.world.sessionActiveUntilMs - Date.now()) / 1000))}s` : '-'}</span></p>
            <p>Morale: <span className="text-text">{snapshot.player.morale}%</span></p>
            <p>Health: <span className="text-text">{snapshot.player.health}%</span></p>
            <p>Funds: <span className="text-text">${Math.round(snapshot.player.moneyCents / 100).toLocaleString()}</span></p>
          </div>
        ) : null}
        {loading ? <p className="mt-2 text-xs text-muted">Starting V5 world session...</p> : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        {notice ? <p className="mt-2 text-xs text-accent">{notice}</p> : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.1fr,1fr]">
        <section className="rounded-lg border border-border bg-panel p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted">NPC Roster (Virtualized)</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {NPC_STATUS_FILTERS.map((item) => (
              <button
                key={item.value}
                onClick={() => setStatusFilter(item.value)}
                className={`rounded border px-2 py-1 text-[11px] ${statusFilter === item.value ? 'border-accent bg-accent/20 text-text' : 'border-border text-muted'}`}
              >
                {item.label}
              </button>
            ))}
            <button onClick={() => void loadNpcPage(true)} className="rounded border border-border px-2 py-1 text-[11px] text-text">Refresh</button>
          </div>

          <div className="mt-2 max-h-[430px] space-y-1 overflow-y-auto pr-1">
            {visibleRoster.map((npc) => (
              <div key={npc.npcId} className="rounded border border-border/60 bg-bg/40 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text">#{npc.slotNo} {npc.name}</p>
                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${statusTone(npc.status)}`}>{npc.status}</span>
                </div>
                <p className="text-[11px] text-muted">{npc.division} · {npc.unit} · {npc.position}</p>
                <p className="text-[11px] text-muted">XP {npc.xp} · Fatigue {npc.fatigue} · Trauma {npc.trauma} · Relation {npc.relationToPlayer}</p>
              </div>
            ))}
          </div>

          {cursor ? (
            <button
              onClick={() => void loadNpcPage(false)}
              className="mt-2 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text"
            >
              Load More NPC
            </button>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="rounded-lg border border-border bg-panel p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Mission Pipeline</p>
            <div className="mt-2 grid gap-1.5 md:grid-cols-2">
              <select value={missionType} onChange={(e) => setMissionType(e.target.value as MissionInstanceV5['missionType'])} className="rounded border border-border bg-bg px-2 py-1 text-xs text-text">
                {MISSION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={dangerTier} onChange={(e) => setDangerTier(e.target.value as MissionInstanceV5['dangerTier'])} className="rounded border border-border bg-bg px-2 py-1 text-xs text-text">
                {DANGER_TIERS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <input value={strategy} onChange={(e) => setStrategy(e.target.value)} className="md:col-span-2 rounded border border-border bg-bg px-2 py-1 text-xs text-text" />
              <input value={objective} onChange={(e) => setObjective(e.target.value)} className="md:col-span-2 rounded border border-border bg-bg px-2 py-1 text-xs text-text" />
              <input value={prepChecklist} onChange={(e) => setPrepChecklist(e.target.value)} className="md:col-span-2 rounded border border-border bg-bg px-2 py-1 text-xs text-text" />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button disabled={busy === 'plan'} onClick={() => void handleMissionPlan()} className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-xs text-text disabled:opacity-50">{busy === 'plan' ? 'Planning...' : 'Plan Mission'}</button>
              <button disabled={busy === 'execute'} onClick={() => void handleMissionExecute()} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">{busy === 'execute' ? 'Executing...' : 'Execute Mission'}</button>
            </div>
            {snapshot?.activeMission ? (
              <p className="mt-2 text-[11px] text-muted">Active Mission: <span className="text-text">{snapshot.activeMission.missionType}</span> · {snapshot.activeMission.status} · {snapshot.activeMission.dangerTier}</p>
            ) : <p className="mt-2 text-[11px] text-muted">No active mission.</p>}
          </div>

          <div className="rounded-lg border border-border bg-panel p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Ceremony / Academy / Certification</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button disabled={busy === 'ceremony'} onClick={() => void handleCeremonyComplete()} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">{busy === 'ceremony' ? 'Processing...' : 'Complete Ceremony'}</button>
              <button disabled={busy === 'academy'} onClick={() => void handleAcademy()} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">{busy === 'academy' ? 'Running...' : 'Run Academy'}</button>
              <button disabled={busy === 'cert'} onClick={() => void handleCertification()} className="rounded border border-border px-2 py-1 text-xs text-text disabled:opacity-50">{busy === 'cert' ? 'Submitting...' : 'Exam Cert'}</button>
            </div>
            {snapshot?.pendingCeremony ? (
              <p className="mt-2 text-[11px] text-muted">Pending ceremony day <span className="text-text">{snapshot.pendingCeremony.ceremonyDay}</span> · awards {snapshot.pendingCeremony.awards.length}</p>
            ) : <p className="mt-2 text-[11px] text-muted">No pending ceremony.</p>}
          </div>

          <div className="rounded-lg border border-border bg-panel p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Derived Hierarchy (Worker)</p>
            <p className="mt-1 text-[11px] text-muted">Top command nodes: <span className="text-text">{derived.topCommand.length}</span></p>
            <div className="mt-2 space-y-1 text-[11px] text-muted">
              {derived.topCommand.slice(0, 8).map((item) => (
                <p key={item.npcId}>#{item.npcId} · {item.division} · score <span className="text-text">{item.commandScore}</span> · {item.status}</p>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

