import type { NpcV2Profile, RibbonStyle } from '@/lib/world-v2';

interface AvatarFrameProps {
  name: string;
  subtitle: string;
  uniformTone: string;
  ribbons: RibbonStyle[];
  medals: string[];
  shoulderRankCount?: number;
  details?: string[];
}

function ribbonBackground(ribbon: RibbonStyle): string {
  const [c1, c2, c3] = ribbon.colors;
  switch (ribbon.pattern) {
    case 'SOLID':
      return c1;
    case 'CENTER_STRIPE':
      return `linear-gradient(90deg, ${c1} 0 38%, ${c2} 38% 62%, ${c3} 62% 100%)`;
    case 'TRI_BAND':
      return `linear-gradient(90deg, ${c1} 0 33%, ${c2} 33% 66%, ${c3} 66% 100%)`;
    case 'CHEVRON':
      return `repeating-linear-gradient(135deg, ${c1} 0 6px, ${c2} 6px 12px, ${c3} 12px 18px)`;
    case 'CHECKER':
      return `repeating-linear-gradient(45deg, ${c1} 0 4px, ${c2} 4px 8px, ${c3} 8px 12px)`;
    case 'DIAGONAL':
      return `linear-gradient(135deg, ${c1} 0 30%, ${c2} 30% 70%, ${c3} 70% 100%)`;
    default:
      return c1;
  }
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
            {ribbons.slice(0, 12).map((ribbon) => (
              <div
                key={ribbon.id}
                className="h-2 w-6 rounded-sm border border-border"
                style={{ background: ribbonBackground(ribbon) }}
                title={`${ribbon.name} (+${ribbon.influenceBuff} influence)`}
              />
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
      <p className="text-xs text-text">Ribbon buff score: +{ribbons.reduce((sum, ribbon) => sum + ribbon.influenceBuff, 0)} influence</p>
    </div>
  );
}

export function npcUniformTone(npc: NpcV2Profile) {
  if (npc.branch.includes('NAVY') || npc.branch.includes('AL')) return '#425b70';
  if (npc.status === 'KIA') return '#5c2a3a';
  if (npc.status === 'INJURED') return '#6e5c36';
  return '#4f6159';
}
