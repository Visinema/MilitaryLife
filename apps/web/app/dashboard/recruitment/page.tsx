'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import type { ExpansionStateV51 } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

type RecruitmentBoardPayload = {
  division: string | null;
  requirement: { label: 'STANDARD' | 'ADVANCED' | 'ELITE'; minExtraCerts: number };
  playerEligibility: {
    hasBaseDiploma: boolean;
    baseDiplomaCode: string | null;
    baseDiplomaGrade: 'A' | 'B' | 'C' | 'D' | null;
    extraCertCount: number;
    requiredExtraCerts: number;
    missingExtraCerts: number;
    bonusScore: number;
    bonusCap: number;
    eligible: boolean;
  };
  quota: {
    division: string;
    quotaTotal: number;
    quotaUsed: number;
    quotaRemaining: number;
    status: 'OPEN' | 'COOLDOWN';
    cooldownUntilDay: number | null;
    cooldownDays: number;
    decisionNote: string;
    headName: string | null;
  } | null;
  quotaBoard: ExpansionStateV51['quotaBoard'];
  race: ExpansionStateV51['recruitmentRace'];
  questionSet: { setId: string; questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }> } | null;
};

type NoticeState =
  | {
      tone: 'ok' | 'warn' | 'error';
      code: string;
      message: string;
      detail?: string;
    }
  | null;

function normalizeErrorNotice(err: unknown): NoticeState {
  if (err instanceof ApiError) {
    const details = err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : null;
    const code = typeof details?.code === 'string' ? details.code : 'RECRUITMENT_ERROR';
    const message = typeof details?.error === 'string' ? details.error : err.message;
    const detail = details ? JSON.stringify(details) : undefined;
    return { tone: 'error', code, message, detail };
  }
  return { tone: 'error', code: 'RECRUITMENT_ERROR', message: err instanceof Error ? err.message : 'Recruitment apply gagal.' };
}

