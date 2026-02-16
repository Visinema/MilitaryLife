'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ExpansionStateV51, SocialTimelineEvent } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

type RaiderIncident = SocialTimelineEvent & {
  casualties: Array<{ npcId?: string; name?: string; slotNo?: number; dueDay?: number }>;
  threatScore: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
};

function parseIncident(event: SocialTimelineEvent): RaiderIncident {
  const meta = event.meta ?? {};
  const rawCasualties = Array.isArray(meta.casualties) ? meta.casualties : [];
  const casualties = rawCasualties
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      npcId: typeof item.npcId === 'string' ? item.npcId : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      slotNo: typeof item.slotNo === 'number' ? item.slotNo : undefined,
      dueDay: typeof item.dueDay === 'number' ? item.dueDay : undefined
    }));
  const threatScore = typeof meta.threatScore === 'number' ? meta.threatScore : 0;
  const severity =
    typeof meta.severity === 'string' && ['LOW', 'MEDIUM', 'HIGH'].includes(meta.severity.toUpperCase())
      ? (meta.severity.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH')
      : threatScore >= 75
        ? 'HIGH'
        : threatScore >= 50
          ? 'MEDIUM'
          : 'LOW';

  return {
    ...event,
    casualties,
    threatScore,
    severity
  };
}

export default function RaiderAttackPage() {
  const [expansion, setExpansion] = useState<ExpansionStateV51 | null>(null);
  const [incidents, setIncidents] = useState<RaiderIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [expansionRes, timelineRes] = await Promise.all([api.v5ExpansionState(), api.v5SocialTimeline({ limit: 220 })]);
      const raiderEvents = timelineRes.events.filter((item) => item.eventType === 'RAIDER_ATTACK').map(parseIncident);
      setExpansion(expansionRes.state);
      setIncidents(raiderEvents.slice(0, 30));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat status raider.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totalCasualties = useMemo(
    () => incidents.reduce((sum, incident) => sum + incident.casualties.length, 0),
    [incidents]
  );

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Raider Threat V5</p>
        <h1 className="text-lg font-semibold text-text">Serangan Teroris Periodik</h1>
        <p className="mt-1 text-xs text-muted">
          Raider diproses otomatis oleh engine tick. Countdown, level ancaman, casualty, dan replacement queue tampil di panel ini.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">
            Back Dashboard
          </Link>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-border bg-bg px-3 py-1 text-xs text-text disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Refresh Status'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section className="cyber-panel grid gap-2 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <p>
          Threat Level: <span className="text-text">{expansion?.raiderThreat?.threatLevel ?? '-'}</span>
        </p>
        <p>
          Threat Score: <span className="text-text">{expansion?.raiderThreat?.threatScore ?? '-'}</span>
        </p>
        <p>
          Countdown: <span className="text-text">{expansion?.raiderThreat?.daysUntilNext ?? '-'} hari</span>
        </p>
        <p>
          Pending Replacement: <span className="text-text">{expansion?.raiderThreat?.pendingReplacementCount ?? '-'}</span>
        </p>
      </section>

      <section className="cyber-panel p-3 text-xs">
        <h2 className="text-sm font-semibold text-text">Ringkasan Cadence</h2>
        <p className="mt-1 text-muted">
          Last attack day: <span className="text-text">{expansion?.raiderThreat?.lastAttackDay ?? '-'}</span>
        </p>
        <p className="text-muted">
          Next attack day: <span className="text-text">{expansion?.raiderThreat?.nextAttackDay ?? '-'}</span>
        </p>
        <p className="text-muted">
          Cadence days: <span className="text-text">{expansion?.raiderThreat?.cadenceDays ?? '-'}</span>
        </p>
        <p className="text-muted">
          Total casualty (insiden terbaru): <span className="text-text">{totalCasualties}</span>
        </p>
      </section>

      <section className="cyber-panel p-3 text-xs">
        <h2 className="text-sm font-semibold text-text">Riwayat Insiden Raider</h2>
        {incidents.length === 0 ? (
          <p className="mt-1 text-muted">Belum ada insiden raider yang tercatat.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {incidents.map((incident) => (
              <article key={incident.id} className="rounded border border-border/60 bg-bg/60 p-2">
                <p className="text-text">
                  Day {incident.eventDay} [{incident.severity}] - threat {incident.threatScore}
                </p>
                <p className="text-muted">{incident.detail}</p>
                {incident.casualties.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {incident.casualties.map((item, idx) => (
                      <p key={`${incident.id}-${idx}`} className="text-muted">
                        - {item.name ?? item.npcId ?? 'NPC'} (slot {item.slotNo ?? '-'}) replacement due day {item.dueDay ?? '-'}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-muted">Tidak ada casualty pada insiden ini.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
