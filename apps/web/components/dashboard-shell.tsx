'use client';

import dynamic from 'next/dynamic';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, type TravelPlace } from '@/lib/api-client';
import type { CountryCode } from '@mls/shared/constants';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import { BRANCH_OPTIONS, COUNTRY_OPTIONS } from '@/lib/constants';
import { deriveLiveGameDay } from '@/lib/clock';
import { useGameStore } from '@/store/game-store';
import { TopbarTime } from './topbar-time';
import { V2CommandCenter } from './v2-command-center';

const DecisionModal = dynamic(() => import('./decision-modal').then((mod) => mod.DecisionModal), {
  ssr: false
});
const TRAVEL_PLACES: Array<{ place: TravelPlace; label: string }> = [
  { place: 'BASE_HQ', label: 'Base HQ' },
  { place: 'BORDER_OUTPOST', label: 'Border Outpost' },
  { place: 'LOGISTICS_HUB', label: 'Logistics Hub' },
  { place: 'TACTICAL_TOWN', label: 'Tactical Town' }
];

const ACADEMY_QUESTIONS: Array<{ prompt: string; options: string[] }> = [
  {
    prompt: 'Saat operasi gabungan lintas divisi, prioritas komando awal adalah?',
    options: ['Menunggu instruksi akhir', 'Samakan objective dan chain-of-command', 'Langsung eksekusi cepat', 'Fokus logistic dulu']
  },
  {
    prompt: 'Saat moral unit turun drastis, langkah paling efektif adalah?',
    options: ['Tambah jam latihan', 'Kurangi patroli tanpa briefing', 'Leadership briefing + rotasi terukur', 'Tunda semua operasi']
  },
  {
    prompt: 'Indikator readiness terbaik untuk phase tempur adalah?',
    options: ['Gabungan kesehatan, disiplin, dan supply', 'Jumlah personel saja', 'Lamanya dinas', 'Saldo kas']
  },
  {
    prompt: 'Saat informasi intel ambigu, keputusan komandan yang benar?',
    options: ['Abaikan intel', 'Retreat total', 'Pecah unit kecil', 'Verifikasi intel + siapkan fallback plan']
  },
  {
    prompt: 'Untuk operasi urban, distribusi unit paling stabil adalah?',
    options: ['Full assault center', 'Balanced assault-support-reserve', 'Hanya sniper line', 'Reserve penuh tanpa assault']
  }
];

const DIVISION_OPTIONS = REGISTERED_DIVISIONS.map((item) => item.name);

type AcademyOutcome = {
  passed: boolean;
  score: number;
  passThreshold: number;
  message: string;
  certificateId?: string;
};

