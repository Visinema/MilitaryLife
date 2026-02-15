'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

type Track = {
  id: string;
  name: string;
  type: 'SATUAN_TUGAS' | 'KORPS' | 'DIVISI';
  minRankIndex: number;
  needOfficerCert: boolean;
  needHighCommandCert: boolean;
  quiz: Array<{ q: string; a: string }>;
};

const TRACKS: Track[] = [
  {
    id: 'special-forces',
    name: 'Special Forces Task Group',
    type: 'SATUAN_TUGAS',
    minRankIndex: 5,
    needOfficerCert: true,
    needHighCommandCert: false,
    quiz: [
      { q: 'Prioritas saat raid malam?', a: 'silent-entry' },
      { q: 'Unit fallback?', a: 'exfil-route' }
    ]
  },
  {
    id: 'training-command',
    name: 'Training Command Corps',
    type: 'KORPS',
    minRankIndex: 4,
    needOfficerCert: true,
    needHighCommandCert: false,
    quiz: [
      { q: 'Fokus trainer utama?', a: 'combat-readiness' },
      { q: 'KPI utama?', a: 'graduation-quality' }
    ]
  },
  {
    id: 'joint-cyber-division',
    name: 'Joint Cyber Division',
    type: 'DIVISI',
    minRankIndex: 7,
    needOfficerCert: true,
    needHighCommandCert: true,
    quiz: [
      { q: 'Saat breach terdeteksi?', a: 'contain-and-isolate' },
      { q: 'Prioritas chain-of-command?', a: 'report-chief' }
    ]
  }
];

export default function RecruitmentPage() {
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [selected, setSelected] = useState(TRACKS[0].id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) return;
    api.snapshot().then((res) => setSnapshot(res.snapshot)).catch(() => null);
  }, [setSnapshot, snapshot]);

  const track = useMemo(() => TRACKS.find((x) => x.id === selected) ?? TRACKS[0], [selected]);

  const submit = () => {
    if (!snapshot) return;
    const passQuiz = track.quiz.every((item, idx) => (answers[`${track.id}-${idx}`] ?? '').trim().toLowerCase() === item.a);
    const rankOk = (snapshot.rankIndex ?? 0) >= track.minRankIndex;
    const certOfficerOk = !track.needOfficerCert || Boolean(snapshot.academyCertifiedOfficer);
    const certHighOk = !track.needHighCommandCert || Boolean(snapshot.academyCertifiedHighOfficer);

    if (passQuiz && rankOk && certOfficerOk && certHighOk) {
      setResult(`LULUS: ${snapshot.playerName} diterima ke ${track.name}.`);
      return;
    }

    const reasons = [
      !passQuiz ? 'nilai ujian belum lulus' : null,
      !rankOk ? `rank belum memenuhi (min ${track.minRankIndex})` : null,
      !certOfficerOk ? 'butuh sertifikasi Academy Officer' : null,
      !certHighOk ? 'butuh sertifikasi High Command' : null
    ].filter(Boolean);
    setResult(`GAGAL: ${snapshot.playerName} belum memenuhi syarat (${reasons.join(', ')}).`);
  };

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Rekrutmen Satuan/Korps/Divisi</p>
        <h1 className="text-lg font-semibold text-text">Recruitment Board</h1>
        <p className="text-xs text-muted">Nama karakter aktif: <span className="text-text">{snapshot?.playerName ?? '-'}</span></p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard" className="rounded border border-border bg-bg px-3 py-1 text-xs text-text">Back Dashboard</Link>
        </div>
      </div>

      <div className="cyber-panel p-3 text-xs space-y-2">
        <label className="text-muted">Pilih track rekrutmen</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full rounded border border-border bg-bg px-2 py-1 text-text">
          {TRACKS.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}
        </select>

        <p className="text-muted">Persyaratan: min rank {track.minRankIndex}, Officer Cert: {track.needOfficerCert ? 'Ya' : 'Tidak'}, High Command Cert: {track.needHighCommandCert ? 'Ya' : 'Tidak'}</p>

        <div className="space-y-2">
          {track.quiz.map((item, idx) => (
            <div key={idx}>
              <p className="text-text">{idx + 1}. {item.q}</p>
              <input
                value={answers[`${track.id}-${idx}`] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [`${track.id}-${idx}`]: e.target.value }))}
                className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
                placeholder="jawaban"
              />
            </div>
          ))}
        </div>

        <button onClick={submit} className="rounded border border-accent bg-accent/20 px-3 py-1 text-text">Submit Ujian Rekrutmen</button>
        {result ? <p className="text-muted">{result}</p> : null}
      </div>
    </div>
  );
}
