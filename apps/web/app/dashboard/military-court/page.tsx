'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function MilitaryCourtPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [message, setMessage] = useState('');

  const pending = useMemo(() => (snapshot?.pendingCourtCases ?? []).filter((item) => item.status !== 'CLOSED'), [snapshot?.pendingCourtCases]);
  const inJudgeDivision = (snapshot?.playerDivision ?? '').toLowerCase().includes('court') || (snapshot?.playerDivision ?? '').toLowerCase().includes('judge');

  const review = async (caseId: string, verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN') => {
    try {
      const res = await api.courtReview({ caseId, verdict });
      setSnapshot(res.snapshot);
      setMessage(`Case ${caseId} diproses: ${verdict}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Gagal proses sidang');
    }
  };

  return (
    <div className="space-y-3">
      <div className="cyber-panel p-3 text-[11px]">
        <h1 className="text-sm font-semibold text-text">Military Court V3</h1>
        <p className="text-muted">Panel Hakim: Judge Chair + 3 Judges · Divisi aktif: <span className="text-text">{snapshot?.playerDivision ?? '-'}</span></p>
        <p className="text-muted">{inJudgeDivision ? 'Anda terdaftar di Divisi Hakim. Tab Pending Sidang aktif.' : 'Gabung Military Judge Corps via rekrutmen untuk akses tugas hakim penuh.'}</p>
        <Link href="/dashboard" className="mt-1 inline-block rounded border border-border bg-bg px-2 py-1 text-text">Back Dashboard</Link>
      </div>

      <div className="cyber-panel max-h-[70vh] space-y-2 overflow-y-auto p-3 text-[11px]">
        {pending.length === 0 ? <p className="text-muted">Tidak ada pending sidang.</p> : null}
        {pending.map((item) => (
          <div key={item.id} className="rounded border border-border/60 bg-bg/70 p-2">
            <p className="font-semibold text-text">{item.title}</p>
            <p className="text-muted">Case: {item.id} · Severity: {item.severity} · Requested by: {item.requestedBy}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <button onClick={() => void review(item.id, 'UPHOLD')} className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-text">Uphold</button>
              <button onClick={() => void review(item.id, 'DISMISS')} className="rounded border border-danger/60 bg-danger/10 px-2 py-0.5 text-danger">Dismiss</button>
              <button onClick={() => void review(item.id, 'REASSIGN')} className="rounded border border-border bg-panel px-2 py-0.5 text-text">Reassign</button>
            </div>
          </div>
        ))}
        {message ? <p className="text-muted">{message}</p> : null}
      </div>
    </div>
  );
}
