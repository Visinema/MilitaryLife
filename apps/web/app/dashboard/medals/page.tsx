'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MedalCatalogItem } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

export default function MedalsV3Page() {
  const [items, setItems] = useState<MedalCatalogItem[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    api.medalCatalog().then((res) => {
      setItems(res.items);
      setNote(res.note);
    }).catch(() => null);
  }, []);

  return (
    <div className="space-y-3">
      <div className="cyber-panel p-3">
        <h1 className="text-sm font-semibold text-text">V3 Medal Catalog</h1>
        <p className="text-[11px] text-muted">{note}</p>
        <Link href="/dashboard" className="mt-1 inline-block rounded border border-border bg-bg px-2 py-1 text-[11px] text-text">Back Dashboard</Link>
      </div>
      <div className="cyber-panel max-h-[68vh] space-y-2 overflow-y-auto p-3">
        {items.map((item) => (
          <div key={item.code} className="rounded border border-border/60 bg-bg/70 p-2 text-[11px]">
            <p className="font-semibold text-text">{item.name}</p>
            <p className="text-muted">{item.description}</p>
            <p className="text-muted">Minimum Mission Success: {item.minimumMissionSuccess} · Danger Tier: {item.minimumDangerTier}</p>
            <p className="text-muted">Kriteria: {item.criteria.join(' · ')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
