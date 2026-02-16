'use client';

import { useEffect, useRef } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useUiStore } from '@/store/ui-store';
import { useGameStore } from '@/store/game-store';

export function PausedRouteGuard() {
  const setPauseToken = useUiStore((state) => state.setPauseToken);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setError = useGameStore((state) => state.setError);
  const pauseTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const beginPause = async () => {
      try {
        const latestSnapshot = useGameStore.getState().snapshot;
        if (latestSnapshot?.paused && latestSnapshot.pauseReason === 'SUBPAGE' && latestSnapshot.pauseToken) {
          pauseTokenRef.current = latestSnapshot.pauseToken;
          setPauseToken(latestSnapshot.pauseToken);
          return;
        }

        const response = await api.pause('SUBPAGE');
        if (!active) return;
        pauseTokenRef.current = response.pauseToken;
        setPauseToken(response.pauseToken);
        setSnapshot(response.snapshot);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Gagal melakukan pause saat membuka subpage.');
      }
    };

    void beginPause();

    return () => {
      active = false;

      const currentSnapshot = useGameStore.getState().snapshot;
      const latestToken = currentSnapshot?.pauseToken ?? pauseTokenRef.current;
      const canResumeSubpagePause = Boolean(
        latestToken &&
        currentSnapshot?.paused &&
        currentSnapshot.pauseReason === 'SUBPAGE' &&
        !currentSnapshot.ceremonyDue
      );

      if (!canResumeSubpagePause || !latestToken) {
        setPauseToken(null);
        return;
      }

      void api
        .resume(latestToken)
        .then((response) => {
          setSnapshot(response.snapshot);
          setError(null);
        })
        .catch(async (err) => {
          if (err instanceof ApiError && err.status === 409) {
            try {
              const refreshed = await api.snapshot();
              setSnapshot(refreshed.snapshot);
              if (!refreshed.snapshot.paused) {
                setError(null);
              } else if (refreshed.snapshot.ceremonyDue) {
                setError('Upacara wajib aktif. Selesaikan upacara sebelum melanjutkan game.');
              } else {
                setError(null);
              }
            } catch (snapshotErr) {
              setError(snapshotErr instanceof Error ? snapshotErr.message : 'Gagal sinkronisasi snapshot setelah konflik resume.');
            }
            return;
          }
          setError(err instanceof Error ? err.message : 'Gagal resume saat keluar dari subpage.');
        })
        .finally(() => {
          setPauseToken(null);
        });
    };
  }, [setError, setPauseToken, setSnapshot]);

  return null;
}
