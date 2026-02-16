'use client';

import { useEffect, useMemo, useState } from 'react';
import type { NpcRuntimeState } from '@mls/shared/game-types';

type WorkerResult = {
  topCommand: Array<{
    npcId: string;
    division: string;
    unit: string;
    commandScore: number;
    status: 'ACTIVE' | 'INJURED' | 'KIA' | 'RESERVE' | 'RECRUITING';
  }>;
  byDivision: Record<string, { total: number; active: number; kia: number }>;
};

export function useWorldDerivations(npcs: NpcRuntimeState[]) {
  const [derived, setDerived] = useState<WorkerResult>({ topCommand: [], byDivision: {} });

  const lightweight = useMemo(
    () =>
      npcs.map((item) => ({
        npcId: item.npcId,
        division: item.division,
        unit: item.unit,
        status: item.status,
        commandScore: item.leadership + item.resilience + item.promotionPoints - item.fatigue
      })),
    [npcs]
  );

  useEffect(() => {
    if (lightweight.length === 0) {
      setDerived({ topCommand: [], byDivision: {} });
      return;
    }

    const worker = new Worker(new URL('../workers/world-derive.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      setDerived(event.data);
    };
    worker.postMessage({ npcs: lightweight });

    return () => {
      worker.terminate();
    };
  }, [lightweight]);

  return derived;
}

