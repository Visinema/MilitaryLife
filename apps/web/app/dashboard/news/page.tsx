'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { NewsType } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

const FILTERS: Array<{ label: string; value: NewsType | 'ALL' }> = [
  { label: 'Semua News', value: 'ALL' },
  { label: 'Pemecatan', value: 'DISMISSAL' },
  { label: 'Misi', value: 'MISSION' },
  { label: 'Promosi', value: 'PROMOTION' },
  { label: 'Pemberian Medal', value: 'MEDAL' }
];

export default function NewsPage() {
  const [filter, setFilter] = useState<NewsType | 'ALL'>('ALL');
  const [items, setItems] = useState<Array<{ id: string; day: number; type: NewsType; title: string; detail: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.news(filter === 'ALL' ? undefined : filter)
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [filter]);

  const grouped = useMemo(() => {
    const map = new Map<number, Array<{ id: string; day: number; type: NewsType; title: string; detail: string }>>();
    for (const item of items) {
      const row = map.get(item.day) ?? [];
      row.push(item);
      map.set(item.day, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">News Center</p>
        <h1 className="text-lg font-semibold text-text">Logs 30 Hari Terakhir</h1>
        <p className="text-xs text-muted">Optimized feed: default hanya 30 hari terakhir agar cepat dan anti-lag.</p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Back Dashboard</Link>
        </div>
      </div>

      <div className="cyber-panel p-3 text-xs">
        <label className="text-muted">Filter bawaan</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value as NewsType | 'ALL')} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text">
          {FILTERS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="cyber-panel max-h-[32rem] space-y-3 overflow-y-auto p-3 text-xs">
        {grouped.length === 0 ? <p className="text-muted">Belum ada news pada rentang 30 hari.</p> : null}
        {grouped.map(([day, rows]) => (
          <section key={day} className="rounded border border-border/60 bg-bg/60 p-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Day {day}</p>
            <div className="mt-1 space-y-1">
              {rows.map((item) => (
                <article key={item.id} className="rounded border border-border/50 bg-bg/70 px-2 py-1">
                  <p className="text-text">[{item.type}] {item.title}</p>
                  <p className="text-muted">{item.detail}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
