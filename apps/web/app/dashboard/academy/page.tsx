'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AcademyBatchState, AcademyCertificate, ExpansionStateV51 } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

type AcademyQuestionSet = {
  setId: string;
  questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }>;
};

type AcademyCurrentPayload = {
  academyLockActive: boolean;
  academyBatch: AcademyBatchState | null;
  questionSet: AcademyQuestionSet | null;
  worldCurrentDay: number | null;
  state: ExpansionStateV51;
  inventoryCertificates: AcademyCertificate[];
  playerDisplayName: string | null;
};

const TRACK_OPTIONS: Array<{ value: 'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'; label: string }> = [
  { value: 'OFFICER', label: 'Officer' },
  { value: 'HIGH_COMMAND', label: 'High Command' },
  { value: 'SPECIALIST', label: 'Specialist' },
  { value: 'TRIBUNAL', label: 'Tribunal' },
  { value: 'CYBER', label: 'Cyber' }
];

function graduationAnnouncementStorageKey(batchId: string): string {
  return `academy-graduation-announcement:${batchId}`;
}

function resolveAcademyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : null;
    const expectedWorldDay = typeof details?.expectedWorldDay === 'number' ? details.expectedWorldDay : null;
    const currentWorldDay = typeof details?.currentWorldDay === 'number' ? details.currentWorldDay : null;
    if (expectedWorldDay !== null && currentWorldDay !== null) {
      return `${error.message} (current world day: ${currentWorldDay}, required: ${expectedWorldDay}).`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

function AcademyPageContent() {
  const searchParams = useSearchParams();
  const preferredTier = useMemo(() => {
    const parsed = Number(searchParams.get('tier'));
    if (parsed === 3) return 3;
    if (parsed === 2) return 2;
    return 1;
  }, [searchParams]);

  const [track, setTrack] = useState<'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'>('OFFICER');
  const [tier, setTier] = useState<number>(preferredTier);
  const [busy, setBusy] = useState<'start' | 'submit' | 'graduate' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState<AcademyCurrentPayload | null>(null);
  const [answers, setAnswers] = useState<number[]>([1, 1, 1]);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [selectedCertificateId, setSelectedCertificateId] = useState<string | null>(null);
  const announcedBatchRef = useRef<string | null>(null);
  const previousBatchStatusRef = useRef<AcademyBatchState['status'] | null>(null);

  const loadCurrent = useCallback(async () => {
    const [response, certificationResponse] = await Promise.all([
      api.v5AcademyBatchCurrent(),
      api.v5AcademyCertifications()
    ]);
    setCurrent({
      academyLockActive: response.academyLockActive,
      academyBatch: response.academyBatch,
      questionSet: response.questionSet,
      worldCurrentDay: response.snapshot?.world.currentDay ?? null,
      state: response.state,
      inventoryCertificates: certificationResponse.items,
      playerDisplayName: certificationResponse.playerDisplayName
    });
  }, []);

  useEffect(() => {
    void loadCurrent().catch((err) => {
      setMessage(err instanceof Error ? err.message : 'Gagal memuat status academy.');
    });
  }, [loadCurrent]);

  const questionSetId = current?.questionSet?.setId ?? null;
  const questionCount = current?.questionSet?.questions.length ?? 0;

  useEffect(() => {
    if (!questionSetId || questionCount <= 0) return;
    setAnswers(new Array(questionCount).fill(1));
  }, [questionCount, questionSetId]);

  useEffect(() => {
    const certs = current?.inventoryCertificates ?? [];
    if (certs.length === 0) {
      setSelectedCertificateId(null);
      return;
    }
    if (selectedCertificateId && certs.some((item) => item.id === selectedCertificateId)) return;
    setSelectedCertificateId(certs[0]?.id ?? null);
  }, [current?.inventoryCertificates, selectedCertificateId]);

  useEffect(() => {
    if (!current) return;
    const hintedInterval =
      typeof current.state.performance?.pollingHintMs === 'number'
        ? Math.max(3_000, Math.min(30_000, current.state.performance.pollingHintMs))
        : current.academyLockActive
          ? 5_000
          : 15_000;
    const interval = window.setInterval(() => {
      void loadCurrent().catch((err: unknown) => {
        setMessage(resolveAcademyErrorMessage(err, 'Gagal sinkron academy state.'));
      });
    }, hintedInterval);
    return () => window.clearInterval(interval);
  }, [current, loadCurrent]);

  const startBatch = async () => {
    setBusy('start');
    setMessage(null);
    try {
      const response = await api.v5AcademyBatchStart({ track, tier });
      setAnnouncementOpen(false);
      announcedBatchRef.current = null;
      const totalDays = response.state.academyBatch?.totalDays ?? (tier === 3 ? 6 : tier === 2 ? 5 : 4);
      setMessage(`Batch dimulai: ${response.batchId}. Selesaikan ${totalDays} hari academy sesuai tier tanpa keluar jalur.`);
      await loadCurrent();
    } catch (err) {
      setMessage(resolveAcademyErrorMessage(err, 'Gagal memulai academy batch.'));
    } finally {
      setBusy(null);
    }
  };

  const submitDay = async () => {
    setBusy('submit');
    setMessage(null);
    try {
      const response = await api.v5AcademyBatchSubmitDay({ answers });
      if (response.graduated && response.graduation) {
        setMessage(`Day ${response.academyDay} tersubmit. ${response.graduation.message}`);
      } else {
        setMessage(`Day ${response.academyDay} tersubmit. Score hari ini: ${response.dayScore}.`);
      }
      await loadCurrent();
    } catch (err) {
      setMessage(resolveAcademyErrorMessage(err, 'Gagal submit hari academy.'));
    } finally {
      setBusy(null);
    }
  };

  const graduate = async () => {
    setBusy('graduate');
    setMessage(null);
    try {
      const response = await api.v5AcademyBatchGraduate();
      setMessage(response.message);
      await loadCurrent();
    } catch (err) {
      setMessage(resolveAcademyErrorMessage(err, 'Graduation gagal diproses.'));
    } finally {
      setBusy(null);
    }
  };

  const batch = current?.academyBatch ?? null;
  const activeBatch = batch && batch.status === 'ACTIVE' ? batch : null;
  const worldCurrentDay = current?.worldCurrentDay ?? null;
  const lockActive = Boolean(current?.academyLockActive);
  const canSubmit = Boolean(activeBatch && activeBatch.canSubmitToday && current?.questionSet);
  const canGraduate = Boolean(
    activeBatch &&
      activeBatch.playerDayProgress >= activeBatch.totalDays &&
      (worldCurrentDay === null || worldCurrentDay >= activeBatch.endDay)
  );

  useEffect(() => {
    const previousStatus = previousBatchStatusRef.current;
    previousBatchStatusRef.current = batch?.status ?? null;

    if (!batch?.graduation) return;
    if (batch.status !== 'GRADUATED' && batch.status !== 'FAILED') return;
    const justCompleted = previousStatus === 'ACTIVE' && (batch.status === 'GRADUATED' || batch.status === 'FAILED');
    if (!justCompleted) return;
    if (announcedBatchRef.current === batch.batchId) return;

    announcedBatchRef.current = batch.batchId;
    try {
      if (window.sessionStorage.getItem(graduationAnnouncementStorageKey(batch.batchId)) === '1') return;
    } catch {
      // Ignore storage access errors (private mode/blocked storage).
    }
    setAnnouncementOpen(true);
  }, [batch?.batchId, batch?.graduation, batch?.status]);

  const closeAnnouncement = useCallback(() => {
    if (batch?.batchId) {
      try {
        window.sessionStorage.setItem(graduationAnnouncementStorageKey(batch.batchId), '1');
      } catch {
        // Ignore storage access errors (private mode/blocked storage).
      }
    }
    setAnnouncementOpen(false);
  }, [batch?.batchId]);

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Military Academy Expansion v5.1</p>
        <h1 className="text-lg font-semibold text-text">Academy Tier Program (4/5/6 Hari)</h1>
        <p className="text-xs text-muted">Mode lock aktif selama batch berjalan. Progress tersimpan otomatis dan dapat dilanjutkan setelah refresh/disconnect.</p>
        {current?.playerDisplayName ? (
          <p className="mt-1 text-xs text-muted">Nama pendidikan aktif: <span className="text-text">{current.playerDisplayName}</span></p>
        ) : null}
        <div className="mt-2 flex gap-2">
          {lockActive ? (
            <span className="rounded border border-accent/70 bg-accent/15 px-2 py-1 text-xs text-text">Academy Lock Active</span>
          ) : (
            <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Back Dashboard</Link>
          )}
          {!lockActive ? (
            <Link href="/dashboard/recruitment" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Go Recruitment</Link>
          ) : (
            <span className="rounded border border-border/70 bg-bg px-3 py-1 text-xs text-muted">Navigation locked until graduation</span>
          )}
        </div>
      </div>

      {!activeBatch ? (
        <div className="cyber-panel p-3 space-y-3 text-xs">
          <p className="text-muted">
            {batch
              ? `Batch terakhir (${batch.batchId}) sudah ${batch.status}. Anda bisa lanjut batch baru untuk tier lebih tinggi atau sertifikasi tambahan.`
              : 'Belum ada batch aktif. Mulai batch academy untuk membuka jalur rekrutmen kompetitif.'}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-muted">Track
              <select value={track} onChange={(e) => setTrack(e.target.value as typeof track)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text">
                {TRACK_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-muted">Tier
              <select value={tier} onChange={(e) => setTier(Number(e.target.value) === 3 ? 3 : Number(e.target.value) === 2 ? 2 : 1)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text">
                <option value={1}>Tier 1</option>
                <option value={2}>Tier 2</option>
                <option value={3}>Tier 3</option>
              </select>
            </label>
          </div>
          <button disabled={busy !== null} onClick={() => void startBatch()} className="rounded border border-accent bg-accent/20 px-3 py-1 text-text disabled:opacity-60">
            {busy === 'start' ? 'Starting...' : 'Start Academy Batch'}
          </button>
        </div>
      ) : (
        <>
          <div className="cyber-panel p-3 text-xs space-y-2">
            <p className="text-muted">Batch: <span className="text-text">{activeBatch.batchId}</span></p>
            <p className="text-muted">Track/Tier: <span className="text-text">{activeBatch.track} / {activeBatch.tier}</span> | Status: <span className="text-text">{activeBatch.status}</span></p>
            <p className="text-muted">
              Progress player: <span className="text-text">{activeBatch.playerDayProgress}/{activeBatch.totalDays}</span> | Expected world day: <span className="text-text">{activeBatch.expectedWorldDay}</span> | Current world day: <span className="text-text">{worldCurrentDay ?? '-'}</span>
            </p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {Array.from({ length: activeBatch.totalDays }, (_, idx) => {
                const day = idx + 1;
                const completed = day <= activeBatch.playerDayProgress;
                const currentDay = day === activeBatch.playerDayProgress + 1 && activeBatch.status === 'ACTIVE';
                return (
                  <div key={day} className={`rounded border px-2 py-1 ${completed ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-100' : currentDay ? 'border-accent/70 bg-accent/10 text-text' : 'border-border/60 bg-bg/60 text-muted'}`}>
                    <p className="text-[10px] uppercase tracking-[0.06em]">Day {day}</p>
                    <p className="text-[10px]">{completed ? 'Completed' : currentDay ? 'Current' : 'Locked'}</p>
                  </div>
                );
              })}
            </div>
            {current?.questionSet ? (
              <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Daily Assessment - {current.questionSet.setId}</p>
                {current.questionSet.questions.map((question, qIdx) => (
                  <div key={question.id} className="rounded border border-border/50 bg-bg/70 p-2">
                    <p className="text-text">{qIdx + 1}. {question.prompt}</p>
                    <div className="mt-1 space-y-1">
                      {question.choices.map((choice, idx) => (
                        <label key={`${question.id}-${idx}`} className="flex items-center gap-2 text-muted">
                          <input
                            type="radio"
                            name={question.id}
                            value={idx + 1}
                            checked={answers[qIdx] === idx + 1}
                            onChange={(e) => {
                              const selected = Number(e.target.value);
                              setAnswers((prev) => {
                                const next = [...prev];
                                next[qIdx] = selected;
                                return next;
                              });
                            }}
                          />
                          <span>{choice}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-2">
              <div className="flex gap-2">
                <button disabled={!canSubmit || busy !== null || !current?.questionSet} onClick={() => void submitDay()} className="rounded border border-accent bg-accent/20 px-3 py-1 text-text disabled:opacity-60">
                  {busy === 'submit' ? 'Submitting...' : 'Submit Day Assessment'}
                </button>
                <button disabled={!canGraduate || busy !== null} onClick={() => void graduate()} className="rounded border border-border bg-bg px-3 py-1 text-text disabled:opacity-60">
                  {busy === 'graduate' ? 'Graduating...' : 'Run Graduation'}
                </button>
              </div>
              {!activeBatch.canSubmitToday && activeBatch.playerDayProgress < activeBatch.totalDays ? (
                <p className="text-[11px] text-muted">
                  Submit day berikutnya dibuka saat world day mencapai <span className="text-text">{activeBatch.expectedWorldDay}</span>.
                </p>
              ) : null}
              {activeBatch.playerDayProgress >= activeBatch.totalDays && worldCurrentDay !== null && worldCurrentDay < activeBatch.endDay ? (
                <p className="text-[11px] text-muted">
                  Graduation baru tersedia saat world day mencapai <span className="text-text">{activeBatch.endDay}</span>.
                </p>
              ) : null}
            </div>
          </div>

          <div className="cyber-panel p-3 text-xs">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Graduation Board - Top 10</p>
            <div className="mt-2 space-y-1">
              {activeBatch.standingsTop10.length === 0 ? (
                <p className="text-muted">Belum ada ranking batch.</p>
              ) : (
                activeBatch.standingsTop10.map((entry) => (
                  <div key={`${entry.holderType}-${entry.npcId ?? entry.name}`} className="rounded border border-border/50 bg-bg/70 px-2 py-1">
                    <span className="text-text">#{entry.rankPosition} {entry.name}</span> | score {entry.finalScore} | day {entry.dayProgress}/{activeBatch.totalDays}
                  </div>
                ))
              )}
              {activeBatch.playerStanding ? (
                <p className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-text">
                  Posisi pemain: #{activeBatch.playerStanding.rankPosition} | score {activeBatch.playerStanding.finalScore}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}

      {batch && batch.status !== 'ACTIVE' && batch.graduation ? (
        <div className={`cyber-panel p-3 text-xs ${batch.graduation.passed ? 'border-emerald-400/60' : 'border-danger/60'}`}>
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Hasil Batch Terakhir</p>
          <p className="text-text">Graduation: {batch.graduation.passed ? 'LULUS' : 'BELUM LULUS'} | Rank #{batch.graduation.playerRank}/{batch.graduation.totalCadets}</p>
          <p className="text-muted">{batch.graduation.message}</p>
          {batch.graduation.certificateCodes.length > 0 ? (
            <p className="text-muted">Certificate Codes: <span className="text-text">{batch.graduation.certificateCodes.join(' | ')}</span></p>
          ) : null}
        </div>
      ) : null}

      <div className="cyber-panel p-3 text-xs space-y-2">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Inventory Sertifikat Visual</p>
        {(current?.inventoryCertificates.length ?? 0) === 0 ? (
          <p className="text-muted">Belum ada diploma/sertifikasi tersimpan.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {(current?.inventoryCertificates ?? []).map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedCertificateId(item.id)}
                className={`rounded border px-2 py-1 text-left ${selectedCertificateId === item.id ? 'border-accent bg-accent/10' : 'border-border/60 bg-bg/70'}`}
              >
                <p className="text-text">{item.academyName}</p>
                <p className="text-muted">Tier {item.tier} · Grade {item.grade} · Day {item.issuedAtDay}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCertificateId ? (
        <div className="cyber-panel p-3">
          {(() => {
            const cert = (current?.inventoryCertificates ?? []).find((item) => item.id === selectedCertificateId);
            if (!cert) return <p className="text-xs text-muted">Certificate tidak ditemukan.</p>;
            return (
              <div className="rounded-md border-2 border-amber-300/70 bg-gradient-to-br from-amber-50 via-[#f8f0d6] to-amber-100 p-4 text-xs text-[#2f2412] shadow-panel">
                <p className="text-center text-[11px] uppercase tracking-[0.16em]">Military Academy Certificate Archive</p>
                <h2 className="mt-2 text-center text-lg font-semibold">{cert.academyName}</h2>
                <p className="mt-2 text-center">Status: VALID (Inventory V5)</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <p><span className="font-semibold">Tier:</span> {cert.tier}</p>
                  <p><span className="font-semibold">Grade:</span> {cert.grade}</p>
                  <p><span className="font-semibold">Score:</span> {cert.score}</p>
                  <p><span className="font-semibold">Issued Day:</span> {cert.issuedAtDay}</p>
                  <p><span className="font-semibold">Freedom:</span> {cert.divisionFreedomLevel}</p>
                  <p><span className="font-semibold">Division:</span> {cert.assignedDivision}</p>
                </div>
                <p className="mt-3 italic">{cert.message}</p>
                <div className="mt-3 flex items-end justify-between">
                  <p>Authorized Signature</p>
                  <p className="font-semibold">{cert.trainerName}</p>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}

      {announcementOpen && batch?.graduation ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-xl rounded border p-4 shadow-panel ${batch.graduation.passed ? 'border-emerald-400/70 bg-panel' : 'border-danger/70 bg-panel'}`}>
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Academy Graduation Announcement</p>
            <h2 className="mt-1 text-lg font-semibold text-text">
              {batch.graduation.passed ? 'Graduation LULUS' : 'Graduation BELUM LULUS'}
            </h2>
            <p className="mt-2 text-sm text-muted">{batch.graduation.message}</p>
            <p className="mt-2 text-sm text-muted">
              Rank akhir: <span className="text-text">#{batch.graduation.playerRank}</span> dari <span className="text-text">{batch.graduation.totalCadets}</span> kadet.
            </p>
            {batch.graduation.certificateCodes.length > 0 ? (
              <p className="mt-2 text-sm text-muted">Certificate: <span className="text-text">{batch.graduation.certificateCodes.join(' | ')}</span></p>
            ) : null}
            <div className="mt-4 flex gap-2">
              {batch.graduation.passed ? (
                <Link href="/dashboard/recruitment" onClick={closeAnnouncement} className="rounded border border-accent bg-accent/20 px-3 py-1 text-sm text-text">
                  Lanjut Recruitment
                </Link>
              ) : (
                <Link href="/dashboard" onClick={closeAnnouncement} className="rounded border border-border bg-bg px-3 py-1 text-sm text-text">
                  Kembali Dashboard
                </Link>
              )}
              <button onClick={closeAnnouncement} className="rounded border border-border bg-bg px-3 py-1 text-sm text-text">
                Tutup Announcement
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {message ? <div className="rounded border border-border bg-panel px-3 py-2 text-xs text-muted">{message}</div> : null}
    </div>
  );
}

export default function AcademyPage() {
  return (
    <Suspense fallback={<div className="rounded-md border border-border bg-panel p-4 text-sm text-muted">Loading academy console...</div>}>
      <AcademyPageContent />
    </Suspense>
  );
}
