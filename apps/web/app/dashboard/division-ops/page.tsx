'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function DivisionOpsPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [result, setResult] = useState<string>('');
  const [dangerTier, setDangerTier] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'>('MEDIUM');
  const [missionType, setMissionType] = useState<'RECON' | 'COUNTER_RAID' | 'BLACK_OPS' | 'TRIBUNAL_SECURITY'>('RECON');
  const [playerParticipates, setPlayerParticipates] = useState(true);

  const runMission = async () => {
    try {
      const res = await api.v3Mission({ missionType, dangerTier, playerParticipates });
      setSnapshot(res.snapshot);
      setResult(`Mission ${missionType} selesai. success=${String(res.details.success)} casualties=${String(res.details.casualties)}`);
    } catch (err) {
      setResult(err instanceof ApiError ? err.message : 'Mission gagal diproses');
    }
  };

  const appointSecretary = async () => {
    const npc = `NPC Secretary ${Math.max(1, (snapshot?.gameDay ?? 1) % 30)}`;
    try {
      const res = await api.appointSecretary(npc);
      setSnapshot(res.snapshot);
      setResult(`Sekretaris kas ditunjuk: ${npc}`);
    } catch (err) {
      setResult(err instanceof ApiError ? err.message : 'Gagal tunjuk sekretaris');
    }
  };

  return (
    <div className="space-y-3">
      <div className="cyber-panel p-3 text-[11px]">
        <h1 className="text-sm font-semibold text-text">V3 Division Operations</h1>
        <p className="text-muted">Divisi aktif pemain: <span className="text-text">{snapshot?.playerDivision ?? '-'}</span> · Posisi: <span className="text-text">{snapshot?.playerPosition ?? '-'}</span></p>
        <Link href="/dashboard" className="mt-1 inline-block rounded border border-border bg-bg px-2 py-1 text-text">Back Dashboard</Link>
      </div>

      <div className="cyber-panel space-y-2 p-3 text-[11px]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select value={missionType} onChange={(e) => setMissionType(e.target.value as typeof missionType)} className="rounded border border-border bg-bg px-2 py-1 text-text">
            <option value="RECON">Recon</option>
            <option value="COUNTER_RAID">Counter Raid</option>
            <option value="BLACK_OPS">Black Ops</option>
            <option value="TRIBUNAL_SECURITY">Tribunal Security</option>
          </select>
          <select value={dangerTier} onChange={(e) => setDangerTier(e.target.value as typeof dangerTier)} className="rounded border border-border bg-bg px-2 py-1 text-text">
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="EXTREME">EXTREME</option>
          </select>
          <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={playerParticipates} onChange={(e) => setPlayerParticipates(e.target.checked)} />Player ikut misi</label>
          <button onClick={() => void runMission()} className="rounded border border-accent bg-accent/20 px-2 py-1 text-text">Jalankan Misi</button>
        </div>

        <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Stabilitas Negara: <span className="text-text">{snapshot?.nationalStability ?? 0}%</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Stabilitas Militer: <span className="text-text">{snapshot?.militaryStability ?? 0}%</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Kas Militer: <span className="text-text">${Math.round((snapshot?.militaryFundCents ?? 0) / 100).toLocaleString()}</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Korupsi: <span className="text-text">{snapshot?.corruptionRisk ?? 0}%</span></div>
        </div>

        <button onClick={() => void appointSecretary()} className="rounded border border-border bg-panel px-2 py-1 text-text">Tunjuk Sekretaris Kas (Chief-only)</button>
        {result ? <p className="text-muted">{result}</p> : null}
      </div>
    </div>
  );
}
