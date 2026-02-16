'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type {
  MilitaryLawCabinetOptionId,
  MilitaryLawChiefTermOptionId,
  MilitaryLawEntry,
  MilitaryLawOptionalPostOptionId
} from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

type LawSelection = {
  chiefTermOptionId: MilitaryLawChiefTermOptionId;
  cabinetOptionId: MilitaryLawCabinetOptionId;
  optionalPostOptionId: MilitaryLawOptionalPostOptionId;
};

type GovernanceState = {
  canPlayerVote: boolean;
  meetingActive: boolean;
  meetingDay: number;
  totalMeetingDays: number;
  scheduledSelection: LawSelection | null;
  note: string;
};

type LawArticleOptions = {
  chiefTerm: Array<{ id: MilitaryLawChiefTermOptionId; label: string; valueDays: number }>;
  cabinet: Array<{ id: MilitaryLawCabinetOptionId; label: string; seatCount: number }>;
  optionalPosts: Array<{ id: MilitaryLawOptionalPostOptionId; label: string; posts: string[] }>;
};

const DEFAULT_SELECTION: LawSelection = {
  chiefTermOptionId: 'TERM_60',
  cabinetOptionId: 'CABINET_6',
  optionalPostOptionId: 'POSTS_BALANCED'
};

function fallbackSelectionFromLaw(law: MilitaryLawEntry | null): LawSelection {
  if (law?.articleSelection) {
    return law.articleSelection as LawSelection;
  }
  return DEFAULT_SELECTION;
}

