'use client';

import dynamic from 'next/dynamic';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { BRANCH_OPTIONS, COUNTRY_OPTIONS } from '@/lib/constants';
import { useGameStore } from '@/store/game-store';
import { ActionButtons } from './action-buttons';
import { TopbarTime } from './topbar-time';
import { V2CommandCenter } from './v2-command-center';

const DecisionModal = dynamic(() => import('./decision-modal').then((mod) => mod.DecisionModal), {
  ssr: false
});

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

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.snapshot();
      setSnapshot(response.snapshot);
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
        setError(err.message);
        return;
      }
      setError('Unable to load game snapshot');
    }
  }, [router, setError, setLoading, setSnapshot]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (noProfile) return;
    if (!snapshot) return;

    const intervalMs = snapshot.paused ? 30_000 : 10_000;
    const timer = window.setInterval(() => {
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

  const runAction = useCallback(
    async (action: 'training' | 'deployment' | 'career-review') => {
      setActionBusy(action);
      try {
        const response =
          action === 'training'
            ? await api.training('MEDIUM')
            : action === 'deployment'
              ? await api.deployment('SUPPORT')
              : await api.careerReview();
        setSnapshot(response.snapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setActionBusy(null);
      }
    },
    [setError, setSnapshot]
  );

  const handleDecision = useCallback(
    async (optionId: string) => {
      if (!snapshot?.pendingDecision) {
        return;
      }
      const response = await api.chooseDecision(snapshot.pendingDecision.eventId, optionId);
      setSnapshot(response.snapshot);
    },
    [setSnapshot, snapshot]
  );

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
    <div className="space-y-4">
      <TopbarTime snapshot={snapshot} clockOffsetMs={clockOffsetMs} />
      <V2CommandCenter snapshot={snapshot} />
      <ActionButtons />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <button
          onClick={() => runAction('training')}
          disabled={Boolean(actionBusy)}
          className="rounded border border-border bg-panel px-3 py-2 text-sm text-text hover:border-accent disabled:opacity-60"
        >
          {actionBusy === 'training' ? 'Running...' : 'Quick Training'}
        </button>
        <button
          onClick={() => runAction('deployment')}
          disabled={Boolean(actionBusy)}
          className="rounded border border-border bg-panel px-3 py-2 text-sm text-text hover:border-accent disabled:opacity-60"
        >
          {actionBusy === 'deployment' ? 'Running...' : 'Quick Deployment'}
        </button>
        <button
          onClick={() => runAction('career-review')}
          disabled={Boolean(actionBusy)}
          className="rounded border border-border bg-panel px-3 py-2 text-sm text-text hover:border-accent disabled:opacity-60"
        >
          {actionBusy === 'career-review' ? 'Running...' : 'Career Review'}
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {snapshot.pendingDecision ? <DecisionModal decision={snapshot.pendingDecision} onChoose={handleDecision} /> : null}
    </div>
  );
}
