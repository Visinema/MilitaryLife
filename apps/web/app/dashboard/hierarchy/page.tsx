'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CommandChainOrder, GameSnapshot } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';
import { buildWorldV2 } from '@/lib/world-v2';
import { resolvePlayerAssignment } from '@/lib/player-assignment';
import { useGameStore } from '@/store/game-store';

type SortMode = 'RANK_DESC' | 'AZ' | 'RANK_ASC' | 'DIVISION' | 'MOST_MEDAL';

type MemberView = {
  id: string;
  name: string;
  rank: string;
  role: string;
  division: string;
  subdivision: string;
  unit: string;
  medals: string[];
  ribbonNames: string[];
  commandPower: number;
  type: 'NPC' | 'PLAYER';
};

const RANK_ORDER = [
  'General',
  'Lieutenant General',
  'Major General',
  'Brigadier General',
  'Colonel',
  'Major',
  'Captain',
  'Lieutenant',
  'Warrant Officer',
  'Staff Sergeant',
  'Sergeant',
  'Corporal',
  'Private',
  'Recruit'
];

const RANK_SCORE = new Map(RANK_ORDER.map((rank, idx) => [rank.toLowerCase(), RANK_ORDER.length - idx]));

function rankScore(rank: string): number {
  return RANK_SCORE.get(rank.toLowerCase()) ?? 0;
}

function sortMembers(members: MemberView[], mode: SortMode): MemberView[] {
  const clone = [...members];
  if (mode === 'AZ') {
    return clone.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'RANK_ASC') {
    return clone.sort((a, b) => rankScore(a.rank) - rankScore(b.rank) || a.name.localeCompare(b.name));
  }
  if (mode === 'DIVISION') {
    return clone.sort((a, b) => a.division.localeCompare(b.division) || rankScore(b.rank) - rankScore(a.rank));
  }
  if (mode === 'MOST_MEDAL') {
    return clone.sort((a, b) => b.medals.length - a.medals.length || rankScore(b.rank) - rankScore(a.rank));
  }
  return clone.sort((a, b) => rankScore(b.rank) - rankScore(a.rank) || a.commandPower - b.commandPower);
}

