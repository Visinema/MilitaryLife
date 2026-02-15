'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { GameSnapshot } from '@mls/shared/game-types';
import { api } from '@/lib/api-client';
import { buildWorldV2 } from '@/lib/world-v2';
import { useGameStore } from '@/store/game-store';

export default function HierarchyPage() {
  const storeSnapshot = useGameStore((state) => state.snapshot);
  const setStoreSnapshot = useGameStore((state) => state.setSnapshot);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(storeSnapshot);
  const [error, setError] = useState<string | null>(null);

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
  const hierarchy = world?.hierarchy ?? [];

  const internalHierarchy = useMemo(() => {
    const groups = new Map<string, Array<{ name: string; role: string; unit: string; rank: string }>>();
    for (const npc of hierarchy) {
      const key = npc.division;
      const row = groups.get(key) ?? [];
      row.push({ name: npc.name, role: npc.role, unit: npc.unit, rank: npc.rank });
      groups.set(key, row);
    }
    return Array.from(groups.entries()).map(([division, members]) => ({ division, members: members.slice(0, 8) }));
  }, [hierarchy]);


  const refreshSnapshot = () => {
    api
      .snapshot()
      .then((res) => {
        setSnapshot(res.snapshot);
        setStoreSnapshot(res.snapshot);
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between cyber-panel p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Cyber Command Chain</p>
          <h1 className="text-lg font-semibold text-text">Hierarchy & Smart NPC Command Chain</h1>
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

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-muted">Loading hierarchy...</p> : null}

      {world ? (
        <>
        <div className="grid grid-cols-2 gap-2 cyber-panel p-3 text-xs text-muted sm:grid-cols-5">
          <p>
            Active: <span className="text-text">{world.stats.active}</span>
          </p>
          <p>
            Injured: <span className="text-text">{world.stats.injured}</span>
          </p>
          <p>
            Reserve: <span className="text-text">{world.stats.reserve}</span>
          </p>
          <p>
            KIA: <span className="text-text">{world.stats.kia}</span>
          </p>
          <p>
            Replacements: <span className="text-text">{world.stats.replacementsThisCycle}</span>
          </p>
        </div>
        <div className="cyber-panel p-3 text-xs text-muted">
          Raider Threat: <span className="text-text">{world.missionBrief.raiderThreatLevel}</span> · Raider Team Ready: <span className="text-text">{world.missionBrief.raiderTeam.length}</span>
        </div>
        </>
      ) : null}


      {world ? (
        <section className="cyber-panel p-3 text-xs space-y-1">
          <h2 className="text-sm font-semibold text-text">Brainstorm: Saat Raider Menyerang Markas</h2>
          <p className="text-muted">Jika threat {world.missionBrief.raiderThreatLevel}, raider team bisa memulai fase: infiltrasi perimeter → sabotase komunikasi → breach gudang amunisi.</p>
          <p className="text-muted">Inovasi: aktifkan sistem counter-raider AI, alarm zonal, lockdown sektor otomatis, dan log taktis real-time per unit.</p>
          <p className="text-muted">Inovasi lanjutan: evaluasi KPI anti-raid (waktu respon, korban, kerusakan aset) untuk rotasi jabatan komandan divisi/satuan.</p>
        </section>
      ) : null}

      <section className="cyber-panel space-y-2 p-3 text-xs">
        <h2 className="text-sm font-semibold text-text">Brainstorm Expansi Divisi / Satuan / Unit / Jabatan</h2>
        <ul className="list-disc space-y-1 pl-4 text-muted">
          <li>Tambah struktur 4 level: Branch → Divisi → Satuan → Unit kecil (platoon/squad) dengan kapasitas personel dinamis.</li>
          <li>Setiap Divisi memiliki slot jabatan (Commander, XO, Ops, Intel, Logistics, Medical) yang bisa diisi NPC/player.</li>
          <li>Buat sistem rotasi jabatan berkala berbasis KPI: mission success, casualties, morale, budget efficiency.</li>
          <li>Aktifkan mutasi lintas cabang Army/Navy untuk jabatan joint-task-force saat rank tinggi.</li>
          <li>Tambahkan UI peta hierarki agar promosi dan penggantian jabatan terlihat real-time.</li>
        </ul>
      </section>


      {internalHierarchy.length > 0 ? (
        <section className="cyber-panel p-3 text-xs space-y-2">
          <h2 className="text-sm font-semibold text-text">Hierarki Internal Divisi / Satuan / Korps</h2>
          {internalHierarchy.map((group) => (
            <div key={group.division} className="rounded border border-border/60 bg-bg/60 p-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted">{group.division}</p>
              <div className="mt-1 space-y-1">
                {group.members.map((member) => (
                  <p key={`${group.division}-${member.name}`} className="text-muted">
                    {member.rank} · {member.name} — {member.role} ({member.unit})
                  </p>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hierarchy.map((npc, idx) => (
          <article key={npc.id} className="cyber-panel p-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Tier {idx + 1} Command</p>
            <h2 className="text-sm font-semibold text-text">{npc.name}</h2>
            <p className="mt-1 text-xs text-muted">{npc.role}</p>
            <p className="text-xs text-muted">
              {npc.rank} · {npc.branch}
            </p>
            <p className="text-xs text-muted">
              {npc.division} / {npc.subdivision} / {npc.unit}
            </p>
            <p className="mt-2 text-xs text-text">Medals: {npc.medals.join(' · ')}</p>
            <p className="text-xs text-text">Ribbons: {npc.ribbons.map((r) => r.name).join(' · ')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
