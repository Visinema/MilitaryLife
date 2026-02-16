'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

type Question = {
  id: string;
  prompt: string;
  choices: string[];
  answer: string;
};

type InternalNode = {
  level: 'DIVISI' | 'SATUAN' | 'KORPS';
  name: string;
  roles: string[];
};

type Track = {
  id: string;
  name: string;
  type: 'SATUAN_TUGAS' | 'KORPS' | 'DIVISI';
  minRankIndex: number;
  needOfficerCert: boolean;
  needHighCommandCert: boolean;
  assets: string[];
  internalHierarchy: InternalNode[];
  questions: Question[];
};

const TRACKS: Track[] = [
  {
    id: 'special-forces',
    name: 'Special Forces Task Group',
    type: 'SATUAN_TUGAS',
    minRankIndex: 5,
    needOfficerCert: true,
    needHighCommandCert: false,
    assets: ['Night Vision Suite', 'Silent Insertion Vehicle', 'Breach Drone'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Special Operations Division', roles: ['Commander', 'XO', 'Intel Lead'] },
      { level: 'SATUAN', name: 'Rapid Breach Unit', roles: ['Team Lead', 'Breach Specialist', 'Medic'] },
      { level: 'KORPS', name: 'Deep Recon Corps', roles: ['Recon Sniper', 'Signal Scout', 'Forward Observer'] }
    ],
    questions: [
      { id: 'sf-1', prompt: 'Prioritas infiltrasi malam?', choices: ['Noise discipline', 'Open assault', 'Heavy convoy', 'Delay until sunrise'], answer: 'Noise discipline' },
      { id: 'sf-2', prompt: 'Fallback saat komunikasi putus?', choices: ['Pre-brief exfil corridor', 'Standby tanpa arah', 'Retreat random', 'Broadcast open channel'], answer: 'Pre-brief exfil corridor' },
      { id: 'sf-3', prompt: 'Urutan raid yang benar?', choices: ['Recon → isolate → breach', 'Breach → recon', 'Random attack', 'Only hold perimeter'], answer: 'Recon → isolate → breach' },
      { id: 'sf-4', prompt: 'KPI utama satgas elit?', choices: ['Objective success + low casualty', 'Ammo spend', 'Durasi briefing', 'Jumlah kendaraan'], answer: 'Objective success + low casualty' }
    ]
  },
  {
    id: 'military-police-division',
    name: 'Military Police Division',
    type: 'DIVISI',
    minRankIndex: 4,
    needOfficerCert: true,
    needHighCommandCert: false,
    assets: ['Detention Block Ops Kit', 'Route Security Fleet', 'Forensic Field Lab'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Military Police HQ', roles: ['Provost Marshal', 'Deputy Marshal', 'Legal Ops'] },
      { level: 'SATUAN', name: 'Base Law Enforcement Unit', roles: ['Patrol Commander', 'Evidence Officer', 'Custody Officer'] },
      { level: 'KORPS', name: 'Security Escort Corps', roles: ['Escort Lead', 'Route Intel', 'Rapid Arrest Team'] }
    ],
    questions: [
      { id: 'mp-1', prompt: 'Tindakan pertama saat pelanggaran disiplin?', choices: ['Secure scene and record', 'Use force immediately', 'Ignore minor issue', 'Send to frontline'], answer: 'Secure scene and record' },
      { id: 'mp-2', prompt: 'KPI keberhasilan polisi militer?', choices: ['Incident resolution quality', 'Total punishment', 'Vehicle speed', 'Ammo usage'], answer: 'Incident resolution quality' },
      { id: 'mp-3', prompt: 'Prioritas konvoi tahanan?', choices: ['Route security + custody protocol', 'No escort', 'Public route open', 'Single driver only'], answer: 'Route security + custody protocol' },
      { id: 'mp-4', prompt: 'Jika bukti digital ditemukan?', choices: ['Preserve chain of custody', 'Delete quickly', 'Share publicly', 'Delay reporting'], answer: 'Preserve chain of custody' }
    ]
  },
  {
    id: 'armored-division',
    name: 'Armored Division',
    type: 'DIVISI',
    minRankIndex: 5,
    needOfficerCert: true,
    needHighCommandCert: false,
    assets: ['MBT Squadron', 'Heavy Recovery Vehicle', 'Armor Simulation Grid'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Armored Command', roles: ['Division Commander', 'Ops Chief', 'Logistics Chief'] },
      { level: 'SATUAN', name: 'Tank Battalion Alpha', roles: ['Battalion XO', 'Platoon Lead', 'Fire Control Officer'] },
      { level: 'KORPS', name: 'Mechanized Support Corps', roles: ['Engineer Support', 'Fuel Supervisor', 'Recovery Crew Lead'] }
    ],
    questions: [
      { id: 'ar-1', prompt: 'Saat armor breakthrough, prioritas?', choices: ['Maintain fuel + flank security', 'Split unsupported', 'Stop all movement', 'Ignore recon'], answer: 'Maintain fuel + flank security' },
      { id: 'ar-2', prompt: 'Kapan gunakan heavy recovery?', choices: ['When disabled armor blocks lane', 'At mission start always', 'Never', 'Only for drills'], answer: 'When disabled armor blocks lane' },
      { id: 'ar-3', prompt: 'KPI armored readiness?', choices: ['Operational tanks + repair time', 'Total horn usage', 'Longest idle time', 'Uniform color'], answer: 'Operational tanks + repair time' },
      { id: 'ar-4', prompt: 'Pairing ideal untuk armor push?', choices: ['Recon + air-defense cover', 'No escort', 'Only medics', 'Civil convoy'], answer: 'Recon + air-defense cover' }
    ]
  },
  {
    id: 'air-defense-division',
    name: 'Air Defense Division',
    type: 'DIVISI',
    minRankIndex: 5,
    needOfficerCert: true,
    needHighCommandCert: true,
    assets: ['SAM Battery', 'Radar Mesh', 'EW Counter-UAV Suite'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Air Defense HQ', roles: ['Air Defense Commander', 'Radar Director', 'EW Lead'] },
      { level: 'SATUAN', name: 'Missile Intercept Unit', roles: ['Battery Chief', 'Targeting Officer', 'Launcher Crew'] },
      { level: 'KORPS', name: 'Counter-UAV Corps', roles: ['Drone Hunter Lead', 'Signal Jammer', 'Net Capture Team'] }
    ],
    questions: [
      { id: 'ad-1', prompt: 'Urutan intercept ancaman udara?', choices: ['Detect → classify → engage', 'Engage without detect', 'Evacuate all units', 'Wait for hit'], answer: 'Detect → classify → engage' },
      { id: 'ad-2', prompt: 'KPI air defense terbaik?', choices: ['Intercept rate + false positive low', 'Missile usage only', 'Radar brightness', 'Shift duration'], answer: 'Intercept rate + false positive low' },
      { id: 'ad-3', prompt: 'Jika drone swarm datang?', choices: ['Layered EW + missile discipline', 'Fire all at once', 'Power down radar', 'Retreat no report'], answer: 'Layered EW + missile discipline' },
      { id: 'ad-4', prompt: 'Kapan status red alert?', choices: ['Validated inbound threat', 'Any radio ping', 'Morning roll call', 'After lunch'], answer: 'Validated inbound threat' }
    ]
  },
  {
    id: 'engineering-command',
    name: 'Combat Engineering Command',
    type: 'KORPS',
    minRankIndex: 4,
    needOfficerCert: true,
    needHighCommandCert: false,
    assets: ['Bridge Deployment Kit', 'Demolition Charge Vault', 'Fortification Drone'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Engineer Command HQ', roles: ['Chief Engineer', 'Ops Planner', 'Safety Officer'] },
      { level: 'SATUAN', name: 'Field Construction Unit', roles: ['Site Commander', 'Bridge Specialist', 'Route Surveyor'] },
      { level: 'KORPS', name: 'Explosive Ordnance Corps', roles: ['EOD Lead', 'Demolition Tech', 'Containment Team'] }
    ],
    questions: [
      { id: 'en-1', prompt: 'Prioritas engineer saat support raid?', choices: ['Mobility corridor first', 'Decorate base', 'Random excavation', 'No safety check'], answer: 'Mobility corridor first' },
      { id: 'en-2', prompt: 'KPI engineer command?', choices: ['Build speed + safety compliance', 'Most explosives spent', 'Loudest equipment', 'Longest break'], answer: 'Build speed + safety compliance' },
      { id: 'en-3', prompt: 'Saat jembatan darurat gagal?', choices: ['Deploy secondary span protocol', 'Abort all comms', 'Ignore crossing', 'Use civilian road only'], answer: 'Deploy secondary span protocol' },
      { id: 'en-4', prompt: 'EOD engagement rule?', choices: ['Isolate + identify + neutralize', 'Touch immediately', 'Skip report', 'Open detonation in crowd'], answer: 'Isolate + identify + neutralize' }
    ]
  },
  {
    id: 'medical-support-division',
    name: 'Medical Support Division',
    type: 'DIVISI',
    minRankIndex: 3,
    needOfficerCert: true,
    needHighCommandCert: false,
    assets: ['Forward Trauma Bay', 'Medevac Detachment', 'Field Bio-monitor Grid'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Medical Command HQ', roles: ['Chief Medical Officer', 'Triage Lead', 'Recovery Director'] },
      { level: 'SATUAN', name: 'Frontline Triage Unit', roles: ['Medic Captain', 'Trauma Specialist', 'Evac Coordinator'] },
      { level: 'KORPS', name: 'Preventive Health Corps', roles: ['Epidemiology Lead', 'Sanitation Officer', 'Resilience Coach'] }
    ],
    questions: [
      { id: 'md-1', prompt: 'Prioritas triage tempur?', choices: ['Life-saving first by severity', 'By rank first', 'By arrival random', 'Delay all care'], answer: 'Life-saving first by severity' },
      { id: 'md-2', prompt: 'KPI medical support?', choices: ['Survival rate + evacuation speed', 'Bandage count', 'Ambulance color', 'Shift music'], answer: 'Survival rate + evacuation speed' },
      { id: 'md-3', prompt: 'Saat mass casualty?', choices: ['Activate surge protocol', 'Stop intake', 'Close comms', 'Only treat officers'], answer: 'Activate surge protocol' },
      { id: 'md-4', prompt: 'Langkah preventif utama?', choices: ['Daily bio-monitor screening', 'No hydration plan', 'Ignore fatigue', 'Cancel debrief'], answer: 'Daily bio-monitor screening' }
    ]
  },
  {
    id: 'signal-cyber-corps',
    name: 'Signal & Cyber Corps',
    type: 'KORPS',
    minRankIndex: 6,
    needOfficerCert: true,
    needHighCommandCert: true,
    assets: ['Secure Comms Backbone', 'Blue-Team SOC', 'Tactical Encryption Node'],
    internalHierarchy: [
      { level: 'DIVISI', name: 'Signal Cyber HQ', roles: ['Cyber Director', 'Signal Commander', 'Threat Analyst'] },
      { level: 'SATUAN', name: 'Network Defense Unit', roles: ['Incident Commander', 'SOC Operator', 'Patch Lead'] },
      { level: 'KORPS', name: 'Offensive Security Corps', roles: ['Red Team Lead', 'Exploit Specialist', 'Containment Liaison'] }
    ],
    questions: [
      { id: 'cy-1', prompt: 'Saat intrusi aktif?', choices: ['Contain and isolate segment', 'Reboot all blindly', 'Publish credentials', 'Disable logging'], answer: 'Contain and isolate segment' },
      { id: 'cy-2', prompt: 'KPI signal/cyber?', choices: ['Uptime + breach containment time', 'Cable length', 'Keyboard speed', 'Server color'], answer: 'Uptime + breach containment time' },
      { id: 'cy-3', prompt: 'Kapan aktifkan fallback channel?', choices: ['Primary comm compromised', 'Normal operations', 'During lunch', 'At random'], answer: 'Primary comm compromised' },
      { id: 'cy-4', prompt: 'Prinsip patch management?', choices: ['Risk-based priority with rollback plan', 'Patch never', 'Patch without backup', 'Patch public network first'], answer: 'Risk-based priority with rollback plan' }
    ]
  }
];

