'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import type { CommandChainOrder, DomOperationCycle, ExpansionStateV51 } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

export default function DivisionOpsPage() {
  const [expansion, setExpansion] = useState<ExpansionStateV51 | null>(null);
  const [cycle, setCycle] = useState<DomOperationCycle | null>(null);
  const [orders, setOrders] = useState<CommandChainOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [message, setMessage] = useState('');

  const [targetDivision, setTargetDivision] = useState(REGISTERED_DIVISIONS[0]?.name ?? '');
  const [orderMessage, setOrderMessage] = useState('Lakukan sinkronisasi komando unit, submit ACK chain sebelum due day.');

  const load = async () => {
    setLoading(true);
    try {
      const [expansionRes, cycleRes, ordersRes] = await Promise.all([
        api.v5ExpansionState(),
        api.v5DomCycleCurrent(),
        api.v5CommandChainOrders({ limit: 60 })
      ]);
      setExpansion(expansionRes.state);
      setCycle(cycleRes.cycle);
      setOrders(ordersRes.orders);
      setMessage('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal memuat data Division Ops V5.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const npcOnlySessions = useMemo(
    () =>
      (cycle?.sessions ?? [])
        .filter((session) => session.participantMode === 'NPC_ONLY' && session.status !== 'COMPLETED')
        .sort((a, b) => a.sessionNo - b.sessionNo),
    [cycle?.sessions]
  );

  const executeNpcOnlySessions = async () => {
    if (npcOnlySessions.length === 0) {
      setMessage('Tidak ada sesi NPC_ONLY yang perlu dieksekusi.');
      return;
    }
    setExecuting(true);
    setMessage('');
    try {
      let latestCycle = cycle;
      for (const session of npcOnlySessions) {
        const response = await api.v5DomExecuteSession(session.sessionId);
        latestCycle = response.cycle;
      }
      setCycle(latestCycle);
      setMessage(`Berhasil mengeksekusi ${npcOnlySessions.length} sesi NPC_ONLY.`);
      const refreshedOrders = await api.v5CommandChainOrders({ limit: 60 });
      setOrders(refreshedOrders.orders);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Eksekusi sesi NPC_ONLY gagal.');
    } finally {
      setExecuting(false);
    }
  };

  const createOrder = async () => {
    setCreatingOrder(true);
    setMessage('');
    try {
      const response = await api.v5CommandChainCreate({
        targetDivision: targetDivision.trim() || undefined,
        message: orderMessage.trim(),
        priority: 'MEDIUM',
        ackWindowDays: 2
      });
      setOrders((prev) => [response.order, ...prev].slice(0, 80));
      setMessage(`Order ${response.order.orderId} berhasil dibuat untuk divisi ${targetDivision}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Gagal membuat order command chain.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const openOrders = orders.filter((item) => item.status === 'PENDING' || item.status === 'FORWARDED').length;
  const breachedOrders = orders.filter((item) => item.status === 'BREACHED').length;

  return (
    <div className="space-y-3">
      <div className="cyber-panel p-3 text-[11px]">
        <h1 className="text-sm font-semibold text-text">Division Operations V5</h1>
        <p className="text-muted">Panel operasi divisi berbasis DOM cycle + command chain forwarding.</p>
        <Link href="/dashboard" className="mt-1 inline-block rounded border border-border bg-bg px-2 py-1 text-text">
          Back Dashboard
        </Link>
      </div>

      <div className="cyber-panel space-y-2 p-3 text-[11px]">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-border bg-panel px-2 py-1 text-text disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Refresh State'}
          </button>
          <button
            onClick={() => void executeNpcOnlySessions()}
            disabled={executing || npcOnlySessions.length === 0}
            className="rounded border border-emerald-500 bg-emerald-600 px-2 py-1 text-white disabled:opacity-60"
          >
            {executing ? 'Executing...' : `Execute NPC Sessions (${npcOnlySessions.length})`}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Stabilitas Negara: <span className="text-text">{expansion?.governanceSummary?.nationalStability ?? 0}%</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Stabilitas Militer: <span className="text-text">{expansion?.governanceSummary?.militaryStability ?? 0}%</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Kas Militer: <span className="text-text">${Math.round((expansion?.governanceSummary?.militaryFundCents ?? 0) / 100).toLocaleString()}</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Korupsi: <span className="text-text">{expansion?.governanceSummary?.corruptionRisk ?? 0}%</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Open Orders: <span className="text-text">{openOrders}</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Breached Orders: <span className="text-text">{breachedOrders}</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Threat Raider: <span className="text-text">{expansion?.raiderThreat?.threatLevel ?? 'LOW'}</span></div>
          <div className="rounded border border-border/60 bg-bg/60 px-2 py-1">Days to Raider: <span className="text-text">{expansion?.raiderThreat?.daysUntilNext ?? '-'}</span></div>
        </div>
      </div>

      <div className="cyber-panel space-y-2 p-3 text-[11px]">
        <p className="font-semibold text-text">Buat Order Komando Berantai</p>
        <div className="grid gap-1 sm:grid-cols-[1fr,2fr,auto]">
          <select
            value={targetDivision}
            onChange={(event) => setTargetDivision(event.target.value)}
            className="rounded border border-border bg-bg px-2 py-1 text-text"
          >
            {REGISTERED_DIVISIONS.map((division) => (
              <option key={division.id} value={division.name}>
                {division.name}
              </option>
            ))}
          </select>
          <input
            value={orderMessage}
            onChange={(event) => setOrderMessage(event.target.value)}
            maxLength={280}
            className="rounded border border-border bg-bg px-2 py-1 text-text"
            placeholder="Instruksi order"
          />
          <button
            onClick={() => void createOrder()}
            disabled={creatingOrder || orderMessage.trim().length < 12}
            className="rounded border border-accent bg-accent/20 px-2 py-1 text-text disabled:opacity-60"
          >
            {creatingOrder ? 'Submitting...' : 'Create Order'}
          </button>
        </div>
      </div>

      <div className="cyber-panel max-h-[54vh] space-y-1 overflow-y-auto p-3 text-[11px]">
        <p className="font-semibold text-text">Recent Command Chain Orders</p>
        {orders.length === 0 ? <p className="text-muted">Belum ada order.</p> : null}
        {orders.slice(0, 30).map((order) => (
          <div key={order.orderId} className="rounded border border-border/60 bg-bg/70 p-2">
            <p className="text-text">{order.orderId} � {order.priority} � {order.status}</p>
            <p className="text-muted">Issued day {order.issuedDay} � Due day {order.ackDueDay} � Target divisi: {order.targetDivision ?? '-'}</p>
          </div>
        ))}
      </div>

      {message ? <p className="text-[11px] text-muted">{message}</p> : null}
    </div>
  );
}