'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { SocialTimelineEvent } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';

type DomainFilter = 'ALL' | 'DOM' | 'COURT' | 'COUNCIL' | 'COMMAND_CHAIN' | 'RECRUITMENT' | 'ACADEMY' | 'RAIDER' | 'RISK' | 'OTHER';
type SeverityFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
type ClassifiedEvent = SocialTimelineEvent & { domain: DomainFilter; severity: Exclude<SeverityFilter, 'ALL'> };

const DOMAIN_OPTIONS: Array<{ label: string; value: DomainFilter }> = [
  { label: 'Semua Domain', value: 'ALL' },
  { label: 'DOM', value: 'DOM' },
  { label: 'Court', value: 'COURT' },
  { label: 'Council', value: 'COUNCIL' },
  { label: 'Command Chain', value: 'COMMAND_CHAIN' },
  { label: 'Recruitment', value: 'RECRUITMENT' },
  { label: 'Academy', value: 'ACADEMY' },
  { label: 'Raider', value: 'RAIDER' },
  { label: 'Risk', value: 'RISK' },
  { label: 'Lainnya', value: 'OTHER' }
];

const SEVERITY_OPTIONS: Array<{ label: string; value: SeverityFilter }> = [
  { label: 'Semua Severity', value: 'ALL' },
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' }
];

function classifyDomain(eventType: string): DomainFilter {
  if (eventType.startsWith('DOM_')) return 'DOM';
  if (eventType.startsWith('COURT_')) return 'COURT';
  if (eventType.startsWith('COUNCIL_')) return 'COUNCIL';
  if (eventType.startsWith('COMMAND_CHAIN_')) return 'COMMAND_CHAIN';
  if (eventType.startsWith('RECRUITMENT_')) return 'RECRUITMENT';
  if (eventType.startsWith('ACADEMY_')) return 'ACADEMY';
  if (eventType.startsWith('RAIDER_')) return 'RAIDER';
  if (eventType.includes('RISK') || eventType.includes('BETRAYAL') || eventType.includes('CORRUPTION')) return 'RISK';
  return 'OTHER';
}

function classifySeverity(event: SocialTimelineEvent): 'LOW' | 'MEDIUM' | 'HIGH' {
  const metaSeverity = typeof event.meta?.severity === 'string' ? String(event.meta.severity).toUpperCase() : '';
  if (metaSeverity === 'HIGH' || metaSeverity === 'MEDIUM' || metaSeverity === 'LOW') return metaSeverity;

  const type = event.eventType.toUpperCase();
  if (type.includes('BREAK') || type.includes('BREACH') || type.includes('RAIDER_ATTACK')) return 'HIGH';
  if (type.includes('DISMISSAL') || type.includes('DEMOTION') || type.includes('SANCTION')) return 'HIGH';
  if (type.includes('RISK') || type.includes('BETRAYAL') || type.includes('COURT')) return 'MEDIUM';
  if (type.includes('COUNCIL') || type.includes('RECRUITMENT') || type.includes('ACADEMY') || type.includes('DOM')) return 'LOW';
  return 'LOW';
}

export default function NewsPage() {
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('ALL');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [items, setItems] = useState<ClassifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .v5SocialTimeline({ limit: 240 })
      .then((res) => {
        const classified = res.events.map((event) => ({
          ...event,
          domain: classifyDomain(event.eventType),
          severity: classifySeverity(event)
        }));
        setItems(classified);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat news feed.'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    if (items.length === 0) return [] as Array<[number, ClassifiedEvent[]]>;
    const latestDay = Math.max(...items.map((item) => item.eventDay));
    const minDay = Math.max(0, latestDay - 30);
    const filtered = items.filter((item) => {
      if (item.eventDay < minDay) return false;
      if (domainFilter !== 'ALL' && item.domain !== domainFilter) return false;
      if (severityFilter !== 'ALL' && item.severity !== severityFilter) return false;
      return true;
    });
    const dayMap = new Map<number, ClassifiedEvent[]>();
    for (const item of filtered) {
      const rows = dayMap.get(item.eventDay) ?? [];
      rows.push(item);
      dayMap.set(item.eventDay, rows);
    }
    return Array.from(dayMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([day, rows]) => [day, rows.sort((a, b) => b.id - a.id)] as [number, ClassifiedEvent[]]);
  }, [domainFilter, items, severityFilter]);

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">News Center V5</p>
        <h1 className="text-lg font-semibold text-text">Event Bus Feed (30 Hari Terakhir)</h1>
        <p className="text-xs text-muted">
          Feed berbasis `social_timeline_events` dengan filter domain, severity, dan grouping tanggal.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">
            Back Dashboard
          </Link>
        </div>
      </div>

      <div className="cyber-panel grid gap-2 p-3 text-xs sm:grid-cols-2">
        <label className="text-muted">
          Filter Domain
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value as DomainFilter)}
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text"
          >
            {DOMAIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted">
          Filter Severity
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-text"
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="text-sm text-muted">Loading news feed...</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="cyber-panel max-h-[32rem] space-y-3 overflow-y-auto p-3 text-xs">
        {!loading && grouped.length === 0 ? <p className="text-muted">Belum ada event sesuai filter.</p> : null}
        {grouped.map(([day, rows]) => (
          <section key={day} className="rounded border border-border/60 bg-bg/60 p-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Day {day}</p>
            <div className="mt-1 space-y-1">
              {rows.map((item) => (
                <article key={item.id} className="rounded border border-border/50 bg-bg/70 px-2 py-1">
                  <p className="text-text">
                    [{item.domain}] {item.title}
                  </p>
                  <p className="text-muted">{item.detail}</p>
                  <p className="text-[11px] text-muted">Severity: {item.severity}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
