'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import { useUiStore } from '@/store/ui-store';
import { useGameStore } from '@/store/game-store';

export function PausedRouteGuard() {
  const setPauseToken = useUiStore((state) => state.setPauseToken);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const pauseTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const beginPause = async () => {
      try {
        const response = await api.pause('SUBPAGE');
        if (!active) return;
        pauseTokenRef.current = response.pauseToken;
        setPauseToken(response.pauseToken);
        setSnapshot(response.snapshot);
      } catch {
        // Keep UI responsive even if pause call fails.
      }
    };

    beginPause();

    return () => {
      active = false;
      const token = pauseTokenRef.current;
      if (!token) return;
      void api
        .resume(token)
        .then((response) => {
          setSnapshot(response.snapshot);
        })
        .catch(() => {
          // Ignore invalid/expired token on cleanup to prevent uncaught promise noise.
        });
      setPauseToken(null);
    };
  }, [setPauseToken, setSnapshot]);

  return null;
}
