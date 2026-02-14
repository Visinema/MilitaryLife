'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

type MissionStage = 'ASSIGNMENT' | 'BRIEF' | 'COORDINATION' | 'OPERATION' | 'DEBRIEF';

type PrepOption = {
  id: string;
  label: string;
  effect: string;
};

type StrategyOption = {
  id: string;
  name: string;
  summary: string;
  recommendedFor: 'LOW' | 'MID' | 'HIGH';
};

type Obstacle = {
  id: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
};

const MISSION_ASSIGNMENT_INTERVAL_DAYS = 10;

function commandAuthority(snapshot: GameSnapshot): number {
  const rankFactor = snapshot.rankCode.length * 8;
  return Math.min(100, Math.max(10, rankFactor + snapshot.morale / 2 + snapshot.health / 3 + snapshot.gameDay / 2));
}

function difficultyLabel(authority: number): 'LOW' | 'MID' | 'HIGH' {
  if (authority >= 70) return 'HIGH';
  if (authority >= 45) return 'MID';
  return 'LOW';
}

function missionDurationForTier(tier: 'LOW' | 'MID' | 'HIGH'): number {
  if (tier === 'HIGH') return 5;
  if (tier === 'MID') return 3;
  return 2;
}

function buildMissionPack(snapshot: GameSnapshot) {
  const authority = commandAuthority(snapshot);
  const tier = difficultyLabel(authority);

  const chair =
    tier === 'HIGH'
      ? 'Lt. Colonel A. Pradana (Joint Operations Chair)'
      : tier === 'MID'
        ? 'Major S. Halim (Sector Commander)'
        : 'Captain R. Hayes (Squad Lead)';

  const missionPool = [
    'Urban Evacuation Corridor Stabilization',
    'Border Logistics Convoy Security',
    'Critical Infrastructure Protection',
    'Island Relief Route Recon',
    'Night Patrol for Smuggling Interdiction'
  ];

  const title = missionPool[snapshot.gameDay % missionPool.length] ?? missionPool[0];

  const prepOptions: PrepOption[] = [
    { id: 'drone', label: 'Deploy drone recon package', effect: 'Kurangi ambiguitas rute dan kejutan awal' },
    { id: 'medic', label: 'Attach extra medic team', effect: 'Turunkan risiko cedera personel' },
    { id: 'ecm', label: 'Activate ECM anti-jam support', effect: 'Kurangi gangguan komunikasi' },
    { id: 'reserve', label: 'Standby rapid reserve unit', effect: 'Cadangan saat flank gagal' }
  ];

  const strategyOptions: StrategyOption[] = [
    {
      id: 'wedge',
      name: 'Wedge Formation + Recon Spearhead',
      summary: 'Agresif, cepat menembus area sempit dengan risiko konsumsi sumber daya lebih tinggi.',
      recommendedFor: 'HIGH'
    },
    {
      id: 'layered',
      name: 'Layered Security & Staggered Advance',
      summary: 'Stabil dan aman untuk unit campuran, cocok untuk komando menengah.',
      recommendedFor: 'MID'
    },
    {
      id: 'escort',
      name: 'Escort Doctrine + Commander Follow',
      summary: 'Ikuti commander NPC secara ketat, fokus survival untuk personel junior.',
      recommendedFor: 'LOW'
    }
  ];

  const obstacles: Obstacle[] = [
    { id: 'intel-gap', title: 'Intel mismatch di sektor delta', severity: 'MEDIUM' },
    { id: 'civilian', title: 'Arus warga sipil padat memotong rute', severity: 'HIGH' },
    { id: 'signal', title: 'Interferensi radio periodik', severity: 'LOW' }
  ];

  return {
    authority,
    tier,
    chair,
    title,
    prepOptions,
    strategyOptions,
    obstacles,
    durationDays: missionDurationForTier(tier)
  };
}

