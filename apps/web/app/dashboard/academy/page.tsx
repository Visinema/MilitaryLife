'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AcademyBatchState, ExpansionStateV51 } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

type AcademyQuestionSet = {
  setId: string;
  questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }>;
};

type AcademyCurrentPayload = {
  academyLockActive: boolean;
  academyBatch: AcademyBatchState | null;
  questionSet: AcademyQuestionSet | null;
  state: ExpansionStateV51;
};

const TRACK_OPTIONS: Array<{ value: 'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'; label: string }> = [
  { value: 'OFFICER', label: 'Officer' },
  { value: 'HIGH_COMMAND', label: 'High Command' },
  { value: 'SPECIALIST', label: 'Specialist' },
  { value: 'TRIBUNAL', label: 'Tribunal' },
  { value: 'CYBER', label: 'Cyber' }
];

function AcademyPageContent() {
  const searchParams = useSearchParams();
  const preferredTier = useMemo(() => (searchParams.get('tier') === '2' ? 2 : 1), [searchParams]);

  const [track, setTrack] = useState<'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'>('OFFICER');
  const [tier, setTier] = useState<number>(preferredTier);
  const [busy, setBusy] = useState<'start' | 'submit' | 'graduate' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState<AcademyCurrentPayload | null>(null);
  const [answers, setAnswers] = useState<number[]>([1, 1, 1]);

  const loadCurrent = useCallback(async () => {
    const response = await api.v5AcademyBatchCurrent();
    setCurrent({
      academyLockActive: response.academyLockActive,
      academyBatch: response.academyBatch,
      questionSet: response.questionSet,
      state: response.state
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
    if (!current) return;
    const interval = window.setInterval(() => {
      void loadCurrent().catch(() => null);
    }, current.academyLockActive ? 60_000 : 20_000);
    return () => window.clearInterval(interval);
  }, [current, loadCurrent]);

  const startBatch = async () => {
    setBusy('start');
    setMessage(null);
    try {
      const response = await api.v5AcademyBatchStart({ track, tier });
      setMessage(`Batch dimulai: ${response.batchId}. Selesaikan 8 hari academy tanpa keluar dari jalur.`);
      await loadCurrent();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal memulai academy batch.');
    } finally {
      setBusy(null);
    }
  };

  const submitDay = async () => {
    setBusy('submit');
    setMessage(null);
    try {
      const response = await api.v5AcademyBatchSubmitDay({ answers });
      setMessage(`Day ${response.academyDay} tersubmit. Score hari ini: ${response.dayScore}.`);
      await loadCurrent();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal submit hari academy.');
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
      setMessage(err instanceof Error ? err.message : 'Graduation gagal diproses.');
    } finally {
      setBusy(null);
    }
  };

  const batch = current?.academyBatch ?? null;
  const lockActive = Boolean(current?.academyLockActive);
  const canSubmit = Boolean(batch && batch.status === 'ACTIVE' && batch.canSubmitToday && current?.questionSet);
  const canGraduate = Boolean(batch && batch.status === 'ACTIVE' && batch.playerDayProgress >= batch.totalDays);

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Military Academy Expansion v5.1</p>
        <h1 className="text-lg font-semibold text-text">Academy 8-Day Program</h1>
        <p className="text-xs text-muted">Mode lock aktif selama batch berjalan. Progress tersimpan otomatis dan dapat dilanjutkan setelah refresh/disconnect.</p>
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

      {!batch ? (
        <div className="cyber-panel p-3 space-y-3 text-xs">
          <p className="text-muted">Belum ada batch aktif. Mulai batch academy untuk membuka jalur rekrutmen kompetitif.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-muted">Track
              <select value={track} onChange={(e) => setTrack(e.target.value as typeof track)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text">
                {TRACK_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-muted">Tier
              <select value={tier} onChange={(e) => setTier(Number(e.target.value) === 2 ? 2 : 1)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text">
                <option value={1}>Tier 1</option>
                <option value={2}>Tier 2</option>
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
            <p className="text-muted">Batch: <span className="text-text">{batch.batchId}</span></p>
            <p className="text-muted">Track/Tier: <span className="text-text">{batch.track} / {batch.tier}</span> | Status: <span className="text-text">{batch.status}</span></p>
            <p className="text-muted">Progress player: <span className="text-text">{batch.playerDayProgress}/{batch.totalDays}</span> | Expected world day: <span className="text-text">{batch.expectedWorldDay}</span></p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, idx) => {
                const day = idx + 1;
                const completed = day <= batch.playerDayProgress;
                const currentDay = day === batch.playerDayProgress + 1 && batch.status === 'ACTIVE';
                return (
                  <div key={day} className={`rounded border px-2 py-1 ${completed ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-100' : currentDay ? 'border-accent/70 bg-accent/10 text-text' : 'border-border/60 bg-bg/60 text-muted'}`}>
                    <p className="text-[10px] uppercase tracking-[0.06em]">Day {day}</p>
                    <p className="text-[10px]">{completed ? 'Completed' : currentDay ? 'Current' : 'Locked'}</p>
                  </div>
                );
              })}
            </div>
            {batch.status === 'ACTIVE' && current?.questionSet ? (
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
                <div className="flex gap-2">
                  <button disabled={!canSubmit || busy !== null} onClick={() => void submitDay()} className="rounded border border-accent bg-accent/20 px-3 py-1 text-text disabled:opacity-60">
                    {busy === 'submit' ? 'Submitting...' : 'Submit Day Assessment'}
                  </button>
                  <button disabled={!canGraduate || busy !== null} onClick={() => void graduate()} className="rounded border border-border bg-bg px-3 py-1 text-text disabled:opacity-60">
                    {busy === 'graduate' ? 'Graduating...' : 'Run Graduation'}
                  </button>
                </div>
              </div>
            ) : null}
            {batch.graduation ? (
              <div className={`rounded border p-2 ${batch.graduation.passed ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-danger/60 bg-danger/10'}`}>
                <p className="text-text">Graduation: {batch.graduation.passed ? 'LULUS' : 'BELUM LULUS'} | Rank #{batch.graduation.playerRank}/{batch.graduation.totalCadets}</p>
                <p className="text-muted text-[11px]">{batch.graduation.message}</p>
                {batch.graduation.certificateCodes.length > 0 ? (
                  <p className="text-muted text-[11px]">Certificates: {batch.graduation.certificateCodes.join(' | ')}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="cyber-panel p-3 text-xs">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Graduation Board - Top 10</p>
            <div className="mt-2 space-y-1">
              {batch.standingsTop10.length === 0 ? (
                <p className="text-muted">Belum ada ranking batch.</p>
              ) : (
                batch.standingsTop10.map((entry) => (
                  <div key={`${entry.holderType}-${entry.npcId ?? entry.name}`} className="rounded border border-border/50 bg-bg/70 px-2 py-1">
                    <span className="text-text">#{entry.rankPosition} {entry.name}</span> | score {entry.finalScore} | day {entry.dayProgress}/{batch.totalDays}
                  </div>
                ))
              )}
              {batch.playerStanding ? (
                <p className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-text">
                  Posisi pemain: #{batch.playerStanding.rankPosition} | score {batch.playerStanding.finalScore}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}

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
