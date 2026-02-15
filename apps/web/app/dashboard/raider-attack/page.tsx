'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function RaiderAttackPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) return;
    api.snapshot().then((res) => setSnapshot(res.snapshot)).catch(() => null);
  }, [setSnapshot, snapshot]);

  const casualties = useMemo(() => snapshot?.raiderCasualties?.slice().reverse().slice(0, 20) ?? [], [snapshot?.raiderCasualties]);

  const startDefense = async () => {
    setBusy(true);
    setNote(null);
    try {
      const response = await api.raiderDefense();
      setSnapshot(response.snapshot);
      const count = Array.isArray(response.details?.casualties) ? response.details.casualties.length : 0;
      setNote(`Raid selesai. Korban personil: ${count}. Dinamika jabatan diperbarui otomatis.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Gagal memproses serangan raider.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Situasi Serangan Raider</p>
        <h1 className="text-lg font-semibold text-text">Base Raid Simulation</h1>
        <p className="text-xs text-muted">Komandan aktif: <span className="text-text">{snapshot?.playerName ?? '-'}</span> · Jabatan: <span className="text-text">{snapshot?.playerPosition ?? '-'}</span></p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Back Dashboard</Link>
          <button onClick={startDefense} disabled={busy} className="rounded border border-danger/70 bg-danger/20 px-3 py-1 text-xs text-danger disabled:opacity-60">
            {busy ? 'Processing...' : 'Trigger Serangan Raider'}
          </button>
        </div>
      </div>

      {note ? <p className="text-sm text-muted">{note}</p> : null}

      <section className="cyber-panel p-3 text-xs">
        <h2 className="text-sm font-semibold text-text">Dampak Serangan ke Personil</h2>
        {casualties.length === 0 ? (
          <p className="text-muted">Belum ada korban tercatat.</p>
        ) : (
          <div className="mt-2 space-y-1">
            {casualties.map((item) => (
              <p key={`${item.slot}-${item.day}`} className="rounded border border-border/60 bg-bg/60 px-2 py-1 text-muted">
                Day {item.day}: {item.npcName} ({item.role}) · {item.division}/{item.unit} · Cause: {item.cause}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
