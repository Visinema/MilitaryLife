'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CourtCaseV2 } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';
import { resolvePlayerAssignment } from '@/lib/player-assignment';
import { useGameStore } from '@/store/game-store';

export default function MilitaryCourtPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const [cases, setCases] = useState<CourtCaseV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [reassignDraft, setReassignDraft] = useState<Record<string, { division: string; position: string }>>({});

  const assignment = useMemo(() => resolvePlayerAssignment(snapshot), [snapshot]);
  const inJudgeDivision = assignment.division.toLowerCase().includes('court') || assignment.division.toLowerCase().includes('judge');

  const loadCases = async () => {
    setLoading(true);
    try {
      const res = await api.v5CourtCases();
      setCases(res.cases);
      setMessage('');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Gagal memuat daftar sidang V5.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCases();
  }, []);

  const pending = useMemo(() => cases.filter((item) => item.status !== 'CLOSED'), [cases]);

  const review = async (courtCase: CourtCaseV2, verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN') => {
    setBusyCaseId(courtCase.caseId);
    setMessage('');
    try {
      const draft = reassignDraft[courtCase.caseId];
      const res = await api.v5CourtVerdict({
        caseId: courtCase.caseId,
        verdict,
        newDivision: verdict === 'REASSIGN' ? draft?.division?.trim() || undefined : undefined,
        newPosition: verdict === 'REASSIGN' ? draft?.position?.trim() || undefined : undefined
      });
      setCases((prev) => prev.map((item) => (item.caseId === res.case.caseId ? res.case : item)));
      setMessage(`Case ${courtCase.caseId} diproses: ${verdict}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Gagal proses sidang.');
    } finally {
      setBusyCaseId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="cyber-panel p-3 text-[11px]">
        <h1 className="text-sm font-semibold text-text">Military Court V5</h1>
        <p className="text-muted">
          Panel Hakim: Judge Chair + 3 Judges | Divisi aktif: <span className="text-text">{assignment.divisionLabel}</span> | Satuan:{' '}
          <span className="text-text">{assignment.unitLabel}</span> | Jabatan: <span className="text-text">{assignment.positionLabel}</span>
        </p>
        <p className="text-muted">
          {inJudgeDivision
            ? 'Anda terdaftar di Divisi Hakim. Tab Pending Sidang aktif.'
            : 'Gabung Military Judge Corps via rekrutmen untuk akses tugas hakim penuh.'}
        </p>
        <Link href="/dashboard" className="mt-1 inline-block rounded border border-border bg-bg px-2 py-1 text-text">
          Back Dashboard
        </Link>
      </div>

      <div className="cyber-panel max-h-[70vh] space-y-2 overflow-y-auto p-3 text-[11px]">
        {loading ? <p className="text-muted">Memuat daftar sidang...</p> : null}
        {!loading && pending.length === 0 ? <p className="text-muted">Tidak ada pending sidang.</p> : null}
        {pending.map((item) => (
          <div key={item.caseId} className="rounded border border-border/60 bg-bg/70 p-2">
            <p className="font-semibold text-text">
              {item.caseType} | {item.targetType}
            </p>
            <p className="text-muted">
              Case: {item.caseId} | Requested Day: {item.requestedDay} | Status: {item.status}
            </p>

            {item.caseType === 'MUTATION' ? (
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <input
                  value={reassignDraft[item.caseId]?.division ?? ''}
                  onChange={(event) =>
                    setReassignDraft((prev) => ({
                      ...prev,
                      [item.caseId]: {
                        division: event.target.value,
                        position: prev[item.caseId]?.position ?? ''
                      }
                    }))
                  }
                  placeholder="Divisi baru (opsional)"
                  className="rounded border border-border bg-panel px-2 py-1 text-[11px] text-text"
                />
                <input
                  value={reassignDraft[item.caseId]?.position ?? ''}
                  onChange={(event) =>
                    setReassignDraft((prev) => ({
                      ...prev,
                      [item.caseId]: {
                        division: prev[item.caseId]?.division ?? '',
                        position: event.target.value
                      }
                    }))
                  }
                  placeholder="Jabatan baru (opsional)"
                  className="rounded border border-border bg-panel px-2 py-1 text-[11px] text-text"
                />
              </div>
            ) : null}

            <div className="mt-1 flex flex-wrap gap-1">
              <button
                disabled={busyCaseId === item.caseId}
                onClick={() => void review(item, 'UPHOLD')}
                className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-text disabled:opacity-60"
              >
                Uphold
              </button>
              <button
                disabled={busyCaseId === item.caseId}
                onClick={() => void review(item, 'DISMISS')}
                className="rounded border border-danger/60 bg-danger/10 px-2 py-0.5 text-danger disabled:opacity-60"
              >
                Dismiss
              </button>
              <button
                disabled={busyCaseId === item.caseId}
                onClick={() => void review(item, 'REASSIGN')}
                className="rounded border border-border bg-panel px-2 py-0.5 text-text disabled:opacity-60"
              >
                Reassign
              </button>
            </div>
          </div>
        ))}
        {message ? <p className="text-muted">{message}</p> : null}
      </div>
    </div>
  );
}