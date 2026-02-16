'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { MilitaryLawEntry, MilitaryLawPresetId } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function MilitaryLawPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busyPreset, setBusyPreset] = useState<MilitaryLawPresetId | null>(null);
  const [data, setData] = useState<{
    current: MilitaryLawEntry | null;
    logs: MilitaryLawEntry[];
    presets: Array<{
      id: MilitaryLawPresetId;
      title: string;
      summary: string;
      rules: {
        cabinetSeatCount: number;
        chiefOfStaffTermLimitDays: number;
        optionalPosts: string[];
        promotionPointMultiplierPct: number;
        npcCommandDrift: number;
      };
    }>;
    mlcEligibleMembers: number;
    governance: {
      canPlayerVote: boolean;
      meetingActive: boolean;
      meetingDay: number;
      totalMeetingDays: number;
      scheduledPresetId: MilitaryLawPresetId | null;
      note: string;
    };
  } | null>(null);

  useEffect(() => {
    api.militaryLaw()
      .then((res) => {
        setData({
          current: res.current,
          logs: res.logs,
          presets: res.presets,
          mlcEligibleMembers: res.mlcEligibleMembers,
          governance: res.governance
        });
        setSnapshot(res.snapshot);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Gagal muat Military Law'))
      .finally(() => setLoading(false));
  }, [setSnapshot]);

  const current = data?.current ?? snapshot?.militaryLawCurrent ?? null;
  const logs = data?.logs ?? snapshot?.militaryLawLogs ?? [];
  const presets = data?.presets ?? [];
  const mlcMembers = data?.mlcEligibleMembers ?? snapshot?.mlcEligibleMembers ?? 0;
  const governance = data?.governance ?? {
    canPlayerVote: false,
    meetingActive: false,
    meetingDay: 0,
    totalMeetingDays: 3,
    scheduledPresetId: null,
    note: ''
  };

  const activeOptionalPosts = useMemo(() => current?.rules.optionalPosts ?? [], [current?.rules.optionalPosts]);

  const voteLaw = async (presetId: MilitaryLawPresetId) => {
    setBusyPreset(presetId);
    setMessage('');
    try {
      const res = await api.militaryLawVote({ presetId, rationale: `MLC emergency session for ${presetId}` });
      setSnapshot(res.snapshot);
      setData((prev) => {
        const nextCurrent = res.snapshot.militaryLawCurrent;
        const nextLogs = res.snapshot.militaryLawLogs;
        return prev
          ? { ...prev, current: nextCurrent, logs: nextLogs, mlcEligibleMembers: res.snapshot.mlcEligibleMembers }
          : {
              current: nextCurrent,
              logs: nextLogs,
              presets: [],
              mlcEligibleMembers: res.snapshot.mlcEligibleMembers,
              governance: {
                canPlayerVote: true,
                meetingActive: false,
                meetingDay: 3,
                totalMeetingDays: 3,
                scheduledPresetId: null,
                note: 'Military Law aktif.'
              }
            };
      });
      setMessage(`Military Law v${res.snapshot.militaryLawCurrent?.version ?? '-'} disahkan melalui voting Dewan MLC.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Voting MLC gagal');
    } finally {
      setBusyPreset(null);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <section className="cyber-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Military Legislative Council</p>
            <h1 className="text-sm font-semibold text-text">Military Law Governance</h1>
            <p className="text-muted">Anggota MLC aktif (rank di atas Kolonel): <span className="text-text">{mlcMembers}</span> suara.</p>
            <p className="text-muted">{governance.note}</p>
          </div>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text">Back Dashboard</Link>
        </div>
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Military Law Aktif</h2>
        {!current ? (
          <p className="text-muted">Belum ada Military Law yang disahkan. Gelar rapat MLC untuk menetapkan hukum pertama.</p>
        ) : (
          <div className="rounded border border-border/60 bg-bg/70 p-2 space-y-1">
            <p className="text-text font-semibold">v{current.version} · {current.title}</p>
            <p className="text-muted">{current.summary}</p>
            <p className="text-muted">Disahkan hari {current.enactedDay} · Voting {current.votesFor}:{current.votesAgainst} dari {current.councilMembers} suara.</p>
            <div className="grid gap-1 sm:grid-cols-2">
              <p className="rounded border border-border/50 bg-panel px-2 py-1 text-muted">Kursi Kabinet: <span className="text-text">{current.rules.cabinetSeatCount}</span></p>
              <p className="rounded border border-border/50 bg-panel px-2 py-1 text-muted">Batas Chief: <span className="text-text">{current.rules.chiefOfStaffTermLimitDays} hari</span></p>
              <p className="rounded border border-border/50 bg-panel px-2 py-1 text-muted">Career Multiplier: <span className="text-text">{current.rules.promotionPointMultiplierPct}%</span></p>
              <p className="rounded border border-border/50 bg-panel px-2 py-1 text-muted">NPC Command Drift: <span className="text-text">{current.rules.npcCommandDrift >= 0 ? '+' : ''}{current.rules.npcCommandDrift}</span></p>
            </div>
            <p className="text-muted">Jabatan kondisional aktif: <span className="text-text">{activeOptionalPosts.length ? activeOptionalPosts.join(' · ') : 'Tidak ada jabatan tambahan'}</span></p>
          </div>
        )}
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Rapat Voting MLC (Preset Hukum)</h2>
        {!governance.canPlayerVote ? <p className="text-muted">Rank di bawah Kolonel hanya dapat melihat Military Law aktif tanpa hak ubah.</p> : null}
        {governance.meetingActive ? <p className="text-muted">Rapat NPC highrank sedang berlangsung ({governance.meetingDay}/{governance.totalMeetingDays} hari) untuk opsi {governance.scheduledPresetId}.</p> : null}
        <div className="grid gap-2 lg:grid-cols-2">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded border border-border/60 bg-bg/70 p-2 space-y-1">
              <p className="text-text font-semibold">{preset.title}</p>
              <p className="text-muted">{preset.summary}</p>
              <p className="text-muted">Kabinet {preset.rules.cabinetSeatCount} · Batas Chief {preset.rules.chiefOfStaffTermLimitDays} hari · Career {preset.rules.promotionPointMultiplierPct}%</p>
              <p className="text-muted">Post opsional: {preset.rules.optionalPosts.join(' · ')}</p>
              {governance.canPlayerVote && !governance.meetingActive ? (
                <button
                  disabled={Boolean(busyPreset)}
                  onClick={() => void voteLaw(preset.id)}
                  className="rounded border border-accent bg-accent/20 px-2 py-1 text-[11px] text-text disabled:opacity-60"
                >
                  {busyPreset === preset.id ? 'Voting...' : `Vote ${preset.id}`}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Log Perubahan Military Law (Disetujui MLC)</h2>
        {loading ? <p className="text-muted">Memuat data law...</p> : null}
        {!loading && logs.length === 0 ? <p className="text-muted">Belum ada log perubahan.</p> : null}
        <div className="max-h-[18rem] space-y-1 overflow-y-auto pr-1">
          {logs.map((entry) => (
            <div key={`${entry.version}-${entry.enactedDay}`} className="rounded border border-border/50 bg-panel px-2 py-1">
              <p className="text-text">v{entry.version} · {entry.title}</p>
              <p className="text-muted">Day {entry.enactedDay} · Vote {entry.votesFor}:{entry.votesAgainst} · Initiator: {entry.initiatedBy}</p>
            </div>
          ))}
        </div>
        {message ? <p className="text-muted">{message}</p> : null}
      </section>
    </div>
  );
}