export default function MilitaryLawPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busyArticle, setBusyArticle] = useState<'chief' | 'cabinet' | 'posts' | null>(null);

  const [data, setData] = useState<{
    current: MilitaryLawEntry | null;
    logs: MilitaryLawEntry[];
    articleOptions: LawArticleOptions;
    mlcEligibleMembers: number;
    governance: GovernanceState;
  } | null>(null);

  const [selection, setSelection] = useState<LawSelection>(DEFAULT_SELECTION);

  useEffect(() => {
    api.militaryLaw()
      .then((res) => {
        setData({
          current: res.current,
          logs: res.logs,
          articleOptions: res.articleOptions,
          mlcEligibleMembers: res.mlcEligibleMembers,
          governance: res.governance
        });
        setSelection(fallbackSelectionFromLaw(res.current));
        setSnapshot(res.snapshot);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Gagal muat Military Law'))
      .finally(() => setLoading(false));
  }, [setSnapshot]);

  const current = data?.current ?? snapshot?.militaryLawCurrent ?? null;
  const logs = data?.logs ?? snapshot?.militaryLawLogs ?? [];
  const articleOptions = data?.articleOptions ?? { chiefTerm: [], cabinet: [], optionalPosts: [] };
  const lmcMembers = data?.mlcEligibleMembers ?? snapshot?.mlcEligibleMembers ?? 0;
  const governance = data?.governance ?? {
    canPlayerVote: false,
    meetingActive: false,
    meetingDay: 0,
    totalMeetingDays: 3,
    scheduledSelection: null,
    note: ''
  };

  const canEdit = governance.canPlayerVote && !governance.meetingActive;

  const currentSummary = useMemo(() => {
    if (!current) return null;
    return {
      chief: `${current.rules.chiefOfStaffTermLimitDays} hari`,
      cabinet: `${current.rules.cabinetSeatCount} kursi`,
      posts: current.rules.optionalPosts.length ? current.rules.optionalPosts.join(' · ') : 'Tidak ada jabatan tambahan'
    };
  }, [current]);

  const submitLaw = async (article: 'chief' | 'cabinet' | 'posts') => {
    setBusyArticle(article);
    setMessage('');
    try {
      const res = await api.militaryLawVote({
        chiefTermOptionId: selection.chiefTermOptionId,
        cabinetOptionId: selection.cabinetOptionId,
        optionalPostOptionId: selection.optionalPostOptionId,
        rationale: `Update pasal ${article}`
      });

      setSnapshot(res.snapshot);
      setData((prev) => {
        const nextCurrent = res.snapshot.militaryLawCurrent;
        const nextLogs = res.snapshot.militaryLawLogs;
        return prev
          ? { ...prev, current: nextCurrent, logs: nextLogs, mlcEligibleMembers: res.snapshot.mlcEligibleMembers }
          : null;
      });
      setMessage(`Perubahan pasal ${article} berhasil diterapkan ke Military Law v${res.snapshot.militaryLawCurrent?.version ?? '-'}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Perubahan Military Law gagal');
    } finally {
      setBusyArticle(null);
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
        {!current || !currentSummary ? (
          <p className="text-muted">Belum ada Military Law yang disahkan. Rapat NPC highrank akan menetapkan hukum pertama dalam 3 hari.</p>
        ) : (
          <div className="rounded border border-border/60 bg-bg/70 p-2 space-y-1">
            <p className="text-text font-semibold">v{current.version} · {current.title}</p>
            <p className="text-muted">{current.summary}</p>
            <p className="text-muted">Pasal 1: {currentSummary.chief}</p>
            <p className="text-muted">Pasal 2: {currentSummary.cabinet}</p>
            <p className="text-muted">Pasal 3: {currentSummary.posts}</p>
          </div>
        )}
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Kustomisasi Per Pasal</h2>
        {!governance.canPlayerVote ? <p className="text-muted">Rank di bawah Major hanya dapat melihat Military Law aktif tanpa hak ubah.</p> : null}
        {governance.meetingActive ? <p className="text-muted">Rapat NPC highrank sedang berlangsung ({governance.meetingDay}/{governance.totalMeetingDays} hari).</p> : null}

        <details className="rounded border border-border/60 bg-bg/70 p-2" open>
          <summary className="cursor-pointer font-semibold text-text">Pasal 1: Batas Masa Jabatan Chief</summary>
          <div className="mt-2 space-y-1">
            {articleOptions.chiefTerm.map((option) => (
              <label key={option.id} className="flex items-center gap-2 rounded border border-border/40 bg-panel px-2 py-1 text-muted">
                <input
                  type="radio"
                  name="chiefTerm"
                  checked={selection.chiefTermOptionId === option.id}
                  onChange={() => setSelection((prev) => ({ ...prev, chiefTermOptionId: option.id }))}
                />
                <span>{option.label} ({option.valueDays} hari)</span>
              </label>
            ))}
            {canEdit ? (
              <button onClick={() => void submitLaw('chief')} disabled={busyArticle !== null} className="rounded border border-accent bg-accent/20 px-2 py-1 text-text disabled:opacity-60">
                {busyArticle === 'chief' ? 'Menyimpan...' : 'Terapkan perubahan Pasal 1'}
              </button>
            ) : null}
          </div>
        </details>

        <details className="rounded border border-border/60 bg-bg/70 p-2">
          <summary className="cursor-pointer font-semibold text-text">Pasal 2: Formasi Kabinet</summary>
          <div className="mt-2 space-y-1">
            {articleOptions.cabinet.map((option) => (
              <label key={option.id} className="flex items-center gap-2 rounded border border-border/40 bg-panel px-2 py-1 text-muted">
                <input
                  type="radio"
                  name="cabinet"
                  checked={selection.cabinetOptionId === option.id}
                  onChange={() => setSelection((prev) => ({ ...prev, cabinetOptionId: option.id }))}
                />
                <span>{option.label} ({option.seatCount} kursi)</span>
              </label>
            ))}
            {canEdit ? (
              <button onClick={() => void submitLaw('cabinet')} disabled={busyArticle !== null} className="rounded border border-accent bg-accent/20 px-2 py-1 text-text disabled:opacity-60">
                {busyArticle === 'cabinet' ? 'Menyimpan...' : 'Terapkan perubahan Pasal 2'}
              </button>
            ) : null}
          </div>
        </details>

        <details className="rounded border border-border/60 bg-bg/70 p-2">
          <summary className="cursor-pointer font-semibold text-text">Pasal 3: Jabatan Opsional</summary>
          <div className="mt-2 space-y-1">
            {articleOptions.optionalPosts.map((option) => (
              <label key={option.id} className="rounded border border-border/40 bg-panel px-2 py-1 text-muted block">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="optionalPosts"
                    checked={selection.optionalPostOptionId === option.id}
                    onChange={() => setSelection((prev) => ({ ...prev, optionalPostOptionId: option.id }))}
                  />
                  <span>{option.label}</span>
                </div>
                <p className="pl-5 text-[11px]">{option.posts.join(' · ')}</p>
              </label>
            ))}
            {canEdit ? (
              <button onClick={() => void submitLaw('posts')} disabled={busyArticle !== null} className="rounded border border-accent bg-accent/20 px-2 py-1 text-text disabled:opacity-60">
                {busyArticle === 'posts' ? 'Menyimpan...' : 'Terapkan perubahan Pasal 3'}
              </button>
            ) : null}
          </div>
        </details>
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
