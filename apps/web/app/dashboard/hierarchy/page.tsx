'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandChainOrder, GameSnapshot, NpcRuntimeState } from '@mls/shared/game-types';
import { universalRankLabelFromIndex } from '@mls/shared/ranks';
import { api } from '@/lib/api-client';
import { resolvePlayerAssignment } from '@/lib/player-assignment';
import { useGameStore } from '@/store/game-store';

type SortMode = 'RANK_DESC' | 'AZ' | 'RANK_ASC' | 'DIVISION';

type MemberView = {
  id: string;
  name: string;
  rankIndex: number;
  rankLabel: string;
  role: string;
  division: string;
  unit: string;
  status: string;
  commandPower: number;
  type: 'PLAYER' | 'NPC';
};

function sortMembers(members: MemberView[], mode: SortMode): MemberView[] {
  const clone = [...members];
  if (mode === 'AZ') {
    return clone.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'RANK_ASC') {
    return clone.sort((a, b) => a.rankIndex - b.rankIndex || a.name.localeCompare(b.name));
  }
  if (mode === 'DIVISION') {
    return clone.sort((a, b) => a.division.localeCompare(b.division) || b.rankIndex - a.rankIndex);
  }
  return clone.sort((a, b) => b.rankIndex - a.rankIndex || b.commandPower - a.commandPower);
}

function npcCommandPower(npc: NpcRuntimeState): number {
  return Math.max(0, Math.min(100, Math.round((npc.leadership * 0.35) + (npc.competence * 0.3) + (npc.resilience * 0.2) + (npc.promotionPoints * 0.05))));
}

export default function HierarchyPage() {
  const storeSnapshot = useGameStore((state) => state.snapshot);
  const setStoreSnapshot = useGameStore((state) => state.setSnapshot);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(storeSnapshot);
  const [npcs, setNpcs] = useState<NpcRuntimeState[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('RANK_DESC');
  const [error, setError] = useState<string | null>(null);
  const [chainOrders, setChainOrders] = useState<CommandChainOrder[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [chainBusyOrderId, setChainBusyOrderId] = useState<string | null>(null);
  const [newOrderMessage, setNewOrderMessage] = useState('Instruksi patroli berjenjang: jaga perimeter dan laporkan tiap hop.');
  const [newOrderPriority, setNewOrderPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [newOrderAckWindowDays, setNewOrderAckWindowDays] = useState<number>(2);

  const loadData = useCallback(async () => {
    const [snapshotRes, npcRes] = await Promise.all([
      api.snapshot(),
      api.v5Npcs({ limit: 120 })
    ]);
    setSnapshot(snapshotRes.snapshot);
    setStoreSnapshot(snapshotRes.snapshot);
    setNpcs(npcRes.items);
  }, [setStoreSnapshot]);

  useEffect(() => {
    loadData().catch((err: Error) => setError(err.message));
  }, [loadData]);

  const loadCommandOrders = useCallback(() => {
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
  }, []);

  useEffect(() => {
    loadCommandOrders();
  }, [loadCommandOrders]);

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

  const playerAssignment = useMemo(() => resolvePlayerAssignment(snapshot), [snapshot]);

  const allMembers = useMemo<MemberView[]>(() => {
    if (!snapshot) return [];

    const player: MemberView = {
      id: 'player-command-slot',
      name: snapshot.playerName,
      rankIndex: snapshot.rankIndex ?? 0,
      rankLabel: universalRankLabelFromIndex(snapshot.rankIndex ?? 0),
      role: playerAssignment.positionLabel,
      division: playerAssignment.divisionLabel,
      unit: playerAssignment.unitLabel,
      status: 'ACTIVE',
      commandPower: 100,
      type: 'PLAYER'
    };

    const npcRows: MemberView[] = npcs.map((npc) => ({
      id: npc.npcId,
      name: npc.name,
      rankIndex: npc.rankIndex,
      rankLabel: universalRankLabelFromIndex(npc.rankIndex),
      role: npc.position,
      division: npc.division,
      unit: npc.unit,
      status: npc.status,
      commandPower: npcCommandPower(npc),
      type: 'NPC'
    }));

    return [player, ...npcRows];
  }, [npcs, playerAssignment, snapshot]);

  const grouped = useMemo(() => {
    const sorted = sortMembers(allMembers, sortMode);
    const map = new Map<string, MemberView[]>();
    for (const member of sorted) {
      const key = member.division || 'Nondivisi';
      const rows = map.get(key) ?? [];
      rows.push(member);
      map.set(key, rows);
    }
    return Array.from(map.entries())
      .map(([division, members]) => ({ division, members }))
      .sort((a, b) => a.division.localeCompare(b.division));
  }, [allMembers, sortMode]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 cyber-panel p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">V5 Runtime Hierarchy</p>
          <h1 className="text-lg font-semibold text-text">Hierarchy Realtime Divisi dan Personel</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              loadData().catch((err: Error) => setError(err.message));
            }}
            className="rounded border border-border bg-bg px-3 py-2 text-xs text-text"
          >
            Refresh
          </button>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-2 text-xs text-text">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <section className="cyber-panel p-2 text-xs">
        <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Sort Hierarchy</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-4">
          {([
            ['RANK_DESC', 'Rank High'],
            ['AZ', 'A-Z'],
            ['RANK_ASC', 'Rank Low'],
            ['DIVISION', 'Division']
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

      {snapshot ? (
        <section className="cyber-panel p-2 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-text">Frame Divisi dan Satuan (V5 Runtime)</h2>
          <div className="max-h-[38rem] space-y-1 overflow-y-auto pr-1">
            {grouped.map((group) => (
              <div key={group.division} className="rounded border border-border/60 bg-bg/60">
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="truncate text-[10px] uppercase tracking-[0.08em] text-muted">{group.division}</span>
                  <span className="whitespace-nowrap text-[10px] text-text">{group.members.length} personel</span>
                </div>
                <div className="space-y-1 border-t border-border/40 px-1.5 py-1.5">
                  {group.members.map((member) => (
                    <div key={member.id} className="grid gap-1 rounded border border-border/40 px-1.5 py-1 text-[10px] sm:grid-cols-[1.4fr,1fr,1fr,auto]">
                      <p className="truncate leading-tight text-text">
                        {member.name} <span className="text-muted">({member.type})</span>
                      </p>
                      <p className="truncate leading-tight text-muted">{member.rankLabel} | {member.role}</p>
                      <p className="truncate leading-tight text-muted">{member.unit}</p>
                      <p className="text-muted">{member.status}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
                <p className="text-text">{order.orderId} | {order.priority} | {order.status}</p>
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
