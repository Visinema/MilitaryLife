import Link from 'next/link';
import type { NpcV5Profile, RibbonStyle } from '@/lib/world-v5';

interface AvatarFrameProps {
  name: string;
  subtitle: string;
  uniformTone: string;
  ribbons: RibbonStyle[];
  medals: string[];
  shoulderRankCount?: number;
  details?: string[];
  showQuickLinks?: boolean;
}

function ribbonBackground(ribbon: RibbonStyle): string {
  const [c1, c2, c3] = ribbon.colors;
  switch (ribbon.pattern) {
    case 'SOLID':
      return `linear-gradient(90deg, ${c1}, ${c2})`;
    case 'CENTER_STRIPE':
      return `linear-gradient(90deg, ${c1} 0 40%, ${c2} 40% 60%, ${c3} 60% 100%)`;
    case 'TRI_BAND':
      return `linear-gradient(90deg, ${c1} 0 33%, ${c2} 33% 66%, ${c3} 66% 100%)`;
    case 'CHEVRON':
      return `repeating-linear-gradient(135deg, ${c1} 0 5px, ${c2} 5px 10px, ${c3} 10px 15px)`;
    case 'CHECKER':
      return `repeating-linear-gradient(45deg, ${c1} 0 3px, ${c2} 3px 6px, ${c3} 6px 9px)`;
    case 'DIAGONAL':
      return `linear-gradient(135deg, ${c1} 0 30%, ${c2} 30% 65%, ${c3} 65% 100%)`;
    default:
      return `linear-gradient(90deg, ${c1}, ${c2})`;
  }
}

export function AvatarFrame({ name, subtitle, uniformTone, ribbons, medals, shoulderRankCount = 2, details = [], showQuickLinks = true }: AvatarFrameProps) {
  return (
    <div className="rounded-md border border-border bg-bg/60 p-2.5">
      <div className="mt-1 flex flex-wrap items-end gap-2.5">
        <div className="relative h-48 w-32 overflow-hidden rounded-t-[2.2rem] border border-border bg-[#2a3f53] shadow-neon">
          <div className="mx-auto mt-2 h-11 w-11 rounded-full bg-[#c49377]" />
          <div className="absolute left-1/2 top-[54px] h-32 w-24 -translate-x-1/2 rounded-md" style={{ background: uniformTone }} />
          <div className="absolute left-2 right-2 top-12 flex justify-between">
            {Array.from({ length: shoulderRankCount }).map((_, idx) => (
              <span key={idx} className="h-2.5 w-2.5 rotate-45 border border-accent bg-accent/30" />
            ))}
          </div>
          <div className="absolute left-1/2 top-[92px] grid -translate-x-1/2 grid-cols-5 gap-[1px] rounded border border-border/60 bg-black/20 p-[2px]">
            {ribbons.slice(0, 10).map((ribbon) => (
              <div
                key={ribbon.id}
                className="h-[5px] w-[11px] rounded-[1px] border border-border/70"
                style={{ background: ribbonBackground(ribbon) }}
                title={`${ribbon.name} (+${ribbon.influenceBuff} influence)`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1 text-xs">
          <p className="text-sm font-semibold text-text">{name}</p>
          <p className="text-muted">{subtitle}</p>
          <div className="grid gap-x-2.5 gap-y-0.5 sm:grid-cols-2">
            {details.map((detail) => (
              <p key={detail} className="text-muted">
                {detail}
              </p>
            ))}
          </div>
          {showQuickLinks ? (
            <div className="grid grid-cols-3 gap-1 pt-0.5">
              <Link href="/dashboard/training" className="rounded border border-border/80 bg-panel px-1.5 py-1 text-center text-[10px] text-text hover:border-accent">Training</Link>
              <Link href="/dashboard/deployment" className="rounded border border-border/80 bg-panel px-1.5 py-1 text-center text-[10px] text-text hover:border-accent">Deploy</Link>
              <Link href="/dashboard/career" className="rounded border border-border/80 bg-panel px-1.5 py-1 text-center text-[10px] text-text hover:border-accent">Career</Link>
            </div>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-text">Medals: {medals.join(' · ')}</p>
      <p className="text-[11px] text-text">Ribbon buff score: +{ribbons.reduce((sum, ribbon) => sum + ribbon.influenceBuff, 0)} influence</p>
    </div>
  );
}

export function npcUniformTone(npc: NpcV5Profile) {
  if (npc.branch.includes('NAVY') || npc.branch.includes('AL')) return '#425b70';
  if (npc.status === 'KIA') return '#5c2a3a';
  if (npc.status === 'INJURED') return '#6e5c36';
  return '#4f6159';
}