export function DashboardShell() {
  const router = useRouter();
  const pathname = usePathname();
  const snapshot = useGameStore((state) => state.snapshot);
  const clockOffsetMs = useGameStore((state) => state.clockOffsetMs);
  const loading = useGameStore((state) => state.loading);
  const error = useGameStore((state) => state.error);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setLoading = useGameStore((state) => state.setLoading);
  const setError = useGameStore((state) => state.setError);

  const [noProfile, setNoProfile] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    startAge: 17,
    country: 'US' as CountryCode,
    branch: 'US_ARMY'
  });

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [manualControlBusy, setManualControlBusy] = useState<'pause' | 'continue' | null>(null);
  const [timeScaleBusy, setTimeScaleBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [academyOpen, setAcademyOpen] = useState(false);
  const [academyTierDraft, setAcademyTierDraft] = useState<1 | 2>(1);
  const [academyAnswers, setAcademyAnswers] = useState<number[]>([1, 1, 1, 1, 1]);
  const [divisionDraft, setDivisionDraft] = useState<string>(DIVISION_OPTIONS[0] ?? 'Special Operations Division');
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [openedCertificateId, setOpenedCertificateId] = useState<string | null>(null);
  const [academyOutcome, setAcademyOutcome] = useState<AcademyOutcome | null>(null);
  const [missionCallBusy, setMissionCallBusy] = useState<null | 'YES' | 'NO'>(null);
  const snapshotCooldownUntilRef = useRef(0);
  const hasInitialSnapshotRef = useRef(false);
  const ceremonyRedirectFrameRef = useRef<number | null>(null);
  const lastLiveCeremonyCheckDayRef = useRef<number>(-1);
  const lastLiveMissionCheckDayRef = useRef<number>(-1);
  const snapshotLoadInFlightRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (snapshotLoadInFlightRef.current) {
      return;
    }
    if (Date.now() < snapshotCooldownUntilRef.current) {
      return;
    }

    snapshotLoadInFlightRef.current = true;
    if (!hasInitialSnapshotRef.current) {
      setLoading(true);
    }
    try {
      const response = await api.snapshot();
      setSnapshot(response.snapshot);
      hasInitialSnapshotRef.current = true;
      setNoProfile(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        if (err.status === 404) {
          setNoProfile(true);
          setError(null);
          setLoading(false);
          return;
        }
        if (err.status >= 500 || err.status === 408) {
          snapshotCooldownUntilRef.current = Date.now() + 15_000;
          setError('Server sementara bermasalah (5xx/timeout). Menunggu sebelum sinkronisasi ulang...');
          return;
        }
        setError(err.message);
        return;
      }
      snapshotCooldownUntilRef.current = Date.now() + 15_000;
      setError('Unable to load game snapshot');
    } finally {
      snapshotLoadInFlightRef.current = false;
    }
  }, [router, setError, setLoading, setSnapshot]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (noProfile) return;
    if (!snapshot) return;

    let cancelled = false;
    let timer: number | null = null;

    const schedule = () => {
      if (cancelled) return;
      const intervalMs = snapshot.paused ? 60_000 : 20_000;
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void loadSnapshot();
        }
        schedule();
      }, intervalMs);
    };

    schedule();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadSnapshot();
      }
    };

    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadSnapshot, noProfile, snapshot?.paused]);

  const onCreateProfile = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCreateBusy(true);
      try {
        await api.createProfile({
          name: profileForm.name,
          startAge: profileForm.startAge,
          country: profileForm.country,
          branch: profileForm.branch
        });
        await loadSnapshot();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create profile');
      } finally {
        setCreateBusy(false);
      }
    },
    [loadSnapshot, profileForm, setError]
  );

  const guardPendingDecisionAction = useCallback((actionLabel: string) => {
    if (!snapshot?.pendingDecision) return false;
    setError(`Selesaikan pending decision terlebih dahulu sebelum ${actionLabel}.`);
    router.push('/dashboard/event-frame');
    return true;
  }, [router, setError, snapshot]);


  const runManualPause = useCallback(async () => {
    setManualControlBusy('pause');
    try {
      const response = await api.pause('MODAL');
      setSnapshot(response.snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Manual pause gagal');
    } finally {
      setManualControlBusy(null);
    }
  }, [setError, setSnapshot]);

  const runManualContinue = useCallback(async () => {
    if (!snapshot?.pauseToken) {
      setError('Pause token tidak tersedia. Refresh snapshot lalu coba lagi.');
      return;
    }
    setManualControlBusy('continue');
    try {
      const response = await api.resume(snapshot.pauseToken);
      setSnapshot(response.snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Manual continue gagal');
    } finally {
      setManualControlBusy(null);
    }
  }, [setError, setSnapshot, snapshot?.pauseToken]);



  const toggleTimeScale = useCallback(async () => {
    const nextScale: 1 | 3 = snapshot?.gameTimeScale === 3 ? 1 : 3;
    setTimeScaleBusy(true);
    try {
      const response = await api.setTimeScale(nextScale);
      setSnapshot(response.snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal ubah skala waktu game');
    } finally {
      setTimeScaleBusy(false);
    }
  }, [setError, setSnapshot, snapshot?.gameTimeScale]);

  const runTravel = useCallback(
    async (place: TravelPlace) => {
      if (guardPendingDecisionAction('melakukan travel')) return;
      setActionBusy(place);
      try {
        const response = await api.travel(place);
        setSnapshot(response.snapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Travel failed');
      } finally {
        setActionBusy(null);
      }
    },
    [guardPendingDecisionAction, setError, setSnapshot]
  );

  const runMilitaryAcademy = useCallback(async () => {
    if (snapshot?.pendingDecision) {
      setError('Selesaikan pending decision terlebih dahulu sebelum masuk Military Academy.');
      setAcademyOpen(false);
      router.push('/dashboard/event-frame');
      return;
    }

    const key = academyTierDraft === 2 ? 'ACADEMY_T2' : 'ACADEMY_T1';
    setActionBusy(key);
    try {
      const response = await api.militaryAcademy({
        tier: academyTierDraft,
        answers: academyAnswers,
        preferredDivision: divisionDraft
      });
      setSnapshot(response.snapshot);
      setAcademyOpen(false);

      const details = (response.details ?? {}) as {
        passed?: boolean;
        score?: number;
        passThreshold?: number;
        message?: string;
        certificate?: { id?: string };
      };
      const passed = Boolean(details.passed);
      const score = Number(details.score ?? 0);
      const passThreshold = Number(details.passThreshold ?? (academyTierDraft === 2 ? 80 : 60));
      setAcademyOutcome({
        passed,
        score,
        passThreshold,
        message: details.message ?? (passed ? 'Selamat, Anda lulus Military Academy.' : 'Anda belum lulus Military Academy.'),
        certificateId: details.certificate?.id
      });

      if (details.certificate?.id) {
        setInventoryOpen(true);
        setOpenedCertificateId(details.certificate.id);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Aksi academy bentrok dengan pending decision. Buka Event Frame untuk menyelesaikan decision.');
        router.push('/dashboard/event-frame');
      } else {
        setError(err instanceof Error ? err.message : 'Military academy action failed');
      }
    } finally {
      setActionBusy(null);
    }
  }, [academyAnswers, academyTierDraft, divisionDraft, router, setError, setSnapshot, snapshot]);


  const runCareerReview = useCallback(async () => {
    if (guardPendingDecisionAction('melakukan career review')) return;
    setActionBusy('CAREER_REVIEW');
    try {
      const response = await api.careerReview();
      setSnapshot(response.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Career review failed');
    } finally {
      setActionBusy(null);
    }
  }, [guardPendingDecisionAction, setError, setSnapshot]);

  const restartWorld = useCallback(async () => {
    if (!confirm('Restart world from day 0? This will reset progression.')) return;

    setResetBusy(true);
    try {
      const response = await api.restartWorld();
      setSnapshot(response.snapshot);
      setError(null);
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart world');
    } finally {
      setResetBusy(false);
    }
  }, [setError, setSnapshot]);

  const branchOptions = useMemo(() => BRANCH_OPTIONS[profileForm.country], [profileForm.country]);
  const [pageReady, setPageReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.readyState === 'complete') {
      setPageReady(true);
      return;
    }

    const onLoad = () => setPageReady(true);
    window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);


  useEffect(() => {
    if (!snapshot) return;
    if (!pageReady) return;
    if (typeof window === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    let checkingBoundary = false;

    const tick = () => {
      const liveDay = deriveLiveGameDay(snapshot, clockOffsetMs);
      if (liveDay === lastLiveCeremonyCheckDayRef.current) return;
      lastLiveCeremonyCheckDayRef.current = liveDay;

      if (liveDay < 15 || liveDay % 15 !== 0) return;
      if (checkingBoundary) return;
      checkingBoundary = true;

      api
        .snapshot()
        .then((response) => {
          setSnapshot(response.snapshot);
          if (!response.snapshot.ceremonyDue) return;
          if (pathname.startsWith('/dashboard/ceremony')) return;
          const ceremonyCycleDay = response.snapshot.gameDay < 15
            ? 15
            : response.snapshot.gameDay - (response.snapshot.gameDay % 15);
          ceremonyRedirectFrameRef.current = window.requestAnimationFrame(() => {
            router.replace(`/dashboard/ceremony?forced=1&cycleDay=${ceremonyCycleDay}&boundary=1`);
          });
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Gagal sinkronisasi boundary upacara');
        })
        .finally(() => {
          checkingBoundary = false;
        });
    };

    tick();
    const timer = window.setInterval(tick, 900);
    return () => {
      window.clearInterval(timer);
    };
  }, [clockOffsetMs, pageReady, pathname, router, setError, setSnapshot, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    if (!pageReady) return;
    if (typeof window === 'undefined') return;

    let checkingMissionBoundary = false;

    const tickMission = () => {
      const liveDay = deriveLiveGameDay(snapshot, clockOffsetMs);
      if (liveDay === lastLiveMissionCheckDayRef.current) return;
      lastLiveMissionCheckDayRef.current = liveDay;

      if (liveDay < 10 || liveDay % 10 !== 0) return;
      if (checkingMissionBoundary) return;
      checkingMissionBoundary = true;

      api
        .snapshot()
        .then((response) => {
          setSnapshot(response.snapshot);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Gagal sinkronisasi boundary mission call');
        })
        .finally(() => {
          checkingMissionBoundary = false;
        });
    };

    tickMission();
    const timer = window.setInterval(tickMission, snapshot.gameTimeScale === 3 ? 450 : 900);
    return () => {
      window.clearInterval(timer);
    };
  }, [clockOffsetMs, pageReady, setError, setSnapshot, snapshot]);


  useEffect(() => {
    if (!snapshot?.ceremonyDue) return;
    if (!pageReady) return;
    if (typeof window === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    if (pathname.startsWith('/dashboard/ceremony')) return;
    const ceremonyCycleDay = snapshot.gameDay < 15 ? 15 : snapshot.gameDay - (snapshot.gameDay % 15);
    ceremonyRedirectFrameRef.current = window.requestAnimationFrame(() => {
      router.replace(`/dashboard/ceremony?forced=1&cycleDay=${ceremonyCycleDay}`);
    });

    return () => {
      if (ceremonyRedirectFrameRef.current !== null) {
        window.cancelAnimationFrame(ceremonyRedirectFrameRef.current);
        ceremonyRedirectFrameRef.current = null;
      }
    };
  }, [pageReady, pathname, router, snapshot?.ceremonyDue, snapshot?.gameDay]);

  const respondMissionCall = useCallback(async (participate: boolean) => {
    setMissionCallBusy(participate ? 'YES' : 'NO');
    try {
      const response = await api.respondMissionCall(participate);
      setSnapshot(response.snapshot);
      setError(null);
      if (participate) {
        router.push('/dashboard/deployment?missionCall=1');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal merespons panggilan misi');
    } finally {
      setMissionCallBusy(null);
    }
  }, [router, setError, setSnapshot]);

  const safeCertificates = useMemo(() => (Array.isArray(snapshot?.certificates) ? snapshot.certificates : []), [snapshot]);

  useEffect(() => {
    if (!openedCertificateId) return;
    if (safeCertificates.some((item) => item.id === openedCertificateId)) return;
    setOpenedCertificateId(safeCertificates[0]?.id ?? null);
  }, [openedCertificateId, safeCertificates]);

  if (loading && !snapshot && !noProfile) {
    return <div className="rounded-md border border-border bg-panel p-6 text-sm text-muted">Loading game data...</div>;
  }

  if (noProfile) {
    return (
      <div className="mx-auto max-w-xl rounded-md border border-border bg-panel p-6 shadow-panel">
        <h2 className="text-xl font-semibold text-text">Create Your Military Profile</h2>
        <p className="mt-2 text-sm text-muted">Set up your profile to start the simulation.</p>

        <form className="mt-5 space-y-4" onSubmit={onCreateProfile}>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted">Name</label>
            <input
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
              value={profileForm.name}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted">Starting Age</label>
            <input
              type="number"
              min={15}
              max={40}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
              value={profileForm.startAge}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, startAge: Number(e.target.value) }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted">Country</label>
            <select
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
              value={profileForm.country}
              onChange={(e) => {
                const country = e.target.value as CountryCode;
                setProfileForm((prev) => ({
                  ...prev,
                  country,
                  branch: BRANCH_OPTIONS[country][0].value
                }));
              }}
            >
              {COUNTRY_OPTIONS.map((country) => (
                <option key={country.value} value={country.value}>
                  {country.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted">Branch</label>
            <select
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
              value={profileForm.branch}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, branch: e.target.value }))}
            >
              {branchOptions.map((branch) => (
                <option key={branch.value} value={branch.value}>
                  {branch.label}
                </option>
              ))}
            </select>
          </div>

          <button
            disabled={createBusy}
            className="w-full rounded border border-accent bg-accent/20 px-4 py-2 text-sm font-medium text-text disabled:opacity-70"
          >
            {createBusy ? 'Creating...' : 'Create Profile'}
          </button>
        </form>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>
    );
  }

  if (!snapshot) {
    return <div className="rounded-md border border-border bg-panel p-6 text-sm text-danger">Unable to load profile.</div>;
  }

  return (
    <div className="space-y-2.5">
      <TopbarTime
        snapshot={snapshot}
        clockOffsetMs={clockOffsetMs}
        onManualPause={() => void runManualPause()}
        onManualContinue={() => void runManualContinue()}
        controlBusy={manualControlBusy}
        onToggleTimeScale={() => void toggleTimeScale()}
        timeScaleBusy={timeScaleBusy}
      />
      <div className="rounded-md border border-border/60 bg-panel/60 px-3 py-1.5 text-[11px] text-muted">Navigasi V4: gunakan Quick Tabs untuk akses Status, Perintah, dan semua halaman dashboard lebih cepat.</div>
      <V2CommandCenter snapshot={snapshot} />
      <div className="cyber-panel space-y-2 p-2.5">
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-5">
          {TRAVEL_PLACES.map((entry) => (
            <button
              key={entry.place}
              onClick={() => runTravel(entry.place)}
              disabled={Boolean(actionBusy) || Boolean(snapshot.pendingDecision)}
              className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
            >
              {actionBusy === entry.place ? 'Traveling...' : `Travel: ${entry.label}`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
          <button
            onClick={() => { setAcademyTierDraft(1); setAcademyOpen(true); }}
            disabled={Boolean(actionBusy) || Boolean(snapshot.pendingDecision)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
          >
            {actionBusy === 'ACADEMY_T1' ? 'Processing...' : 'Military Academy Officer'}
          </button>
          <button
            onClick={() => { setAcademyTierDraft(2); setAcademyOpen(true); }}
            disabled={Boolean(actionBusy) || Boolean(snapshot.pendingDecision)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
          >
            {actionBusy === 'ACADEMY_T2' ? 'Processing...' : 'Military Academy High Command'}
          </button>
          <button
            onClick={runCareerReview}
            disabled={Boolean(actionBusy) || Boolean(snapshot.pendingDecision)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
          >
            {actionBusy === 'CAREER_REVIEW' ? 'Running...' : 'Career Review'}
          </button>
          <button
            onClick={() => {
              setInventoryOpen((prev) => {
                const next = !prev;
                if (next && !openedCertificateId && safeCertificates.length > 0) {
                  setOpenedCertificateId(safeCertificates[0].id);
                }
                return next;
              });
            }}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent"
          >
            {inventoryOpen ? 'Close Inventory' : 'Inventory'}
          </button>
          <button
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent"
          >
            {settingsOpen ? 'Close Settings' : 'Settings'}
          </button>
        </div>
        <p className="text-[11px] text-muted">
          Academy tier: {snapshot.academyTier ?? 0} · Last travel: {snapshot.lastTravelPlace ?? 'None'} · Division freedom: {snapshot.divisionFreedomScore ?? 0}
        </p>
        {snapshot.divisionAccess ? (
          <p className="text-[11px] text-muted">
            Division: {snapshot.divisionAccess.division} ({snapshot.divisionAccess.accessLevel}) · Dangerous mission: {snapshot.divisionAccess.dangerousMissionUnlocked ? 'Unlocked' : 'Locked'} · Benefits: {snapshot.divisionAccess.benefits.join(', ')}
          </p>
        ) : null}
      </div>

      {academyOpen ? (
        <div className="cyber-panel space-y-2 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.1em] text-muted">Military Academy Training Phase</p>
            <button className="rounded border border-border px-2 py-1 text-[11px] text-text" onClick={() => setAcademyOpen(false)}>Close</button>
          </div>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
            <label className="text-[11px] text-muted">Tier
              <select className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-[11px] text-text" value={academyTierDraft} onChange={(e) => setAcademyTierDraft(Number(e.target.value) === 2 ? 2 : 1)}>
                <option value={1}>Officer Academy</option>
                <option value={2}>High Command Academy</option>
              </select>
            </label>
            <label className="text-[11px] text-muted md:col-span-2">Preferred Division
              <select className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-[11px] text-text" value={divisionDraft} onChange={(e) => setDivisionDraft(e.target.value)}>
                {DIVISION_OPTIONS.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-1 md:grid-cols-2">
            {ACADEMY_QUESTIONS.map((question, index) => (
              <label key={question.prompt} className="rounded border border-border bg-bg/60 p-1.5 text-[11px] text-muted">
                <p className="mb-1 text-text">Q{index + 1}. {question.prompt}</p>
                <select
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-[11px] text-text"
                  value={academyAnswers[index] ?? 1}
                  onChange={(e) => {
                    const selected = Number(e.target.value);
                    setAcademyAnswers((prev) => {
                      const next = [...prev];
                      next[index] = selected;
                      return next;
                    });
                  }}
                >
                  {question.options.map((option, optionIndex) => (
                    <option key={option} value={optionIndex + 1}>{option}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button onClick={runMilitaryAcademy} disabled={Boolean(actionBusy)} className="rounded border border-accent bg-accent/20 px-2.5 py-1.5 text-[11px] text-text disabled:opacity-60">
            {actionBusy === 'ACADEMY_T2' || actionBusy === 'ACADEMY_T1' ? 'Assessing...' : 'Submit Academy Assessment'}
          </button>
        </div>
      ) : null}

      {inventoryOpen ? (
        <div className="cyber-panel space-y-2 p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-muted">Inventory · Certificates</p>
          <div className="grid gap-1 md:grid-cols-2">
            {safeCertificates.length === 0 ? (
              <p className="rounded border border-border bg-bg/60 px-2 py-1.5 text-[11px] text-muted">No certificate stored yet.</p>
            ) : (
              safeCertificates.map((cert) => (
                <button key={cert.id} onClick={() => setOpenedCertificateId(cert.id)} className="rounded border border-border bg-bg/60 px-2 py-1.5 text-left text-[11px] text-text hover:border-accent">
                  {cert.academyName} · Grade {cert.grade} · Score {cert.score} · Open Certificate
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {openedCertificateId ? (
        <div className="cyber-panel p-2.5">
          {(() => {
            const cert = safeCertificates.find((item) => item.id === openedCertificateId);
            if (!cert) return <p className="text-[11px] text-muted">Certificate not found.</p>;
            return (
              <div className="rounded-md border-2 border-amber-300/70 bg-gradient-to-br from-amber-50 via-[#f8f0d6] to-amber-100 p-4 text-[#2f2412] shadow-panel">
                <p className="text-center text-xs uppercase tracking-[0.18em]">Military Academy Distinguished Certificate</p>
                <h3 className="mt-2 text-center text-xl font-semibold">{cert.academyName}</h3>
                <p className="mt-3 text-center text-sm">Congratulations on successfully completing the training phase and competency assessment.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <p><span className="font-semibold">Score:</span> {cert.score}</p>
                  <p><span className="font-semibold">Grade:</span> {cert.grade}</p>
                  <p><span className="font-semibold">Division Freedom:</span> {cert.divisionFreedomLevel}</p>
                  <p><span className="font-semibold">Assigned Division:</span> {cert.assignedDivision}</p>
                  <p><span className="font-semibold">Issued Day:</span> {cert.issuedAtDay}</p>
                </div>
                <p className="mt-3 text-sm italic">{cert.message}</p>
                <div className="mt-4 flex items-end justify-between">
                  <p className="text-xs">Authorized Signature</p>
                  <p className="text-sm font-semibold">{cert.trainerName}</p>
                </div>
                <div className="mt-2 text-right">
                  <button onClick={() => setOpenedCertificateId(null)} className="rounded border border-[#4a3a1f] px-2 py-1 text-[11px]">Close Certificate</button>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}


      {academyOutcome ? (
        <div className={`rounded-md border p-2 text-xs ${academyOutcome.passed ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-100' : 'border-danger/60 bg-danger/10 text-danger'}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{academyOutcome.passed ? 'Lulus Military Academy' : 'Belum Lulus Military Academy'}</p>
              <p className="mt-0.5 text-[11px] opacity-90">Skor {academyOutcome.score} / Minimal {academyOutcome.passThreshold}</p>
              <p className="mt-0.5 text-[11px] opacity-90">{academyOutcome.message}</p>
            </div>
            <div className="flex gap-1">
              {academyOutcome.passed && academyOutcome.certificateId ? (
                <button
                  onClick={() => {
                    setInventoryOpen(true);
                    setOpenedCertificateId(academyOutcome.certificateId ?? null);
                    setAcademyOutcome(null);
                  }}
                  className="rounded border border-current px-2 py-1 text-[11px]"
                >
                  Lihat Sertifikat
                </button>
              ) : null}
              <button onClick={() => setAcademyOutcome(null)} className="rounded border border-current px-2 py-1 text-[11px]">Tutup</button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="rounded-md border border-border bg-panel p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-muted">World Settings</p>
          <button
            onClick={restartWorld}
            disabled={resetBusy}
            className="mt-1.5 rounded border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger disabled:opacity-60"
          >
            {resetBusy ? 'Restarting...' : 'Restart World from 0 (Rank)'}
          </button>
        </div>
      ) : null}


      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {snapshot.activeMission?.status === 'ACTIVE' && !snapshot.activeMission.playerParticipates ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-lg rounded-md border border-amber-400/70 bg-panel p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.12em] text-amber-200">Panggilan Misi Otomatis · Day {snapshot.activeMission.issuedDay}</p>
            <h3 className="mt-1 text-base font-semibold text-amber-100">Ikut misi atau tidak?</h3>
            <p className="mt-2 text-sm text-muted">
              Jika ikut: Anda langsung ke halaman deployment misi dan waktu game tetap pause. Jika tidak: misi berjalan otomatis oleh 8 NPC di background.
            </p>
            <p className="mt-2 text-xs text-amber-100/90">
              Mission: {snapshot.activeMission.missionType} · Danger: {snapshot.activeMission.dangerTier}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void respondMissionCall(true)}
                disabled={missionCallBusy !== null}
                className="rounded border border-emerald-500 bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {missionCallBusy === 'YES' ? 'Memproses...' : 'Ya, ikuti misi'}
              </button>
              <button
                onClick={() => void respondMissionCall(false)}
                disabled={missionCallBusy !== null}
                className="rounded border border-border bg-bg px-3 py-1.5 text-sm text-text disabled:opacity-50"
              >
                {missionCallBusy === 'NO' ? 'Memproses...' : 'Tidak, jalankan NPC'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {snapshot.pendingDecision ? (
        <DecisionModal
          decision={snapshot.pendingDecision}
          onOpenFrame={() => {
            router.push('/dashboard/event-frame');
          }}
        />
      ) : null}
    </div>
  );
}
