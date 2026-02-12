export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roll(probability: number): boolean {
  return Math.random() < probability;
}

export function sampleWeighted<T>(items: Array<{ item: T; weight: number }>): T | null {
  const total = items.reduce((acc, entry) => acc + Math.max(0, entry.weight), 0);
  if (total <= 0) return null;

  let threshold = Math.random() * total;
  for (const entry of items) {
    threshold -= Math.max(0, entry.weight);
    if (threshold <= 0) return entry.item;
  }

  return items[items.length - 1]?.item ?? null;
}

export function sampleGeometricGap(probability: number, minGap: number, maxGap: number): number {
  const p = clamp(probability, 0.05, 0.95);
  let gap = minGap;
  while (gap < maxGap && Math.random() > p) {
    gap += 1;
  }
  return gap;
}
