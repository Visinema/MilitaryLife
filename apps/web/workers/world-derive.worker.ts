/// <reference lib="webworker" />

type LightweightNpc = {
  npcId: string;
  division: string;
  unit: string;
  status: 'ACTIVE' | 'INJURED' | 'KIA' | 'RESERVE' | 'RECRUITING';
  commandScore: number;
};

const workerContext: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerContext.onmessage = (event: MessageEvent<{ npcs: LightweightNpc[] }>) => {
  const npcs = Array.isArray(event.data?.npcs) ? event.data.npcs : [];

  const topCommand = [...npcs]
    .sort((a, b) => b.commandScore - a.commandScore)
    .slice(0, 12)
    .map((item) => ({
      npcId: item.npcId,
      division: item.division,
      unit: item.unit,
      commandScore: item.commandScore,
      status: item.status
    }));

  const byDivision = npcs.reduce<Record<string, { total: number; active: number; kia: number }>>((acc, item) => {
    const key = item.division || 'Unknown Division';
    const row = acc[key] ?? { total: 0, active: 0, kia: 0 };
    row.total += 1;
    if (item.status === 'ACTIVE') row.active += 1;
    if (item.status === 'KIA') row.kia += 1;
    acc[key] = row;
    return acc;
  }, {});

  workerContext.postMessage({
    topCommand,
    byDivision
  });
};

export {};

