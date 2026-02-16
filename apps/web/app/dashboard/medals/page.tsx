'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CeremonyCycleV5, DomOperationCycle, ExpansionStateV51 } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

type MedalData = {
  expansion: ExpansionStateV51 | null;
  cycle: DomOperationCycle | null;
  ceremony: CeremonyCycleV5 | null;
};

export default function MedalsPage() {
  const [data, setData] = useState<MedalData>({ expansion: null, cycle: null, ceremony: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [expansionRes, cycleRes, ceremonyRes] = await Promise.all([
        api.v5ExpansionState(),
        api.v5DomCycleCurrent(),
        api.v5CeremonyCurrent()
      ]);
      setData({
        expansion: expansionRes.state,
        cycle: cycleRes.cycle,
        ceremony: ceremonyRes.ceremony
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data medali V5.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const sessionRows = useMemo(
    () => (data.cycle?.sessions ?? []).slice().sort((a, b) => a.sessionNo - b.sessionNo),
    [data.cycle?.sessions]
  );

  return (
    <div className="space-y-3">
      <div className="cyber-panel p-3">
        <h1 className="text-sm font-semibold text-text">Medal Competition V5</h1>
        <p className="text-[11px] text-muted">Medali sekarang berbasis kuota terbatas lintas 3 sesi DOM per cycle.</p>
        <div className="mt-1 flex gap-2">
          <Link href="/dashboard" className="inline-block rounded border border-border bg-bg px-2 py-1 text-[11px] text-text">Back Dashboard</Link>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="cyber-panel grid gap-1 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-border/60 bg-bg/70 px-2 py-1">
          Total Quota: <span className="text-text">{data.expansion?.domMedalCompetition?.totalQuota ?? 0}</span>
        </div>
        <div className="rounded border border-border/60 bg-bg/70 px-2 py-1">
          Allocated: <span className="text-text">{data.expansion?.domMedalCompetition?.allocated ?? 0}</span>
        </div>
        <div className="rounded border border-border/60 bg-bg/70 px-2 py-1">
          Remaining: <span className="text-text">{data.expansion?.domMedalCompetition?.remaining ?? 0}</span>
        </div>
        <div className="rounded border border-border/60 bg-bg/70 px-2 py-1">
          Cycle: <span className="text-text">{data.cycle?.cycleId ?? '-'}</span>
        </div>
      </div>

      <div className="cyber-panel max-h-[48vh] space-y-2 overflow-y-auto p-3 text-[11px]">
        <p className="font-semibold text-text">Distribusi Kuota per Sesi DOM</p>
        {sessionRows.length === 0 ? <p className="text-muted">Belum ada sesi DOM.</p> : null}
        {sessionRows.map((session) => (
          <article key={session.sessionId} className="rounded border border-border/60 bg-bg/70 p-2">
            <p className="text-text">Sesi #{session.sessionNo} | {session.participantMode}</p>
            <p className="text-muted">Status: {session.status} | Medal Quota: {Number(session.result?.medalQuota ?? 0) || 0}</p>
            <p className="text-muted">Score: {Number(session.result?.successScore ?? 0) || '-'} | Casualties: {Number(session.result?.casualties ?? 0) || '-'}</p>
          </article>
        ))}
      </div>

      <div className="cyber-panel max-h-[40vh] space-y-2 overflow-y-auto p-3 text-[11px]">
        <p className="font-semibold text-text">Award Terbaru</p>
        {!data.ceremony || data.ceremony.awards.length === 0 ? <p className="text-muted">Belum ada award yang dipublikasikan.</p> : null}
        {data.ceremony?.awards.map((award) => (
          <article key={`${award.orderNo}-${award.recipientName}`} className="rounded border border-border/60 bg-bg/70 p-2">
            <p className="text-text">#{award.orderNo} | {award.recipientName}</p>
            <p className="text-muted">{award.medal} / {award.ribbon}</p>
            <p className="text-muted">{award.reason}</p>
          </article>
        ))}
      </div>
    </div>
  );
}