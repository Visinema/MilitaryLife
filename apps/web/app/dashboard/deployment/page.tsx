'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

const PLANNING_CHECKLIST = [
  'Drone recon sector awal',
  'Medic support standby',
  'Reserve unit untuk fallback',
  'Komunikasi anti-jam check'
];

const STRATEGY_OPTIONS = [
  { id: 'layered-security', label: 'Layered Security' },
  { id: 'wedge-spearhead', label: 'Wedge Spearhead' },
  { id: 'escort-defensive', label: 'Escort Defensive' }
];

function DeploymentPageContent() {
  const searchParams = useSearchParams();
  const fromMissionCall = searchParams.get('missionCall') === '1';
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);

  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [missionRespondBusy, setMissionRespondBusy] = useState(false);
  const [strategy, setStrategy] = useState(STRATEGY_OPTIONS[0]?.id ?? 'layered-security');
  const [objective, setObjective] = useState('Amankan area dan selesaikan objective utama dengan casualty minimal.');
  const [prepChecklist, setPrepChecklist] = useState<string[]>([]);

  useEffect(() => {
    if (snapshot) return;
    void api.snapshot().then((response) => setSnapshot(response.snapshot));
  }, [setSnapshot, snapshot]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let active = true;
    let syncing = false;

    const syncSnapshot = () => {
      if (!active || syncing) return;
      if (document.visibilityState !== 'visible') return;
      syncing = true;
      api
        .snapshot()
        .then((response) => {
          if (!active) return;
          setSnapshot(response.snapshot);
        })
        .finally(() => {
          syncing = false;
        });
    };

    syncSnapshot();
    const timer = window.setInterval(syncSnapshot, 3000);
    window.addEventListener('focus', syncSnapshot);
    window.addEventListener('visibilitychange', syncSnapshot);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', syncSnapshot);
      window.removeEventListener('visibilitychange', syncSnapshot);
    };
  }, [setSnapshot]);

  const activeMission = snapshot?.activeMission ?? null;
  const missionPlanningMode = Boolean(activeMission && activeMission.status === 'ACTIVE' && activeMission.playerParticipates);

  useEffect(() => {
    if (!activeMission?.plan) return;
    setStrategy(activeMission.plan.strategy || STRATEGY_OPTIONS[0]?.id || 'layered-security');
    setObjective(activeMission.plan.objective || '');
    setPrepChecklist(Array.isArray(activeMission.plan.prepChecklist) ? activeMission.plan.prepChecklist : []);
  }, [activeMission?.missionId]);

  const squadMembers = useMemo(
    () => (activeMission?.participants ?? []).map((item) => `${item.name}${item.role === 'PLAYER' ? ' (Anda)' : ''}`),
    [activeMission?.participants]
  );

  const toggleChecklist = (item: string) => {
    setPrepChecklist((prev) => {
      if (prev.includes(item)) return prev.filter((value) => value !== item);
      if (prev.length >= 4) return prev;
      return [...prev, item];
    });
  };

  const savePlan = async () => {
    if (!missionPlanningMode) return;
    setPlanSaving(true);
    setMessage(null);
    try {
      const response = await api.missionPlan({ strategy, objective, prepChecklist });
      setSnapshot(response.snapshot);
      setMessage('Rencana misi tersimpan. Data squad + planning akan disimpan sampai upacara berikutnya, lalu otomatis dibersihkan setelah upacara selesai.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal simpan rencana misi');
    } finally {
      setPlanSaving(false);
    }
  };

  const executeActiveMission = async () => {
    if (!activeMission) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.v3Mission({
        missionType: activeMission.missionType,
        dangerTier: activeMission.dangerTier,
        playerParticipates: true
      });
      setSnapshot(response.snapshot);
      setMessage('Misi aktif selesai dijalankan. Laporan misi akan tetap terlihat untuk kebutuhan upacara sampai upacara diselesaikan.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal menjalankan misi aktif');
    } finally {
      setBusy(false);
    }
  };

  const respondMissionCall = async (participate: boolean) => {
    if (missionRespondBusy) return;
    setMissionRespondBusy(true);
    setMessage(null);
    try {
      const response = await api.respondMissionCall(participate);
      setSnapshot(response.snapshot);
      if (participate) {
        setMessage('Panggilan misi diterima. Susun planning lalu eksekusi dari halaman ini.');
      } else {
        setMessage('Misi dijalankan otomatis oleh NPC. Anda bisa kembali ke dashboard.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal merespons panggilan misi');
    } finally {
      setMissionRespondBusy(false);
    }
  };

  if (!snapshot) {
    return <div className="rounded-md border border-border bg-panel p-4 text-sm text-muted">Loading deployment console...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2.5 shadow-panel">
        <h1 className="text-lg font-semibold">Mission Deployment</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      {fromMissionCall ? (
        <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-xs text-amber-100">
          Anda masuk lewat panggilan misi otomatis. Selesaikan perencanaan lalu eksekusi misi.
        </div>
      ) : null}

      {activeMission?.status === 'ACTIVE' && !activeMission.playerParticipates ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-md border border-amber-400/70 bg-panel p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.12em] text-amber-200">Panggilan Misi Otomatis · Day {activeMission.issuedDay}</p>
            <h2 className="mt-1 text-base font-semibold text-amber-100">Ikut misi atau serahkan ke NPC?</h2>
            <p className="mt-2 text-sm text-muted">Waktu game tetap pause sampai Anda memilih. Jika ikut, planning akan dibuka di halaman ini.</p>
            <p className="mt-2 text-xs text-amber-100/90">Mission: {activeMission.missionType} · Danger: {activeMission.dangerTier}</p>
            <div className="mt-4 flex gap-2">
                <button
                  onClick={() => void respondMissionCall(true)}
                  disabled={missionRespondBusy}
                  className="rounded border border-amber-200/60 bg-amber-200/20 px-3 py-1.5 text-sm text-amber-50 disabled:opacity-50"
                >
                  {missionRespondBusy ? 'Memproses...' : 'Ikut misi'}
                </button>
                <button
                  onClick={() => void respondMissionCall(false)}
                  disabled={missionRespondBusy}
                  className="rounded border border-border bg-bg px-3 py-1.5 text-sm text-text disabled:opacity-50"
                >
                  {missionRespondBusy ? 'Memproses...' : 'Jalankan NPC'}
                </button>
              </div>
            </div>
        </div>
      ) : null}

      {missionPlanningMode && activeMission ? (
        <>
          <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Active Mission</p>
            <h2 className="mt-1 text-base font-semibold text-text">
              {activeMission.missionType} · {activeMission.dangerTier}
            </h2>
            <p className="mt-1 text-xs text-muted">Issued Day {activeMission.issuedDay} · Status {activeMission.status}</p>
          </div>

          <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
            <h3 className="text-sm font-semibold text-text">Perencanaan Misi</h3>
            <p className="mt-1 text-xs text-muted">Rencana ini disimpan di server dan dipakai sebagai briefing resmi squad hingga upacara berikutnya.</p>

            <label className="mt-3 block text-xs text-muted">Strategi Utama</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text">
              {STRATEGY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>

            <label className="mt-3 block text-xs text-muted">Objective / Command Note</label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="mt-1 min-h-[88px] w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text"
              placeholder="Tuliskan objective utama operasi"
            />

            <p className="mt-3 text-xs text-muted">Checklist Persiapan (maks 4)</p>
            <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
              {PLANNING_CHECKLIST.map((item) => (
                <label key={item} className="rounded border border-border bg-bg px-2 py-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={prepChecklist.includes(item)}
                    onChange={() => toggleChecklist(item)}
                    className="mr-2"
                  />
                  {item}
                </label>
              ))}
            </div>

            <button
              onClick={() => void savePlan()}
              disabled={planSaving}
              className="mt-3 rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {planSaving ? 'Menyimpan...' : 'Simpan Perencanaan'}
            </button>
          </div>

          <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
            <h3 className="text-sm font-semibold text-text">Anggota Squad Tergabung</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {squadMembers.map((name) => (
                <li key={name} className="rounded border border-border bg-bg px-2 py-1">{name}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Data anggota squad disimpan untuk evaluasi upacara mendatang, lalu dibersihkan otomatis setelah upacara selesai untuk menghemat performa.
            </p>

            <button
              onClick={() => void executeActiveMission()}
              disabled={busy}
              className="mt-3 rounded border border-emerald-500/70 bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-100 disabled:opacity-60"
            >
              {busy ? 'Menjalankan misi...' : 'Eksekusi Misi Sekarang'}
            </button>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-border bg-panel p-4 shadow-panel text-sm text-muted">
          Tidak ada misi aktif yang perlu dieksekusi dari panggilan misi otomatis saat ini.
          <p className="mt-2">Silakan tunggu panggilan misi 10 harian berikutnya dari Dashboard.</p>
        </div>
      )}

      {message ? <p className="rounded border border-border bg-panel px-3 py-2 text-sm text-muted">{message}</p> : null}
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