export default function DeploymentPage() {
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<MissionStage>('ASSIGNMENT');
  const [selectedPrep, setSelectedPrep] = useState<string[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [opProgress, setOpProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [missionPauseToken, setMissionPauseToken] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) return;
    void api.snapshot().then((response) => setSnapshot(response.snapshot));
  }, [setSnapshot, snapshot]);

  const missionPack = useMemo(() => (snapshot ? buildMissionPack(snapshot) : null), [snapshot]);
  const canInfluence = Boolean(missionPack && missionPack.authority >= 60);
  const lastMissionDay = snapshot?.lastMissionDay ?? -MISSION_ASSIGNMENT_INTERVAL_DAYS;
  const daysSinceLastMission = snapshot ? Math.max(0, snapshot.gameDay - lastMissionDay) : 0;
  const assignmentWindowOpen = daysSinceLastMission >= MISSION_ASSIGNMENT_INTERVAL_DAYS;
  const nextWindowInDays = assignmentWindowOpen ? 0 : MISSION_ASSIGNMENT_INTERVAL_DAYS - daysSinceLastMission;

  const togglePrep = (id: string) => {
    setSelectedPrep((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const startOperation = async () => {
    if (!assignmentWindowOpen) {
      setMessage(`Mission assignment belum tersedia. Tunggu ${nextWindowInDays} hari in-game lagi.`);
      return;
    }

    try {
      const pauseRes = await api.pause('MODAL');
      setMissionPauseToken(pauseRes.pauseToken);
      setSnapshot(pauseRes.snapshot);
      setStage('OPERATION');
      setMessage('Mission clock paused. Operation frame berjalan tanpa progres waktu dunia (1 hari = 4 detik realtime).');
      setOpProgress(0);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to start mission operation');
    }
  };

  useEffect(() => {
    if (stage !== 'OPERATION') return;

    const timer = window.setInterval(() => {
      setOpProgress((prev) => {
        const next = Math.min(100, prev + 8);
        if (next >= 100) {
          window.clearInterval(timer);
          setStage('DEBRIEF');
        }
        return next;
      });
    }, 220);

    return () => window.clearInterval(timer);
  }, [stage]);

  const finalizeMission = async () => {
    if (!missionPack) return;

    setBusy(true);
    setMessage(null);
    try {
      const preferredAggressive = selectedStrategy === 'wedge' && canInfluence;
      const missionType: 'PATROL' | 'SUPPORT' = preferredAggressive ? 'PATROL' : 'SUPPORT';
      const response = await api.deployment(missionType, missionPack.durationDays);
      const details = response.details as {
        blocked?: boolean;
        reason?: string;
        succeeded?: boolean;
        advancedDays?: number;
        terrain?: string;
        objective?: string;
        enemyStrength?: number;
        difficultyRating?: number;
        equipmentQuality?: string;
        promotionRecommendation?: string;
      };

      if (missionPauseToken) {
        await api.resume(missionPauseToken).catch(() => {
          // Token can be expired/invalid if server already resumed implicitly.
        });
      }

      setSnapshot(response.snapshot);

      if (details.blocked) {
        setMessage(details.reason ?? 'Mission belum bisa dijalankan saat ini.');
        setMissionPauseToken(null);
        return;
      }

      const result = details.succeeded ? 'Operasi sukses dan target aman.' : 'Operasi selesai dengan kehilangan momentum.';
      setMessage(
        `${missionPack.title} selesai. Dipimpin: ${canInfluence ? 'Anda memimpin squad' : 'Commander NPC'}. ` +
          `${result} Waktu lompat +${details.advancedDays ?? missionPack.durationDays} hari. ` +
          `Terrain: ${details.terrain ?? '-'} · Objective: ${details.objective ?? '-'} · Enemy: ${details.enemyStrength ?? '-'} · ` +
          `Difficulty: ${details.difficultyRating ?? '-'} · Gear: ${details.equipmentQuality ?? '-'} · Promotion rec: ${details.promotionRecommendation ?? 'HOLD'}.`
      );
      setMissionPauseToken(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Mission execution failed');
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot || !missionPack) {
    return (
      <div className="space-y-3">
          <div className="rounded-md border border-border bg-panel p-4 text-sm text-muted">Loading deployment console...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2.5 shadow-panel">
        <h1 className="text-lg font-semibold">Mission Operations</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Stage: {stage}</p>
        <h2 className="mt-2 text-base font-semibold text-text">{missionPack.title}</h2>
        <p className="mt-1 text-sm text-muted">
          Command authority: {Math.round(missionPack.authority)} / 100 · Durasi misi: {missionPack.durationDays} hari.
        </p>
        <p className="mt-1 text-xs text-muted">
          Assignment window: minimal tiap {MISSION_ASSIGNMENT_INTERVAL_DAYS} hari dari misi terakhir ·{' '}
          {assignmentWindowOpen ? 'READY sekarang' : `ready in ${nextWindowInDays} day(s)`}
        </p>
      </div>

      {stage === 'ASSIGNMENT' ? (
        <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
          <p className="text-sm text-muted">Anda berpeluang ditempatkan ke misi prioritas dengan tingkat risiko dinamis.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded border border-border bg-bg p-3 text-sm">Assigned Chair: {missionPack.chair}</div>
            <div className="rounded border border-border bg-bg p-3 text-sm">Branch Track: {snapshot.branch}</div>
          </div>
          <button
            onClick={() => setStage('BRIEF')}
            disabled={!assignmentWindowOpen}
            className="mt-4 rounded border border-accent bg-accent/20 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Continue to Mission Brief
          </button>
        </div>
      ) : null}

      {stage === 'BRIEF' ? (
        <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
          <h3 className="text-sm font-semibold">Mission Brief Frame</h3>
          <p className="mt-1 text-sm text-muted">Centang opsi persiapan (maksimal 3) untuk balancing risiko dan performa unit.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {missionPack.prepOptions.map((option) => {
              const checked = selectedPrep.includes(option.id);
              const disabled = !checked && selectedPrep.length >= 3;
              return (
                <label key={option.id} className="rounded border border-border bg-bg p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => togglePrep(option.id)} className="mt-1" />
                    <span>
                      <span className="block font-medium text-text">{option.label}</span>
                      <span className="text-xs text-muted">{option.effect}</span>
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
          <button
            onClick={() => setStage('COORDINATION')}
            className="mt-4 rounded border border-accent bg-accent/20 px-3 py-2 text-sm font-medium"
          >
            Enter Coordination Room
          </button>
        </div>
      ) : null}

      {stage === 'COORDINATION' ? (
        <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
          <h3 className="text-sm font-semibold">Coordination Room</h3>
          <p className="mt-1 text-sm text-muted">{missionPack.chair} memimpin rapat strategi dan formasi operasi.</p>
          <div className="mt-3 space-y-2">
            {missionPack.strategyOptions.map((strategy) => {
              const chosen = selectedStrategy === strategy.id;
              const locked = !canInfluence && strategy.recommendedFor === 'HIGH';
              return (
                <button
                  key={strategy.id}
                  onClick={() => setSelectedStrategy(strategy.id)}
                  disabled={locked}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${
                    chosen ? 'border-accent bg-accent/20' : 'border-border bg-bg'
                  } disabled:opacity-50`}
                >
                  <span className="block font-medium">{strategy.name}</span>
                  <span className="text-xs text-muted">{strategy.summary}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={startOperation}
            disabled={!selectedStrategy || !assignmentWindowOpen}
            className="mt-4 rounded border border-accent bg-accent/20 px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            Launch Mission Operation (Pause Time)
          </button>
        </div>
      ) : null}

      {stage === 'OPERATION' ? (
        <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
          <h3 className="text-sm font-semibold">Operation Frame (Realtime UI)</h3>
          <p className="mt-1 text-sm text-muted">
            {canInfluence ? 'Anda memimpin squad aktif dan memilih tempo manuver.' : 'Anda mengikuti komandan regu NPC terpilih.'}
          </p>
          <div className="mt-3 h-3 overflow-hidden rounded bg-bg">
            <div className="h-full bg-accent transition-all" style={{ width: `${opProgress}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">Mission progress: {opProgress}% · world clock paused</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {missionPack.obstacles.map((obstacle) => (
              <div key={obstacle.id} className="rounded border border-border bg-bg p-3 text-xs">
                <p className="font-medium text-text">{obstacle.title}</p>
                <p className="text-muted">Severity: {obstacle.severity}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {stage === 'DEBRIEF' ? (
        <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
          <h3 className="text-sm font-semibold">Mission Debrief</h3>
          <p className="mt-1 text-sm text-muted">Finalize mission untuk menutup pause, lalu game day langsung melompat sesuai durasi misi.</p>
          <button
            onClick={finalizeMission}
            disabled={busy}
            className="mt-4 rounded border border-accent bg-accent/20 px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {busy ? 'Finalizing...' : 'Finalize Mission Result'}
          </button>
          {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
