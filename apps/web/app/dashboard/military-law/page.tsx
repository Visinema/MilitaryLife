'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CouncilState } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

const COUNCIL_LABEL: Record<CouncilState['councilType'], string> = {
  MLC: 'Military Legislative Council',
  DOM: 'Dewan Operasi Militer',
  PERSONNEL_BOARD: 'Personnel Board',
  STRATEGIC_COUNCIL: 'Strategic Council'
};

export default function MilitaryLawPage() {
  const [councils, setCouncils] = useState<CouncilState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCouncilId, setBusyCouncilId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const loadCouncils = async () => {
    setLoading(true);
    try {
      const res = await api.v5Councils();
      setCouncils(res.councils);
      setMessage('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal memuat data councils V5.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCouncils();
  }, []);

  const openCouncils = useMemo(() => councils.filter((item) => item.status === 'OPEN'), [councils]);

  const vote = async (councilId: string, voteChoice: 'APPROVE' | 'REJECT' | 'ABSTAIN') => {
    setBusyCouncilId(councilId);
    setMessage('');
    try {
      const res = await api.v5CouncilVote({ councilId, voteChoice });
      if (res.council) {
        setCouncils((prev) => prev.map((item) => (item.councilId === res.council?.councilId ? res.council : item)));
      } else {
        await loadCouncils();
      }
      setMessage(`Vote ${voteChoice} tercatat untuk council ${councilId}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Vote gagal diproses.');
    } finally {
      setBusyCouncilId(null);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <section className="cyber-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Governance V5</p>
            <h1 className="text-sm font-semibold text-text">Military Law & Councils</h1>
            <p className="text-muted">Military Law kini dijalankan melalui sistem dewan (MLC/DOM/Personnel/Strategic) berbasis quorum.</p>
          </div>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text">
            Back Dashboard
          </Link>
        </div>
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold text-text">Agenda Dewan Aktif</h2>
          <button
            onClick={() => void loadCouncils()}
            disabled={loading}
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loading ? <p className="text-muted">Memuat councils...</p> : null}
        {!loading && openCouncils.length === 0 ? <p className="text-muted">Tidak ada council OPEN saat ini.</p> : null}

        <div className="space-y-2">
          {openCouncils.map((council) => {
            const totalVotes = council.votes.approve + council.votes.reject + council.votes.abstain;
            const remaining = Math.max(0, council.quorum - totalVotes);
            return (
              <article key={council.councilId} className="rounded border border-border/60 bg-bg/70 p-2 space-y-1">
                <p className="font-semibold text-text">{COUNCIL_LABEL[council.councilType]} ({council.councilType})</p>
                <p className="text-muted">Agenda: {council.agenda}</p>
                <p className="text-muted">
                  Opened Day {council.openedDay} | Quorum {council.quorum} | Sisa ke quorum: {remaining}
                </p>
                <p className="text-muted">
                  Vote: Approve {council.votes.approve} | Reject {council.votes.reject} | Abstain {council.votes.abstain}
                </p>
                <div className="flex flex-wrap gap-1 pt-1">
                  <button
                    disabled={busyCouncilId === council.councilId}
                    onClick={() => void vote(council.councilId, 'APPROVE')}
                    className="rounded border border-emerald-500 bg-emerald-600 px-2 py-0.5 text-[11px] text-white disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyCouncilId === council.councilId}
                    onClick={() => void vote(council.councilId, 'REJECT')}
                    className="rounded border border-danger/70 bg-danger/20 px-2 py-0.5 text-[11px] text-danger disabled:opacity-60"
                  >
                    Reject
                  </button>
                  <button
                    disabled={busyCouncilId === council.councilId}
                    onClick={() => void vote(council.councilId, 'ABSTAIN')}
                    className="rounded border border-border bg-panel px-2 py-0.5 text-[11px] text-text disabled:opacity-60"
                  >
                    Abstain
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="cyber-panel p-3 space-y-2">
        <h2 className="text-[12px] font-semibold text-text">Riwayat Council</h2>
        {councils.length === 0 ? <p className="text-muted">Belum ada data council.</p> : null}
        <div className="max-h-[18rem] space-y-1 overflow-y-auto pr-1">
          {councils
            .slice()
            .sort((a, b) => {
              if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1;
              return b.openedDay - a.openedDay;
            })
            .map((entry) => (
              <div key={entry.councilId} className="rounded border border-border/50 bg-panel px-2 py-1">
                <p className="text-text">{COUNCIL_LABEL[entry.councilType]} | {entry.status}</p>
                <p className="text-muted">Day {entry.openedDay}{entry.closedDay ? ` -> ${entry.closedDay}` : ''} | Agenda: {entry.agenda}</p>
                <p className="text-muted">Vote A/R/AB: {entry.votes.approve}/{entry.votes.reject}/{entry.votes.abstain}</p>
              </div>
            ))}
        </div>
        {message ? <p className="text-muted">{message}</p> : null}
      </section>
    </div>
  );
}