export default function HierarchyPage() {
  const storeSnapshot = useGameStore((state) => state.snapshot);
  const setStoreSnapshot = useGameStore((state) => state.setSnapshot);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(storeSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('RANK_DESC');
  const [expandedFrames, setExpandedFrames] = useState<Record<string, boolean>>({});
  const [chainOrders, setChainOrders] = useState<CommandChainOrder[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [chainBusyOrderId, setChainBusyOrderId] = useState<string | null>(null);
  const [newOrderMessage, setNewOrderMessage] = useState('Instruksi patroli berjenjang: jaga perimeter dan laporkan tiap hop.');
  const [newOrderPriority, setNewOrderPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [newOrderAckWindowDays, setNewOrderAckWindowDays] = useState<number>(2);

  useEffect(() => {
    if (storeSnapshot) {
      setSnapshot(storeSnapshot);
      return;
    }

    api
      .snapshot()
      .then((res) => {
        setSnapshot(res.snapshot);
        setStoreSnapshot(res.snapshot);
      })
      .catch((err: Error) => setError(err.message));
  }, [setStoreSnapshot, storeSnapshot]);

  const world = useMemo(() => (snapshot ? buildWorldV2(snapshot) : null), [snapshot]);
  const playerAssignment = useMemo(() => resolvePlayerAssignment(snapshot), [snapshot]);

  const allMembers = useMemo<MemberView[]>(() => {
    if (!snapshot || !world) return [];

    const player: MemberView = {
      id: 'player-command-slot',
      name: snapshot.playerName,
      rank: snapshot.rankCode,
      role: playerAssignment.positionLabel,
      division: playerAssignment.divisionLabel,
      subdivision: playerAssignment.hasDivisionPlacement ? 'Penempatan awal divisi' : 'Belum bergabung divisi/korps',
      unit: playerAssignment.unitLabel,
      medals: snapshot.playerMedals ?? [],
      ribbonNames: snapshot.playerRibbons ?? [],
      commandPower: 101,
      type: 'PLAYER'
    };

    const npcs: MemberView[] = world.hierarchy.map((npc) => ({
      id: npc.id,
      name: npc.name,
      rank: npc.rank,
      role: npc.role,
      division: npc.division,
      subdivision: npc.subdivision,
      unit: npc.unit,
      medals: npc.medals,
      ribbonNames: npc.ribbons.map((item) => item.name),
      commandPower: npc.commandPower,
      type: 'NPC'
    }));

    return [player, ...npcs];
  }, [playerAssignment, snapshot, world]);

  const sortedMembers = useMemo(() => sortMembers(allMembers, sortMode), [allMembers, sortMode]);

  const groupedFrames = useMemo(() => {
    const groups = new Map<string, MemberView[]>();
    for (const member of sortedMembers) {
      const key = member.division || 'Unassigned Division';
      const row = groups.get(key) ?? [];
      row.push(member);
      groups.set(key, row);
    }

    return Array.from(groups.entries())
      .map(([frame, members]) => ({ frame, members }))
      .sort((a, b) => a.frame.localeCompare(b.frame));
  }, [sortedMembers]);

  useEffect(() => {
    if (groupedFrames.length === 0) return;
    setExpandedFrames((prev) => {
      const next: Record<string, boolean> = {};
      for (const group of groupedFrames) {
        next[group.frame] = prev[group.frame] ?? false;
      }
      if (!Object.values(next).some(Boolean)) {
        next[groupedFrames[0].frame] = true;
      }
      return next;
    });
  }, [groupedFrames]);

  const toggleFrame = (frame: string) => {
    setExpandedFrames((prev) => ({ ...prev, [frame]: !prev[frame] }));
  };

  const refreshSnapshot = () => {
    api
      .snapshot()
      .then((res) => {
        setSnapshot(res.snapshot);
        setStoreSnapshot(res.snapshot);
      })
      .catch((err: Error) => setError(err.message));
  };

  const loadCommandOrders = () => {
    setChainLoading(true);
    setChainError(null);
    api
      .v5CommandChainOrders({ limit: 12 })
      .then((res) => {
        setChainOrders(res.orders);
      })
      .catch((err: Error) => {
        setChainError(err.message);
      })
      .finally(() => {
        setChainLoading(false);
      });
  };

  useEffect(() => {
    loadCommandOrders();
  }, []);

  const createCommandOrder = () => {
    setChainBusyOrderId('NEW');
    setChainError(null);
    api
      .v5CommandChainCreate({
        message: newOrderMessage,
        priority: newOrderPriority,
        ackWindowDays: newOrderAckWindowDays
      })
      .then(() => {
        loadCommandOrders();
      })
      .catch((err: Error) => {
        setChainError(err.message);
      })
      .finally(() => {
        setChainBusyOrderId(null);
      });
  };

  const forwardOrder = (order: CommandChainOrder) => {
    const forwardedToNpcId = order.targetNpcId;
    if (!forwardedToNpcId) {
      setChainError('Order ini tidak memiliki target NPC untuk forward.');
      return;
    }
    setChainBusyOrderId(order.orderId);
    setChainError(null);
    api
      .v5CommandChainForward({
        orderId: order.orderId,
        forwardedToNpcId,
        note: `Forward oleh player ke ${forwardedToNpcId}.`
      })
      .then(() => {
        loadCommandOrders();
      })
      .catch((err: Error) => {
        setChainError(err.message);
      })
      .finally(() => {
        setChainBusyOrderId(null);
      });
  };

  const ackOrder = (orderId: string) => {
    setChainBusyOrderId(orderId);
    setChainError(null);
    api
      .v5CommandChainAck({
        orderId,
        note: 'ACK oleh player command.'
      })
      .then(() => {
        loadCommandOrders();
      })
      .catch((err: Error) => {
        setChainError(err.message);
      })
      .finally(() => {
        setChainBusyOrderId(null);
      });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 cyber-panel p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Cyber Command Chain</p>
          <h1 className="text-lg font-semibold text-text">Hierarchy Realtime · Divisi/Korps/Satuan</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={refreshSnapshot} className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
            Refresh
          </button>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <section className="cyber-panel p-2 text-xs">
        <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Sort Hierarchy</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-5">
          {([
            ['RANK_DESC', 'Pangkat Tertinggi'],
            ['AZ', 'A-Z'],
            ['RANK_ASC', 'Pangkat Terendah'],
            ['DIVISION', 'Divisi/Korps'],
            ['MOST_MEDAL', 'Most Medal']
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`rounded border px-2 py-1 text-[10px] leading-none ${sortMode === mode ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-muted">Loading hierarchy...</p> : null}

      {world ? (
        <section className="cyber-panel p-2 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-text">Frame Divisi/Korps/Satuan (Collapsible)</h2>
          <div className="max-h-[36rem] space-y-1 overflow-y-auto pr-1">
            {groupedFrames.map((group) => {
              const expanded = Boolean(expandedFrames[group.frame]);
              return (
                <div key={group.frame} className="rounded border border-border/60 bg-bg/60">
                  <button
                    type="button"
                    onClick={() => toggleFrame(group.frame)}
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
                  >
                    <span className="truncate text-[10px] uppercase tracking-[0.08em] text-muted">{group.frame}</span>
                    <span className="whitespace-nowrap text-[10px] text-text">{expanded ? 'Collapse' : 'Expand'} · {group.members.length}</span>
                  </button>

                  {expanded ? (
                    <div className="space-y-1 border-t border-border/40 px-1.5 py-1.5">
                      {group.members.map((member) => (
                        <div key={member.id} className="grid gap-1 rounded border border-border/40 px-1.5 py-1 text-[10px] sm:grid-cols-[1.3fr,1fr,1fr,auto]">
                          <p className="truncate leading-tight text-text">
                            {member.name} <span className="text-[10px] text-muted">({member.type})</span>
                          </p>
                          <p className="truncate leading-tight text-muted">{member.rank} · {member.role}</p>
                          <p className="truncate leading-tight text-muted">{member.subdivision} / {member.unit}</p>
                          <p className="text-muted">M:{member.medals.length}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="cyber-panel p-2 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Command Chain Forwarding</p>
          <button onClick={loadCommandOrders} className="rounded border border-border bg-bg px-2 py-1 text-[10px] text-text">
            Refresh Chain
          </button>
        </div>

        <div className="rounded border border-border/60 bg-bg/60 p-2 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted">Create Order</p>
          <textarea
            value={newOrderMessage}
            onChange={(e) => setNewOrderMessage(e.target.value)}
            className="min-h-16 w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-text"
          />
          <div className="grid gap-1 sm:grid-cols-3">
            <label className="text-[10px] text-muted">
              Priority
              <select
                value={newOrderPriority}
                onChange={(e) => setNewOrderPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH')}
                className="mt-1 w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-text"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </label>
            <label className="text-[10px] text-muted">
              Ack Window (day)
              <input
                type="number"
                min={1}
                max={7}
                value={newOrderAckWindowDays}
                onChange={(e) => setNewOrderAckWindowDays(Number(e.target.value))}
                className="mt-1 w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-text"
              />
            </label>
            <div className="flex items-end">
              <button
                onClick={createCommandOrder}
                disabled={chainBusyOrderId === 'NEW'}
                className="w-full rounded border border-accent bg-accent/20 px-2 py-1 text-[11px] text-text disabled:opacity-60"
              >
                {chainBusyOrderId === 'NEW' ? 'Creating...' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>

        {chainLoading ? <p className="text-muted">Loading command-chain orders...</p> : null}
        {chainError ? <p className="text-danger">{chainError}</p> : null}
        {!chainLoading && !chainError && chainOrders.length === 0 ? <p className="text-muted">Belum ada order command-chain.</p> : null}
        <div className="space-y-1">
          {chainOrders.map((order) => {
            const chainPath = Array.isArray(order.commandPayload.chainPathNpcIds)
              ? order.commandPayload.chainPathNpcIds.filter((item): item is string => typeof item === 'string')
              : [];
            const open = order.status === 'PENDING' || order.status === 'FORWARDED';
            return (
              <div key={order.orderId} className={`rounded border px-2 py-1 ${order.status === 'BREACHED' ? 'border-danger/70 bg-danger/10' : 'border-border/60 bg-bg/70'}`}>
                <p className="text-text">{order.orderId} · {order.priority} · {order.status}</p>
                <p className="text-muted text-[10px]">Due Day {order.ackDueDay} | Target {order.targetNpcId ?? '-'} | Path {chainPath.join(' -> ') || '-'}</p>
                <div className="mt-1 flex gap-1">
                  <button
                    onClick={() => ackOrder(order.orderId)}
                    disabled={!open || chainBusyOrderId === order.orderId}
                    className="rounded border border-border bg-panel px-2 py-0.5 text-[10px] text-text disabled:opacity-60"
                  >
                    ACK
                  </button>
                  <button
                    onClick={() => forwardOrder(order)}
                    disabled={!open || !order.targetNpcId || chainBusyOrderId === order.orderId}
                    className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-[10px] text-text disabled:opacity-60"
                  >
                    Forward
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
