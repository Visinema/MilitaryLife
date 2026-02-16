'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SocialTimelineEvent } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

type SocialTimelinePayload = {
  events: SocialTimelineEvent[];
  snapshot: {
    world?: {
      currentDay?: number;
    };
  } | null;
};

type ActorFilter = 'ALL' | 'PLAYER' | 'NPC';

function formatTimelineDay(day: number): string {
  return `Day ${day}`;
}

export default function SocialProfilePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActorFilter>('ALL');
  const [data, setData] = useState<SocialTimelinePayload | null>(null);

  const loadTimeline = useCallback(async (actorFilter: ActorFilter) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.v5SocialTimeline({
        actorType: actorFilter === 'ALL' ? undefined : actorFilter,
        limit: 180
      });
      setData(response);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Gagal memuat social timeline.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTimeline(filter);
  }, [filter, loadTimeline]);

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Social Profile Panel</p>
        <h1 className="text-lg font-semibold text-text">Rekam Jejak Personel</h1>
        <p className="text-xs text-muted">Timeline bertanggal untuk perubahan rank, divisi, jabatan, sidang, council, misi, dan event operasional.</p>
      </div>

      <div className="cyber-panel p-3 text-xs space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter('ALL')}
            className={`rounded border px-2 py-1 ${filter === 'ALL' ? 'border-accent bg-accent/20 text-text' : 'border-border bg-bg text-muted'}`}
          >
            Semua
          </button>
          <button
            onClick={() => setFilter('PLAYER')}
            className={`rounded border px-2 py-1 ${filter === 'PLAYER' ? 'border-accent bg-accent/20 text-text' : 'border-border bg-bg text-muted'}`}
          >
            Player
          </button>
          <button
            onClick={() => setFilter('NPC')}
            className={`rounded border px-2 py-1 ${filter === 'NPC' ? 'border-accent bg-accent/20 text-text' : 'border-border bg-bg text-muted'}`}
          >
            NPC
          </button>
          <span className="rounded border border-border/70 bg-bg/70 px-2 py-1 text-muted">
            World Day: {data?.snapshot?.world?.currentDay ?? '-'}
          </span>
        </div>
      </div>

      <div className="cyber-panel p-3 text-xs">
        {loading ? <p className="text-muted">Loading social timeline...</p> : null}
        {error ? <p className="text-danger">{error}</p> : null}
        {!loading && !error && (data?.events.length ?? 0) === 0 ? <p className="text-muted">Belum ada rekam jejak.</p> : null}
        <div className="space-y-2">
          {data?.events.map((eventItem) => (
            <article key={eventItem.id} className="rounded border border-border/60 bg-bg/70 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-text">{eventItem.title}</p>
                <span className="text-[11px] text-muted">{formatTimelineDay(eventItem.eventDay)}</span>
              </div>
              <p className="mt-1 text-muted">{eventItem.detail}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted">{eventItem.actorType}</span>
                <span className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted">{eventItem.eventType}</span>
                {eventItem.actorNpcId ? (
                  <span className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted">NPC: {eventItem.actorNpcId}</span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
