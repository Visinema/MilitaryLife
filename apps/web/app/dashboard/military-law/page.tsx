'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { MilitaryLawEntry, MilitaryLawPresetId } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

type GovernanceState = {
  canPlayerVote: boolean;
  meetingActive: boolean;
  meetingDay: number;
  totalMeetingDays: number;
  scheduledPresetId: MilitaryLawPresetId | null;
  note: string;
};

type LawArticle = {
  key: string;
  title: string;
  summary: string;
  value: string;
};

function ArticlePanel({ article, defaultOpen = false }: { article: LawArticle; defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="rounded border border-border/60 bg-bg/70 p-2"
    >
      <summary className="cursor-pointer select-none text-[11px] font-semibold text-text">
        {article.title}
      </summary>
      <div className="mt-2 rounded border border-border/50 bg-panel px-2 py-1">
        <p className="text-muted">{article.summary}</p>
        <p className="text-text">{article.value}</p>
      </div>
    </details>
  );
}

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
    governance: GovernanceState;
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
  const lmcMembers = data?.mlcEligibleMembers ?? snapshot?.mlcEligibleMembers ?? 0;
  const governance = data?.governance ?? {
    canPlayerVote: false,
    meetingActive: false,
    meetingDay: 0,
    totalMeetingDays: 3,
    scheduledPresetId: null,
    note: ''
  };

  const currentArticles = useMemo<LawArticle[]>(() => {
    if (!current) return [];
    return [
      {
        key: 'chief-term',
        title: 'Pasal 1: Batas Masa Jabatan Chief',
        summary: 'Mengatur panjang masa jabatan Chief of Staff sebelum evaluasi ulang.',
        value: `${current.rules.chiefOfStaffTermLimitDays} hari`
      },
      {
        key: 'cabinet-seat',
        title: 'Pasal 2: Formasi Kabinet',
        summary: 'Menentukan jumlah kursi kabinet yang aktif pada struktur komando.',
        value: `${current.rules.cabinetSeatCount} kursi kabinet`
      },
      {
        key: 'optional-posts',
        title: 'Pasal 3: Jabatan Opsional',
        summary: 'Jabatan tambahan yang diaktifkan oleh Military Law berjalan.',
        value: current.rules.optionalPosts.length ? current.rules.optionalPosts.join(' · ') : 'Tidak ada jabatan tambahan'
      }
    ];
  }, [current]);

  const voteLaw = async (presetId: MilitaryLawPresetId) => {
    setBusyPreset(presetId);
    setMessage('');
    try {
      const res = await api.militaryLawVote({ presetId, rationale: `LMC emergency session for ${presetId}` });
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
      setMessage(`Military Law v${res.snapshot.militaryLawCurrent?.version ?? '-'} disahkan melalui voting Dewan LMC.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Voting LMC gagal');
    } finally {
      setBusyPreset(null);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <section className="cyber-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Law Military Council</p>
            <h1 className="text-sm font-semibold text-text">Military Law Governance</h1>
            <p className="text-muted">Anggota LMC aktif (rank minimal Major): <span className="text-text">{lmcMembers}</span> suara.</p>
            <p className="text-muted">{governance.note}</p>
          </div>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text">Back Dashboard</Link>
        </div>
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Military Law Aktif</h2>
        {!current ? (
          <p className="text-muted">Belum ada Military Law yang disahkan. Rapat NPC highrank akan menetapkan hukum pertama dalam 3 hari.</p>
        ) : (
          <div className="rounded border border-border/60 bg-bg/70 p-2 space-y-2">
            <p className="text-text font-semibold">v{current.version} · {current.title}</p>
            <p className="text-muted">{current.summary}</p>
            <p className="text-muted">Disahkan hari {current.enactedDay} · Voting {current.votesFor}:{current.votesAgainst} dari {current.councilMembers} suara.</p>
            <div className="space-y-2">
              {currentArticles.map((article, idx) => (
                <ArticlePanel key={article.key} article={article} defaultOpen={idx === 0} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Rapat Voting LMC (Preset Hukum)</h2>
        {!governance.canPlayerVote ? <p className="text-muted">Rank di bawah Major hanya dapat melihat Military Law aktif tanpa hak ubah.</p> : null}
        {governance.meetingActive ? <p className="text-muted">Rapat NPC highrank sedang berlangsung ({governance.meetingDay}/{governance.totalMeetingDays} hari) untuk opsi {governance.scheduledPresetId}.</p> : null}
        <div className="grid gap-2 lg:grid-cols-2">
          {presets.map((preset) => {
            const presetArticles: LawArticle[] = [
              {
                key: `${preset.id}-chief-term`,
                title: 'Pasal 1: Batas Masa Jabatan Chief',
                summary: 'Batas masa jabatan Chief of Staff untuk preset ini.',
                value: `${preset.rules.chiefOfStaffTermLimitDays} hari`
              },
              {
                key: `${preset.id}-cabinet-seat`,
                title: 'Pasal 2: Formasi Kabinet',
                summary: 'Jumlah kursi kabinet yang berlaku pada preset ini.',
                value: `${preset.rules.cabinetSeatCount} kursi kabinet`
              },
              {
                key: `${preset.id}-optional-posts`,
                title: 'Pasal 3: Jabatan Opsional',
                summary: 'Daftar jabatan opsional yang aktif pada preset ini.',
                value: preset.rules.optionalPosts.length ? preset.rules.optionalPosts.join(' · ') : 'Tidak ada jabatan tambahan'
              }
            ];

            return (
              <div key={preset.id} className="rounded border border-border/60 bg-bg/70 p-2 space-y-2">
                <p className="text-text font-semibold">{preset.title}</p>
                <p className="text-muted">{preset.summary}</p>
                <p className="text-muted">Career {preset.rules.promotionPointMultiplierPct}% · NPC Drift {preset.rules.npcCommandDrift >= 0 ? '+' : ''}{preset.rules.npcCommandDrift}</p>

                <div className="space-y-2">
                  {presetArticles.map((article) => (
                    <ArticlePanel key={article.key} article={article} />
                  ))}
                </div>

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
            );
          })}
        </div>
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Log Perubahan Military Law (Disetujui LMC)</h2>
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