function rotateChoices(choices: string[], seed: number): string[] {
  if (choices.length <= 1) return choices;
  const shift = Math.abs(seed) % choices.length;
  return [...choices.slice(shift), ...choices.slice(0, shift)];
}

export default function RecruitmentPage() {
  const router = useRouter();
  const snapshot = useGameStore((s) => s.snapshot);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const [selected, setSelected] = useState(TRACKS[0].id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, unknown> | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (snapshot) return;
    api.snapshot().then((res) => setSnapshot(res.snapshot)).catch(() => null);
  }, [setSnapshot, snapshot]);

  const track = useMemo(() => TRACKS.find((x) => x.id === selected) ?? TRACKS[0], [selected]);

  const dynamicQuestions = useMemo(() => {
    const seed = (snapshot?.gameDay ?? 0) + track.id.length;
    return track.questions
      .map((question, idx) => ({ question, weight: Math.abs((seed + idx * 13) % 97) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map(({ question }, idx) => ({
        ...question,
        choices: rotateChoices(question.choices, seed + idx * 7)
      }));
  }, [snapshot?.gameDay, track]);

  useEffect(() => {
    setAnswers({});
    setResult(null);
    setErrorDetails(null);
    setExpandedNodes(() => {
      const first = track.internalHierarchy[0]?.name;
      return first ? { [first]: true } : {};
    });
  }, [track.id]);

  const submit = async () => {
    if (!snapshot) return;
    try {
      const response = await api.recruitmentApply({
        trackId: track.id,
        answers
      });
      setSnapshot(response.snapshot);
      setErrorDetails(null);
      setResult(`LULUS: ${snapshot.playerName} diterima ke ${track.name}. Sertifikasi + surat mutasi masuk inventori.`);
      window.setTimeout(() => router.replace('/dashboard'), 450);
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === 'object') {
        const details = err.details as Record<string, unknown>;
        const diagnostics = [
          `rankOk=${String(details.rankOk)}`,
          `officerOk=${String(details.officerOk)}`,
          `highOk=${String(details.highOk)}`,
          `examPass=${String(details.examPass)}`,
          `answered=${String(details.answeredCount ?? '-')}`,
          `correct=${String(details.correctCount ?? '-')}`
        ].join(', ');
        setResult(`GAGAL: ${snapshot.playerName} belum memenuhi syarat (${err.message}). Detail: ${diagnostics}`);
        return;
      }

      const message = err instanceof Error ? err.message : 'Gagal memproses rekrutmen';
      const details = err instanceof ApiError && err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : null;
      setErrorDetails(details);
      setResult(`GAGAL: ${snapshot.playerName} belum memenuhi syarat (${message}).`);
    }
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

        <div className="rounded border border-border/60 bg-bg/50 p-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Aset Divisi/Satuan/Korps</p>
          <p className="mt-1 text-text">{track.assets.join(' · ')}</p>
        </div>

        <div className="rounded border border-border/60 bg-bg/50 p-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Hierarki Internal (Expandable / Collapsible)</p>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
            {track.internalHierarchy.map((node) => {
              const expanded = Boolean(expandedNodes[node.name]);
              return (
                <div key={node.name} className="rounded border border-border/50 bg-bg/70">
                  <button
                    type="button"
                    onClick={() => setExpandedNodes((prev) => ({ ...prev, [node.name]: !prev[node.name] }))}
                    className="flex w-full items-center justify-between px-2 py-1 text-left"
                  >
                    <span className="text-text">{node.level} · {node.name}</span>
                    <span className="text-muted">{expanded ? 'Collapse' : 'Expand'}</span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-border/40 px-2 py-1">
                      <p className="text-muted">Jabatan: {node.roles.join(' · ')}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          {dynamicQuestions.map((item, idx) => (
            <div key={item.id} className="rounded border border-border/60 bg-bg/60 p-2">
              <p className="text-text">{idx + 1}. {item.prompt}</p>
              <div className="mt-1 space-y-1">
                {item.choices.map((choice) => (
                  <label key={`${item.id}-${choice}`} className="flex items-center gap-2 text-muted">
                    <input
                      type="radio"
                      name={item.id}
                      value={choice}
                      checked={answers[item.id] === choice}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                    <span>{choice}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => void submit()} className="rounded border border-accent bg-accent/20 px-3 py-1 text-text">Submit Ujian Rekrutmen</button>
        {result ? <p className="text-muted">{result}</p> : null}
        {errorDetails ? (
          <div className="rounded border border-danger/50 bg-danger/5 p-2 text-[11px] text-muted">
            <p className="font-semibold text-text">Detail validasi backend:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {Object.entries(errorDetails).map(([key, value]) => (
                <li key={key}>
                  <span className="text-text">{key}</span>: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
