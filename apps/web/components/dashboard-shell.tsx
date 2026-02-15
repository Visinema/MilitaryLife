'use client';

import dynamic from 'next/dynamic';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type TravelPlace } from '@/lib/api-client';
import { BRANCH_OPTIONS, COUNTRY_OPTIONS } from '@/lib/constants';
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


export function DashboardShell() {
  const router = useRouter();
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
    country: 'US' as 'US' | 'ID',
    branch: 'US_ARMY'
  });

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const snapshotCooldownUntilRef = useRef(0);
  const hasInitialSnapshotRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (Date.now() < snapshotCooldownUntilRef.current) {
      return;
    }

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
        if (err.status >= 500) {
          snapshotCooldownUntilRef.current = Date.now() + 15_000;
          setError('Server sementara bermasalah (5xx). Menunggu sebelum sinkronisasi ulang...');
          return;
        }
        setError(err.message);
        return;
      }
      snapshotCooldownUntilRef.current = Date.now() + 15_000;
      setError('Unable to load game snapshot');
    }
  }, [router, setError, setLoading, setSnapshot]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (noProfile) return;
    if (!snapshot) return;

    const intervalMs = snapshot.paused ? 60_000 : 20_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void loadSnapshot();
    }, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadSnapshot();
      }
    };

    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadSnapshot, noProfile, snapshot]);

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

  const runTravel = useCallback(
    async (place: TravelPlace) => {
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
    [setError, setSnapshot]
  );

  const runMilitaryAcademy = useCallback(
    async (tier: 1 | 2) => {
      const key = tier === 2 ? 'ACADEMY_T2' : 'ACADEMY_T1';
      setActionBusy(key);
      try {
        const response = await api.militaryAcademy(tier);
        setSnapshot(response.snapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Military academy action failed');
      } finally {
        setActionBusy(null);
      }
    },
    [setError, setSnapshot]
  );

  const runCareerReview = useCallback(async () => {
    setActionBusy('CAREER_REVIEW');
    try {
      const response = await api.careerReview();
      setSnapshot(response.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Career review failed');
    } finally {
      setActionBusy(null);
    }
  }, [setError, setSnapshot]);

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
                const country = e.target.value as 'US' | 'ID';
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
    <div className="space-y-1.5">
      <TopbarTime snapshot={snapshot} clockOffsetMs={clockOffsetMs} />
      <V2CommandCenter snapshot={snapshot} />
      <div className="cyber-panel space-y-1.5 p-2">
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
          {TRAVEL_PLACES.map((entry) => (
            <button
              key={entry.place}
              onClick={() => runTravel(entry.place)}
              disabled={Boolean(actionBusy)}
              className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
            >
              {actionBusy === entry.place ? 'Traveling...' : `Travel: ${entry.label}`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
          <button
            onClick={() => runMilitaryAcademy(1)}
            disabled={Boolean(actionBusy)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
          >
            {actionBusy === 'ACADEMY_T1' ? 'Processing...' : 'Military Academy Officer'}
          </button>
          <button
            onClick={() => runMilitaryAcademy(2)}
            disabled={Boolean(actionBusy)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
          >
            {actionBusy === 'ACADEMY_T2' ? 'Processing...' : 'Military Academy High Command'}
          </button>
          <button
            onClick={runCareerReview}
            disabled={Boolean(actionBusy)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent disabled:opacity-60"
          >
            {actionBusy === 'CAREER_REVIEW' ? 'Running...' : 'Career Review'}
          </button>
          <button
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] text-text hover:border-accent"
          >
            {settingsOpen ? 'Close Settings' : 'Settings'}
          </button>
        </div>
        <p className="text-[11px] text-muted">
          Academy tier: {snapshot.academyTier ?? 0} · Last travel: {snapshot.lastTravelPlace ?? 'None'}
        </p>
      </div>

      {settingsOpen ? (
        <div className="rounded-md border border-border bg-panel p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-muted">World Settings</p>
          <button
            onClick={restartWorld}
            disabled={resetBusy}
            className="mt-1.5 rounded border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger disabled:opacity-60"
          >
            {resetBusy ? 'Restarting...' : 'Restart World from 0 (Universal)'}
          </button>
        </div>
      ) : null}


      {error ? <p className="text-sm text-danger">{error}</p> : null}

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