export default function RecruitmentPage() {
  const router = useRouter();
  const [selectedDivision, setSelectedDivision] = useState<string>(REGISTERED_DIVISIONS[0]?.name ?? 'Special Operations Division');
  const [board, setBoard] = useState<RecruitmentBoardPayload | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<number[]>([1, 1, 1]);

  const loadBoard = useCallback(
    async (division?: string) => {
      const response = await api.v5RecruitmentBoard(division);
      if (response.state.academyLockActive) {
        router.replace('/dashboard/academy?lock=1');
        return;
      }
      setBoard(response.board);
    },
    [router]
  );

  useEffect(() => {
    void loadBoard(selectedDivision).catch((err) => {
      setNotice(normalizeErrorNotice(err));
    });
  }, [loadBoard, selectedDivision]);

  useEffect(() => {
    const count = board?.questionSet?.questions.length ?? 0;
    const setId = board?.questionSet?.setId ?? null;
    if (!setId || count <= 0) return;
    setAnswers(new Array(count).fill(1));
  }, [board?.questionSet?.questions.length, board?.questionSet?.setId]);

  useEffect(() => {
    if (!board) return;
    const intervalMs = board.quota?.status === 'COOLDOWN' ? 10_000 : 15_000;
    const timer = window.setInterval(() => {
      void loadBoard(board.division ?? selectedDivision).catch(() => null);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [board, loadBoard, selectedDivision]);

  const canApply = useMemo(
    () =>
      Boolean(
        board?.division &&
          board?.questionSet &&
          board.playerEligibility.eligible &&
          board.quota &&
          board.quota.status === 'OPEN' &&
          board.quota.quotaRemaining > 0
      ),
    [board]
  );

  const submitApply = async () => {
    if (!board?.division) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await api.v5RecruitmentApply({
        division: board.division,
        answers
      });
      setNotice({
        tone: response.accepted ? 'ok' : 'warn',
        code: response.playerDecision.code,
        message: `${response.message} (Exam ${response.examScore}, Composite ${response.compositeScore})`,
        detail: `Player status: ${response.playerDecision.status}. Accepted slots wave: ${response.acceptedSlots}.`
      });
      await loadBoard(board.division);
    } catch (err) {
      setNotice(normalizeErrorNotice(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Recruitment Expansion v5.1</p>
        <h1 className="text-lg font-semibold text-text">Recruitment Quota Race Board</h1>
        <p className="text-xs text-muted">Syarat wajib: diploma academy + sertifikasi tambahan bertingkat. Bonus extra cert dibatasi agar kompetisi tetap fair.</p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Back Dashboard</Link>
          <Link href="/dashboard/academy" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Go Academy</Link>
        </div>
      </div>

      <div className="cyber-panel p-3 text-xs space-y-3">
        <label className="text-muted">Pilih division target
          <select
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text"
          >
            {REGISTERED_DIVISIONS.map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
            ))}
          </select>
        </label>

        {board ? (
          <>
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Requirement</p>
                <p className="text-muted">Tier: <span className="text-text">{board.requirement.label}</span> | Sertifikasi tambahan minimum: <span className="text-text">{board.requirement.minExtraCerts}</span></p>
                <p className="text-muted">Komposisi nilai: Diploma 45% | Konsistensi 15% | Sertifikasi 25% | Exam 10% | Reputasi 5%</p>
                <p className="text-muted">Bonus extra cert: <span className="text-text">+{board.playerEligibility.bonusScore}</span> (cap +{board.playerEligibility.bonusCap})</p>
              </div>

              <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Eligibility Player</p>
                <p className="text-muted">Diploma: <span className="text-text">{board.playerEligibility.hasBaseDiploma ? 'SIAP' : 'BELUM ADA'}</span></p>
                <p className="text-muted">Base cert: <span className="text-text">{board.playerEligibility.baseDiplomaCode ?? 'N/A'}</span> ({board.playerEligibility.baseDiplomaGrade ?? '-'})</p>
                <p className="text-muted">Extra cert: <span className="text-text">{board.playerEligibility.extraCertCount}/{board.playerEligibility.requiredExtraCerts}</span></p>
                <p className="text-muted">Missing extra cert: <span className="text-text">{board.playerEligibility.missingExtraCerts}</span></p>
                <p className="text-muted">Status apply: <span className="text-text">{board.playerEligibility.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE'}</span></p>
              </div>
            </div>

            <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Selected Division Quota</p>
              {board.quota ? (
                <>
                  <p className="text-muted">Quota: <span className="text-text">{board.quota.quotaRemaining}/{board.quota.quotaTotal}</span> | Status: <span className="text-text">{board.quota.status}</span></p>
                  <p className="text-muted">Head Divisi: <span className="text-text">{board.quota.headName ?? 'System Board'}</span></p>
                  <p className="text-muted">Decision Note: <span className="text-text">{board.quota.decisionNote}</span></p>
                  {board.quota.cooldownUntilDay !== null ? (
                    <p className="text-muted">Cooldown until day: <span className="text-text">{board.quota.cooldownUntilDay}</span></p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted">Quota belum tersedia.</p>
              )}
            </div>

            <div className="rounded border border-border/60 bg-bg/60 p-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Live Quota Board (All Divisions)</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {board.quotaBoard.map((item) => (
                  <p key={item.division} className="rounded border border-border/50 bg-bg/70 px-2 py-1 text-muted">
                    <span className="text-text">{item.division}</span> | {item.quotaRemaining}/{item.quotaTotal} | {item.status}
                  </p>
                ))}
              </div>
            </div>

            {board.questionSet ? (
              <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Recruitment Exam - {board.questionSet.setId}</p>
                {board.questionSet.questions.map((question, qIdx) => (
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
                <button disabled={!canApply || busy} onClick={() => void submitApply()} className="rounded border border-accent bg-accent/20 px-3 py-1 text-text disabled:opacity-60">
                  {busy ? 'Applying...' : 'Submit Recruitment Application'}
                </button>
                {!board.playerEligibility.eligible ? (
                  <p className="text-[11px] text-danger">Apply dikunci: penuhi diploma + sertifikasi tambahan minimum terlebih dahulu.</p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded border border-border/60 bg-bg/60 p-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Competition Preview - Top 10</p>
              <div className="mt-1 space-y-1">
                {board.race.top10.length === 0 ? (
                  <p className="text-muted">Belum ada data kompetisi.</p>
                ) : (
                  board.race.top10.map((entry) => (
                    <p key={`${entry.holderType}-${entry.npcId ?? entry.name}`} className="rounded border border-border/50 bg-bg/70 px-2 py-1 text-muted">
                      <span className="text-text">#{entry.rank} {entry.name}</span> | score {entry.compositeScore} | {entry.status}{entry.reason ? ` | ${entry.reason}` : ''}
                    </p>
                  ))
                )}
                {typeof board.race.playerRank === 'number' ? (
                  <p className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-text">Posisi pemain saat ini: #{board.race.playerRank}</p>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted">Loading recruitment board...</p>
        )}
      </div>

      {notice ? (
        <div className={`rounded border px-3 py-2 text-xs ${notice.tone === 'ok' ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-100' : notice.tone === 'warn' ? 'border-amber-400/70 bg-amber-500/10 text-amber-100' : 'border-danger/70 bg-danger/10 text-danger'}`}>
          <p><span className="font-semibold">[{notice.code}]</span> {notice.message}</p>
          {notice.detail ? <p className="mt-1 text-[11px] opacity-90">{notice.detail}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
