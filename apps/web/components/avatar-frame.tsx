import type { NpcV2Profile } from '@/lib/world-v2';

interface AvatarFrameProps {
  name: string;
  subtitle: string;
  uniformTone: string;
  ribbons: string[];
  medals: string[];
  shoulderRankCount?: number;
  details?: string[];
}

export function AvatarFrame({ name, subtitle, uniformTone, ribbons, medals, shoulderRankCount = 2, details = [] }: AvatarFrameProps) {
  return (
    <div className="rounded-md border border-border bg-bg/60 p-4">
      <div className="mt-1 flex flex-wrap items-end gap-4">
        <div className="relative h-64 w-44 overflow-hidden rounded-t-[3rem] border border-border bg-[#253748] shadow-neon">
          <div className="mx-auto mt-3 h-14 w-14 rounded-full bg-[#c49377]" />
          <div className="mx-auto mt-2 h-40 w-32 rounded-md" style={{ background: uniformTone }} />
          <div className="absolute left-2 right-2 top-16 flex justify-between">
            {Array.from({ length: shoulderRankCount }).map((_, idx) => (
              <span key={idx} className="h-3 w-3 rotate-45 border border-accent bg-accent/30" />
            ))}
          </div>
          <div className="absolute right-2 top-24 grid grid-cols-3 gap-1">
            {ribbons.slice(0, 12).map((r, idx) => (
              <div key={`${r}-${idx}`} className="h-2 w-6 rounded-sm border border-border bg-accent/80" title={r} />
            ))}
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <p className="font-semibold text-text">{name}</p>
          <p className="text-muted">{subtitle}</p>
          {details.map((detail) => (
            <p key={detail} className="text-muted">
              {detail}
            </p>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-text">Medals: {medals.join(' · ')}</p>
      <p className="text-xs text-text">Ribbons: {ribbons.join(' · ')}</p>
    </div>
  );
}

export function npcUniformTone(npc: NpcV2Profile) {
  if (npc.branch.includes('NAVY') || npc.branch.includes('AL')) return '#425b70';
  if (npc.status === 'KIA') return '#5c2a3a';
  if (npc.status === 'INJURED') return '#6e5c36';
  return '#4f6159';
}
