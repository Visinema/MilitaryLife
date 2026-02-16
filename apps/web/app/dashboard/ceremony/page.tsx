'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { CeremonyCycleV5, DomOperationCycle, ExpansionStateV51 } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

type CeremonyViewState = {
  ceremony: CeremonyCycleV5 | null;
  domCycle: DomOperationCycle | null;
  medalCompetition: ExpansionStateV51['domMedalCompetition'] | undefined;
};

function extractSessionMedalQuota(cycle: DomOperationCycle | null): number {
  if (!cycle) return 0;
  return cycle.sessions.reduce((sum, session) => {
    const raw = Number(session.result?.medalQuota ?? 0);
    if (!Number.isFinite(raw)) return sum;
    return sum + Math.max(0, Math.floor(raw));
  }, 0);
}

function CeremonyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forcedAccess = searchParams.get('forced') === '1';
  const [data, setData] = useState<CeremonyViewState>({
    ceremony: null,
    domCycle: null,
    medalCompetition: undefined
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [ceremonyRes, domRes, expansionRes] = await Promise.all([
        api.v5CeremonyCurrent(),
        api.v5DomCycleCurrent(),
        api.v5ExpansionState()
      ]);
      setData({
        ceremony: ceremonyRes.ceremony,
        domCycle: domRes.cycle,
        medalCompetition: expansionRes.state.domMedalCompetition
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data upacara.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!forcedAccess) return;
    if (loading) return;
    if (data.ceremony?.status === 'PENDING') return;

    const doneToken = String(data.ceremony?.ceremonyDay ?? 'sync');
    const timer = window.setTimeout(() => {
      router.replace(`/dashboard?ceremonyDone=${encodeURIComponent(doneToken)}`);
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [data.ceremony?.status, forcedAccess, loading, router]);

  const completeCeremony = async () => {
    if (!data.ceremony || data.ceremony.status !== 'PENDING') return;
    setBusy(true);
    setError(null);
    try {
      await api.v5CeremonyComplete();
      const refreshed = await api.snapshot();
      if (refreshed.snapshot.ceremonyDue) {
        setError('Status upacara masih terbaca pending. Refresh halaman lalu coba lagi agar sinkron dengan snapshot terbaru.');
        return;
      }
      const completedDay = refreshed.snapshot.ceremonyCompletedDay ?? refreshed.snapshot.gameDay;
      router.replace(`/dashboard?ceremonyDone=${completedDay}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyelesaikan upacara.');
    } finally {
      setBusy(false);
    }
  };

  const allocatedCycleMedals = useMemo(() => extractSessionMedalQuota(data.domCycle), [data.domCycle]);
  const totalPool = data.medalCompetition?.totalQuota ?? 0;
  const remainingPool =
    data.medalCompetition?.remaining ?? Math.max(0, totalPool - allocatedCycleMedals);

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Ceremony V5</p>
        <h1 className="text-lg font-semibold text-text">Upacara, Medali, dan Prestasi</h1>
        <p className="mt-1 text-xs text-muted">
          Medali kini memakai pool lintas 3 sesi DOM untuk memperketat kompetisi.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">
            Back Dashboard
          </Link>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-border bg-bg px-3 py-1 text-xs text-text disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => void completeCeremony()}
            disabled={busy || !data.ceremony || data.ceremony.status !== 'PENDING'}
            className="rounded border border-accent bg-accent/20 px-3 py-1 text-xs text-text disabled:opacity-60"
          >
            {busy ? 'Menyelesaikan...' : 'Selesaikan Upacara'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section className="cyber-panel grid gap-2 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <p>
          Status Upacara: <span className="text-text">{data.ceremony?.status ?? 'BELUM ADA'}</span>
        </p>
        <p>
          Day Upacara: <span className="text-text">{data.ceremony?.ceremonyDay ?? '-'}</span>
        </p>
        <p>
          Medal Pool Cycle: <span className="text-text">{totalPool}</span>
        </p>
        <p>
          Sisa Medal Pool: <span className="text-text">{remainingPool}</span>
        </p>
      </section>

      {data.ceremony ? (
        <>
          <section className="cyber-panel p-3 text-xs">
            <h2 className="text-sm font-semibold text-text">Ringkasan Upacara</h2>
            <p className="mt-1 text-muted">
              Attendance: <span className="text-text">{data.ceremony.summary.attendance}</span>
            </p>
            <p className="text-muted">
              Memorial KIA: <span className="text-text">{data.ceremony.summary.kiaMemorialCount}</span>
            </p>
            <p className="text-muted">
              Command rotation applied:{' '}
              <span className="text-text">{data.ceremony.summary.commandRotationApplied ? 'YES' : 'NO'}</span>
            </p>
          </section>

          <section className="cyber-panel p-3 text-xs">
            <h2 className="text-sm font-semibold text-text">Daftar Penerima Medal</h2>
            {data.ceremony.awards.length === 0 ? (
              <p className="mt-1 text-muted">Belum ada penerima medal pada cycle ini.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {data.ceremony.awards.map((award) => (
                  <article key={`${award.orderNo}-${award.recipientName}`} className="rounded border border-border/60 bg-bg/60 p-2">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Recipient #{award.orderNo}</p>
                    <p className="font-medium text-text">{award.recipientName}</p>
                    <p className="text-muted">
                      {award.medal} / {award.ribbon}
                    </p>
                    <p className="text-muted">{award.reason}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="cyber-panel p-3 text-xs">
          <p className="text-muted">Belum ada upacara yang aktif/pending pada saat ini.</p>
        </section>
      )}

      <section className="cyber-panel p-3 text-xs">
        <h2 className="text-sm font-semibold text-text">Kompetisi Medal DOM</h2>
        {data.domCycle ? (
          <div className="mt-2 space-y-2">
            <p className="text-muted">
              Cycle: <span className="text-text">{data.domCycle.cycleId}</span> (Day {data.domCycle.startDay} - {data.domCycle.endDay})
            </p>
            <p className="text-muted">
              Session selesai: <span className="text-text">{data.medalCompetition?.completedSessions ?? 0}/3</span>
            </p>
            <div className="space-y-1">
              {data.domCycle.sessions
                .slice()
                .sort((a, b) => a.sessionNo - b.sessionNo)
                .map((session) => (
                  <p key={session.sessionId} className="rounded border border-border/60 bg-bg/60 px-2 py-1 text-muted">
                    Sesi #{session.sessionNo} [{session.participantMode}] - status {session.status} - medal{' '}
                    <span className="text-text">{Number(session.result?.medalQuota ?? 0) || 0}</span>
                  </p>
                ))}
            </div>
          </div>
        ) : (
          <p className="mt-1 text-muted">DOM cycle belum tersedia.</p>
        )}
      </section>
    </div>
  );
}

export default function CeremonyPage() {
  return (
    <Suspense fallback={<div className="rounded-md border border-border bg-panel p-4 text-sm text-muted">Loading ceremony console...</div>}>
      <CeremonyPageContent />
    </Suspense>
  );
}
