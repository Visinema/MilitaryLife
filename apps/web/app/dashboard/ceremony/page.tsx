'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CeremonyReport } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function CeremonyPage() {
  const router = useRouter();
  const [ceremony, setCeremony] = useState<CeremonyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);

  useEffect(() => {
    let cancelled = false;
    api
      .snapshot()
      .then((response) => {
        if (!cancelled) setSnapshot(response.snapshot);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [setSnapshot]);

  const ceremonyDue = Boolean(snapshot?.ceremonyDue);

  useEffect(() => {
    setError(null);
    if (!ceremonyDue) {
      setCeremony(null);
      return;
    }

    let cancelled = false;
    api
      .ceremony()
      .then((response) => {
        if (!cancelled) setCeremony(response.ceremony);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [ceremonyDue]);

  useEffect(() => {
    if (!ceremonyDue) return;
    let cancelled = false;
    let pollTimer: number | null = null;

    const pollSnapshot = async () => {
      try {
        const res = await api.snapshot();
        if (!cancelled) setSnapshot(res.snapshot);
      } catch {
        // noop
      } finally {
        if (!cancelled) {
          pollTimer = window.setTimeout(() => {
            void pollSnapshot();
          }, 2200);
        }
      }
    };

    void pollSnapshot();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [ceremonyDue, setSnapshot]);

  const completeCeremony = async () => {
    if (!ceremonyDue || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.ceremonyComplete();
      setSnapshot(response.snapshot);
      setCeremony(null);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyelesaikan upacara');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Upacara Medal</p>
        <h1 className="text-lg font-semibold text-text">Parade 12 Harian · Pemberian Pita oleh Chief of Staff</h1>
        <p className="mt-1 text-xs text-muted">
          {ceremonyDue
            ? 'Upacara aktif dan game dipause sampai upacara diselesaikan.'
            : `Upacara berikutnya di Day ${snapshot?.nextCeremonyDay ?? '-'}.`}
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">
            Back Dashboard
          </Link>
          <button
            onClick={completeCeremony}
            disabled={!ceremonyDue || busy}
            className="rounded border border-accent bg-accent/20 px-3 py-1 text-xs text-text disabled:opacity-60"
          >
            {busy ? 'Menyelesaikan...' : 'Selesaikan Upacara (Unpause)'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {ceremony ? (
        <>
          <section className="cyber-panel grid gap-2 p-3 text-xs sm:grid-cols-4">
            <p>Day: <span className="text-text">{ceremony.ceremonyDay}</span></p>
            <p>Attendance: <span className="text-text">{ceremony.attendance}</span></p>
            <p>Medal Quota: <span className="text-text">{ceremony.medalQuota}</span></p>
            <p>Chief Competence: <span className="text-text">{ceremony.chiefOfStaff.competenceScore}</span></p>
          </section>

          <section className="cyber-panel p-3 text-xs">
            <h2 className="text-sm font-semibold text-text">Chief of Staff (NPC Nama Asli)</h2>
            <p className="mt-1 text-text">{ceremony.chiefOfStaff.name}</p>
            <p className="text-muted">
              {ceremony.chiefOfStaff.replacedPreviousChief
                ? `Menggantikan ${ceremony.chiefOfStaff.previousChiefName ?? 'Chief sebelumnya'} karena progres kompetensi lebih tinggi.`
                : 'Posisi Chief tetap dipertahankan pada siklus ini.'}
            </p>
          </section>

          <section className="cyber-panel p-3 text-xs">
            <h2 className="text-sm font-semibold text-text">Logs Upacara</h2>
            <div className="mt-2 space-y-1">
              {ceremony.logs.map((line, idx) => (
                <p key={`log-${idx}`} className="rounded border border-border/60 bg-bg/60 px-2 py-1 text-muted">
                  {line}
                </p>
              ))}
            </div>
          </section>

          <section className="cyber-panel p-3 text-xs">
            <h2 className="text-sm font-semibold text-text">Sesi Pemberian Medal (Satu per Satu)</h2>
            <div className="mt-2 space-y-2">
              {ceremony.recipients.map((recipient) => (
                <article key={`${recipient.order}-${recipient.npcName}`} className="rounded border border-accent/40 bg-accent/10 p-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Recipient #{recipient.order}</p>
                  <p className="font-medium text-text">{recipient.npcName}</p>
                  <p className="text-muted">{recipient.division} · {recipient.unit} · {recipient.position}</p>
                  <p className="text-text">{recipient.medalName} / {recipient.ribbonName}</p>
                  <p className="text-muted">{recipient.reason}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <p className="text-sm text-muted">{ceremonyDue ? 'Loading upacara data...' : 'Upacara belum dimulai. Tunggu hari kelipatan 12 berikutnya.'}</p>
      )}
    </div>
  );
}
