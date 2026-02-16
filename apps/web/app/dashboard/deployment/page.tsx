'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { DomOperationCycle, DomOperationSession } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

type SessionResultView = {
  sessionId: string;
  success: boolean;
  successScore: number;
  casualties: number;
  fundDeltaCents: number;
  medalQuota: number;
  mode: string;
};

function normalizeSessionResult(session: DomOperationSession): SessionResultView {
  return {
    sessionId: session.sessionId,
    success: Boolean(session.result?.success),
    successScore: Number(session.result?.successScore ?? 0),
    casualties: Number(session.result?.casualties ?? 0),
    fundDeltaCents: Number(session.result?.fundDeltaCents ?? 0),
    medalQuota: Number(session.result?.medalQuota ?? 0),
    mode: String(session.result?.mode ?? session.participantMode)
  };
}

function DeploymentPageContent() {
  const searchParams = useSearchParams();
  const fromMissionCall = searchParams.get('missionCall') === '1';

  const [cycle, setCycle] = useState<DomOperationCycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyJoin, setBusyJoin] = useState(false);
  const [busyExecuteId, setBusyExecuteId] = useState<string | null>(null);
  const [result, setResult] = useState<SessionResultView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.v5DomCycleCurrent();
      setCycle(response.cycle);
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal memuat cycle DOM.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const orderedSessions = useMemo(
    () => (cycle?.sessions ?? []).slice().sort((a, b) => a.sessionNo - b.sessionNo),
    [cycle?.sessions]
  );

  const playerSession = orderedSessions.find((session) => session.participantMode === 'PLAYER_ELIGIBLE' && session.sessionNo === 1) ?? null;

  const joinPlayerSession = async () => {
    if (!playerSession) return;
    setBusyJoin(true);
    setMessage(null);
    try {
      const response = await api.v5DomJoinSession(playerSession.sessionId);
      setCycle(response.cycle);
      setMessage(`Anda join sesi #${response.session.sessionNo}. Slot NPC: ${response.session.npcSlots}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Gagal join sesi player DOM.');
    } finally {
      setBusyJoin(false);
    }
  };

  const executeSession = async (sessionId: string) => {
    setBusyExecuteId(sessionId);
    setMessage(null);
    try {
      const response = await api.v5DomExecuteSession(sessionId);
      setCycle(response.cycle);
      setResult(normalizeSessionResult(response.session));
      setMessage(`Sesi ${response.session.sessionNo} selesai dieksekusi.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Gagal eksekusi sesi DOM.');
    } finally {
      setBusyExecuteId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2.5 shadow-panel">
        <h1 className="text-lg font-semibold">DOM Deployment (V5)</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      {fromMissionCall ? (
        <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-xs text-amber-100">
          Rute misi lama dialihkan ke sistem DOM V5. Pilih sesi player (#1), join, lalu eksekusi.
        </div>
      ) : null}

      <section className="rounded-md border border-border bg-panel p-4 text-sm shadow-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-text">Cycle Saat Ini</h2>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-text disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {!loading && !cycle ? <p className="mt-2 text-muted">Cycle DOM belum tersedia.</p> : null}
        {cycle ? (
          <p className="mt-1 text-xs text-muted">
            {cycle.cycleId} | Day {cycle.startDay} - {cycle.endDay} | Status {cycle.status}
          </p>
        ) : null}

        <div className="mt-3 grid gap-2">
          {orderedSessions.map((session) => (
            <article key={session.sessionId} className="rounded border border-border/60 bg-bg/60 p-2 text-xs">
              <p className="text-text font-medium">
                Sesi #{session.sessionNo} | {session.participantMode}
              </p>
              <p className="text-muted">
                Status: {session.status} | NPC Slots: {session.npcSlots} | Player Joined: {session.playerJoined ? 'YES' : 'NO'}
              </p>

              <div className="mt-2 flex flex-wrap gap-1">
                {session.participantMode === 'PLAYER_ELIGIBLE' ? (
                  <button
                    onClick={() => void joinPlayerSession()}
                    disabled={busyJoin || session.playerJoined}
                    className="rounded border border-accent bg-accent/20 px-2 py-1 text-[11px] text-text disabled:opacity-60"
                  >
                    {busyJoin ? 'Joining...' : session.playerJoined ? 'Joined' : 'Join Session'}
                  </button>
                ) : null}
                <button
                  onClick={() => void executeSession(session.sessionId)}
                  disabled={busyExecuteId === session.sessionId || session.status === 'COMPLETED'}
                  className="rounded border border-emerald-500 bg-emerald-600 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                >
                  {busyExecuteId === session.sessionId ? 'Executing...' : session.status === 'COMPLETED' ? 'Completed' : 'Execute'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {message ? <p className="rounded border border-border bg-panel px-3 py-2 text-sm text-muted">{message}</p> : null}

      {result ? (
        <section className="rounded-md border border-emerald-500/50 bg-panel p-4 shadow-panel">
          <p className="text-xs uppercase tracking-[0.12em] text-emerald-200">Result Session</p>
          <h3 className="mt-1 text-base font-semibold text-text">{result.success ? 'Mission Berhasil' : 'Mission Gagal'}</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted">
            <p>Mode: <span className="text-text">{result.mode}</span></p>
            <p>Score: <span className="text-text">{result.successScore}</span></p>
            <p>Casualties: <span className="text-text">{result.casualties}</span></p>
            <p>Fund Delta: <span className="text-text">{Math.round(result.fundDeltaCents / 100).toLocaleString()}</span></p>
            <p>Medal Quota: <span className="text-text">{result.medalQuota}</span></p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function DeploymentPage() {
  return (
    <Suspense fallback={<div className="rounded-md border border-border bg-panel p-4 text-sm text-muted">Loading deployment console...</div>}>
      <DeploymentPageContent />
    </Suspense>
  );
}