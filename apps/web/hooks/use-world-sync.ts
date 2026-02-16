'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameSnapshotV5, WorldDelta } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

interface UseWorldSyncState {
  snapshot: GameSnapshotV5 | null;
  delta: WorldDelta | null;
  loading: boolean;
  error: string | null;
  forceSync: () => Promise<void>;
  resetWorld: () => Promise<void>;
}

export function useWorldSync(): UseWorldSyncState {
  const [snapshot, setSnapshot] = useState<GameSnapshotV5 | null>(null);
  const [delta, setDelta] = useState<WorldDelta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef<number>(0);
  const inFlightRef = useRef(false);

  const syncNow = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await api.v5SessionSync(versionRef.current > 0 ? versionRef.current : undefined);
      if (response.snapshot) {
        setSnapshot(response.snapshot);
        versionRef.current = response.snapshot.stateVersion;
      }
      setDelta(response.delta ?? null);
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'World sync failed';
      setError(message);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const startSession = useCallback(async (resetWorld = false) => {
    setLoading(true);
    try {
      const response = await api.v5SessionStart({ resetWorld });
      setSnapshot(response.snapshot ?? null);
      setDelta(null);
      versionRef.current = response.snapshot?.stateVersion ?? 0;
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Unable to start world session';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void startSession(false);
  }, [startSession]);

  useEffect(() => {
    if (!snapshot) return;

    const syncTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void syncNow();
    }, 1400);

    const heartbeatTimer = window.setInterval(() => {
      api.v5SessionHeartbeat({ sessionTtlMs: 30_000 }).catch(() => null);
    }, 8_000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void syncNow();
      }
    };

    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      window.clearInterval(syncTimer);
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [snapshot, syncNow]);

  const forceSync = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  const resetWorld = useCallback(async () => {
    await startSession(true);
  }, [startSession]);

  return {
    snapshot,
    delta,
    loading,
    error,
    forceSync,
    resetWorld
  };
}

