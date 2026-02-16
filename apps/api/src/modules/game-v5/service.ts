import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type {
  AcademyBatchState,
  AcademyBatchStanding,
  CertificationRecordV5,
  DivisionQuotaState,
  ExpansionStateV51,
  MissionInstanceV5,
  NpcRuntimeStatus,
  RecruitmentCompetitionEntry
} from '@mls/shared/game-types';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import { attachAuth } from '../auth/service.js';
import { getAdaptiveTickMetrics, mergeDeltas, runSchedulerTick, runWorldTick } from './engine.js';
import {
  type AcademyBatchMemberRecord,
  appendQuotaDecisionLog,
  buildEmptyExpansionState,
  buildSnapshotV5,
  clearV5World,
  completeAcademyEnrollment,
  completeCeremonyCycle,
  createAcademyBatch,
  ensureV5World,
  findDivisionHeadCandidate,
  getAcademyBatchMember,
  getActiveAcademyBatch,
  getCurrentCeremony,
  getLatestAcademyBatch,
  getLegacyGovernanceSnapshot,
  getLatestMission,
  getNpcRuntimeById,
  getProfileBaseByUserId,
  insertAcademyEnrollment,
  insertMissionPlan,
  insertRecruitmentApplicationV51,
  listAcademyBatchMembers,
  listCertifications,
  listCurrentNpcRuntime,
  listDivisionQuotaStates,
  listRecentLifecycleEvents,
  listRecruitmentCompetitionEntries,
  listWorldDeltasSince,
  lockCurrentNpcsForUpdate,
  lockV5World,
  queueNpcReplacement,
  resolveMission,
  setSessionActiveUntil,
  updateNpcRuntimeState,
  updateWorldCore,
  upsertAcademyBatchMember,
  upsertDivisionQuotaState,
  updateAcademyBatchMeta,
  V5_MAX_NPCS,
  upsertCertification
} from './repo.js';

interface V5Context {
  client: import('pg').PoolClient;
  profileId: string;
  userId: string;
  nowMs: number;
}

const CONTEXT_SESSION_TTL_MS = 90_000;

async function withV5Context(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: (ctx: V5Context) => Promise<{ statusCode?: number; payload: unknown }>
): Promise<void> {
  await attachAuth(request);
  if (!request.auth?.userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const client = await request.server.db.connect();
  try {
    await client.query('BEGIN');
    const profile = await getProfileBaseByUserId(client, request.auth.userId);
    if (!profile) {
      await client.query('ROLLBACK');
      reply.code(404).send({ error: 'Profile not found' });
      return;
    }

    const nowMs = Date.now();
    await ensureV5World(client, profile, nowMs);
    await setSessionActiveUntil(client, profile.profileId, nowMs, CONTEXT_SESSION_TTL_MS);
    await runWorldTick(client, profile.profileId, nowMs, { maxNpcOps: V5_MAX_NPCS });

    const result = await handler({
      client,
      profileId: profile.profileId,
      userId: request.auth.userId,
      nowMs
    });

    await client.query('COMMIT');
    reply.code(result.statusCode ?? 200).send(result.payload);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'D';
}

function certTierFromCode(code: string): 1 | 2 | 3 {
  const normalized = code.toUpperCase();
  if (normalized.includes('ELITE') || normalized.includes('STRATEGIC')) return 3;
  if (normalized.includes('HIGH') || normalized.includes('COMMAND') || normalized.includes('CYBER') || normalized.includes('TRIBUNAL')) return 2;
  return 1;
}

const ACADEMY_TOTAL_DAYS = 8;
const ACADEMY_PASS_SCORE = 68;
const ACADEMY_TRACK_OFFSETS: Record<string, number> = {
  OFFICER: 0,
  HIGH_COMMAND: 1,
  SPECIALIST: 2,
  TRIBUNAL: 3,
  CYBER: 4
};

const ACADEMY_QUESTION_TEMPLATES: Array<{
  prompt: string;
  best: string;
  distractors: [string, string, string];
}> = [
  {
    prompt: 'Prioritas awal operasi lintas-divisi?',
    best: 'Sinkronkan objective, command chain, dan fallback.',
    distractors: ['Eksekusi cepat tanpa briefing.', 'Tunda operasi sampai seluruh unit standby.', 'Fokus laporan publik sebelum operasi.']
  },
  {
    prompt: 'Saat intel ambigu, keputusan paling aman?',
    best: 'Verifikasi intel lalu siapkan contingency plan.',
    distractors: ['Abaikan intel dan tetap serang.', 'Pisahkan unit tanpa komunikasi.', 'Batalkan semua aktivitas tanpa analisa.']
  },
  {
    prompt: 'Indikator utama kesiapan tempur batch?',
    best: 'Konsistensi disiplin, kesehatan, dan logistik.',
    distractors: ['Jumlah kendaraan aktif saja.', 'Durasi rapat harian.', 'Total jam kerja tertinggi.']
  },
  {
    prompt: 'Cara menekan casualty saat tekanan tinggi?',
    best: 'Jaga tempo operasi + kontrol medical corridor.',
    distractors: ['Tingkatkan tempo tanpa rotasi unit.', 'Lakukan full push tanpa reserve.', 'Abaikan status fatigue tim.']
  },
  {
    prompt: 'Jika terjadi gangguan komando digital?',
    best: 'Aktifkan kanal fallback terenkripsi dan isolasi segmen.',
    distractors: ['Matikan semua log sistem.', 'Publikasikan credential sementara.', 'Tunggu perintah pusat tanpa mitigasi.']
  },
  {
    prompt: 'Prinsip keputusan tribunal militer?',
    best: 'Imparsial, berbasis bukti, dan due process.',
    distractors: ['Prioritaskan jabatan tertinggi.', 'Fokus ke opini publik.', 'Gunakan sanksi maksimum otomatis.']
  },
  {
    prompt: 'Pola kepemimpinan terbaik untuk batch akademi?',
    best: 'Delegasi jelas + evaluasi harian objektif.',
    distractors: ['Sentralisasi semua keputusan.', 'Biarkan unit bergerak tanpa KPI.', 'Batasi laporan agar cepat selesai.']
  },
  {
    prompt: 'Strategi kelulusan terbaik menuju rekrutmen elit?',
    best: 'Stabilkan skor harian dan tambah sertifikasi relevan.',
    distractors: ['Kejar nilai tinggi satu hari saja.', 'Fokus ranking tanpa sertifikasi.', 'Mengabaikan exam akhir rekrutmen.']
  }
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function buildChoices(
  best: string,
  distractors: readonly [string, string, string],
  correctIndex: number
): [string, string, string, string] {
  const choices = [...distractors];
  const safeIndex = clamp(correctIndex, 1, 4) - 1;
  choices.splice(safeIndex, 0, best);
  return [choices[0] ?? best, choices[1] ?? distractors[0], choices[2] ?? distractors[1], choices[3] ?? distractors[2]];
}

function buildAcademyQuestionSet(track: string, academyDay: number): {
  setId: string;
  questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }>;
  correct: number[];
} {
  const dayIndex = clamp(academyDay, 1, ACADEMY_TOTAL_DAYS) - 1;
  const offset = ACADEMY_TRACK_OFFSETS[track] ?? 0;
  const questions = Array.from({ length: 3 }, (_, idx) => {
    const template = ACADEMY_QUESTION_TEMPLATES[(dayIndex + idx) % ACADEMY_QUESTION_TEMPLATES.length] ?? ACADEMY_QUESTION_TEMPLATES[0];
    const correctIndex = ((academyDay + offset + idx * 2) % 4) + 1;
    return {
      id: `D${academyDay}-Q${idx + 1}`,
      prompt: template.prompt,
      choices: buildChoices(template.best, template.distractors, correctIndex),
      correctIndex
    };
  });

  return {
    setId: `${track}-D${academyDay}`,
    questions: questions.map((item) => ({ id: item.id, prompt: item.prompt, choices: item.choices })),
    correct: questions.map((item) => item.correctIndex)
  };
}

function scoreMultipleChoice(correct: number[], answers: number[]): number {
  const safeAnswers = Array.isArray(answers) ? answers.slice(0, correct.length) : [];
  const correctCount = correct.reduce((sum, answer, idx) => sum + (safeAnswers[idx] === answer ? 1 : 0), 0);
  return clamp(Math.round((correctCount / Math.max(1, correct.length)) * 100), 0, 100);
}

function calcNpcAcademyDayScore(npcId: string, track: string, tier: number, academyDay: number): number {
  const seed = hashSeed(`${npcId}:${track}:${tier}:${academyDay}`);
  const base = 58 + (seed % 34);
  const tierBonus = tier >= 2 ? 5 : 2;
  const dayMomentum = Math.floor(academyDay * 1.5);
  return clamp(base + tierBonus + dayMomentum, 45, 100);
}

function averageScore(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function consistencyScore(values: number[]): number {
  if (values.length <= 1) return 72;
  const avg = averageScore(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  const deviation = Math.sqrt(variance);
  return clamp(Math.round(100 - deviation * 4.2), 40, 100);
}

function extraCertCountFromAcademyScore(score: number): number {
  if (score >= 95) return 3;
  if (score >= 85) return 2;
  if (score >= ACADEMY_PASS_SCORE) return 1;
  return 0;
}

function requirementTierForDivision(division: string): { label: 'STANDARD' | 'ADVANCED' | 'ELITE'; minExtraCerts: number } {
  const token = division.toLowerCase();
  if (token.includes('judge') || token.includes('court') || token.includes('cyber') || token.includes('air defense')) {
    return { label: 'ELITE', minExtraCerts: 3 };
  }
  if (token.includes('armored') || token.includes('special') || token.includes('signal')) {
    return { label: 'ADVANCED', minExtraCerts: 2 };
  }
  return { label: 'STANDARD', minExtraCerts: 1 };
}

async function getAcademyLockInfo(client: import('pg').PoolClient, profileId: string): Promise<{ locked: boolean; batchId: string | null }> {
  const active = await getActiveAcademyBatch(client, profileId);
  if (!active || !active.lockEnabled || active.status !== 'ACTIVE') {
    return { locked: false, batchId: null };
  }
  return { locked: true, batchId: active.batchId };
}

async function guardAcademyLockResponse(
  client: import('pg').PoolClient,
  profileId: string
): Promise<{ statusCode: number; payload: Record<string, unknown> } | null> {
  const lock = await getAcademyLockInfo(client, profileId);
  if (!lock.locked) return null;
  return {
    statusCode: 409,
    payload: {
      error: 'ACADEMY_LOCK_ACTIVE',
      code: 'ACADEMY_LOCK_ACTIVE',
      message: 'Batch academy aktif. Selesaikan program 8 hari di halaman Academy terlebih dahulu.',
      batchId: lock.batchId
    }
  };
}

function scoreRecruitmentExam(division: string, answers: number[]): number {
  const seed = hashSeed(`recruitment:${division}`);
  const correct = [((seed % 4) + 1), (((seed + 3) % 4) + 1), (((seed + 7) % 4) + 1)];
  return scoreMultipleChoice(correct, answers);
}

function buildRecruitmentQuestionSet(division: string): {
  setId: string;
  questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }>;
} {
  const seed = hashSeed(`recruitment:${division}`);
  const correct = [((seed % 4) + 1), (((seed + 3) % 4) + 1), (((seed + 7) % 4) + 1)];
  const templates = [
    {
      prompt: 'Saat seleksi divisi ketat, prioritas pertama kandidat?',
      best: 'Penuhi syarat inti + sertifikasi tambahan yang relevan.',
      distractors: ['Fokus jabatan tanpa sertifikasi.', 'Abaikan instruksi board.', 'Tunggu kuota tanpa evaluasi.']
    },
    {
      prompt: 'Jika kuota sudah penuh, langkah tepat?',
      best: 'Masuk antrean berikutnya dan tingkatkan composite score.',
      distractors: ['Paksa bypass kuota.', 'Ajukan mutasi tanpa evaluasi.', 'Skip proses evaluasi.']
    },
    {
      prompt: 'Faktor penentu untuk tie-break skor sama?',
      best: 'Waktu aplikasi lebih awal lalu fatigue lebih rendah.',
      distractors: ['Visual profil lebih menarik.', 'Durasi login lebih lama.', 'Jumlah klik paling cepat.']
    }
  ] as const;

  return {
    setId: `recruitment-${division.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    questions: templates.map((item, idx) => ({
      id: `RQ-${idx + 1}`,
      prompt: item.prompt,
      choices: buildChoices(item.best, item.distractors, correct[idx] ?? 1)
    }))
  };
}

function computeCompositeScore(input: {
  diplomaScore: number;
  dailyConsistency: number;
  certStrength: number;
  examScore: number;
  serviceReputation: number;
  extraCertCount: number;
  requiredExtraCerts: number;
}): number {
  const weighted =
    input.diplomaScore * 0.45 +
    input.dailyConsistency * 0.15 +
    input.certStrength * 0.25 +
    input.examScore * 0.1 +
    input.serviceReputation * 0.05;
  const bonus = clamp((input.extraCertCount - input.requiredExtraCerts) * 1.5, 0, 8);
  return Number(clamp(weighted + bonus, 0, 100).toFixed(2));
}

function candidateSort(
  a: { compositeScore: number; appliedDay: number; appliedOrder?: number; fatigue: number; stableId: string },
  b: { compositeScore: number; appliedDay: number; appliedOrder?: number; fatigue: number; stableId: string }
): number {
  if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
  const appliedOrderA = typeof a.appliedOrder === 'number' ? a.appliedOrder : a.appliedDay;
  const appliedOrderB = typeof b.appliedOrder === 'number' ? b.appliedOrder : b.appliedDay;
  if (appliedOrderA !== appliedOrderB) return appliedOrderA - appliedOrderB;
  if (a.appliedDay !== b.appliedDay) return a.appliedDay - b.appliedDay;
  if (a.fatigue !== b.fatigue) return a.fatigue - b.fatigue;
  return a.stableId.localeCompare(b.stableId);
}

function mapMemberToStanding(member: AcademyBatchMemberRecord, name: string): AcademyBatchStanding {
  return {
    holderType: member.holderType,
    npcId: member.npcId,
    name,
    dayProgress: member.dayProgress,
    finalScore: member.finalScore,
    passed: member.passed,
    rankPosition: member.rankPosition,
    extraCertCount: member.extraCertCount
  };
}

async function autoProgressNpcBatchMembers(
  client: import('pg').PoolClient,
  batch: { batchId: string; startDay: number; track: string; tier: number },
  worldDay: number
): Promise<void> {
  const targetProgress = clamp(worldDay - batch.startDay + 1, 0, ACADEMY_TOTAL_DAYS);
  if (targetProgress <= 0) return;
  const members = await listAcademyBatchMembers(client, batch.batchId);
  for (const member of members) {
    if (member.holderType !== 'NPC') continue;
    if (member.dayProgress >= targetProgress) continue;

    const nextScores = [...member.dailyScores];
    let dayProgress = member.dayProgress;
    while (dayProgress < targetProgress) {
      const academyDay = dayProgress + 1;
      const score = calcNpcAcademyDayScore(member.npcId ?? member.memberKey, batch.track, batch.tier, academyDay);
      nextScores.push({
        academyDay,
        worldDay: batch.startDay + dayProgress,
        score,
        source: 'NPC'
      });
      dayProgress += 1;
    }

    const dailyOnly = nextScores.map((item) => item.score);
    const provisionalFinal = clamp(Math.round(averageScore(dailyOnly) * 0.82 + consistencyScore(dailyOnly) * 0.18), 0, 100);
    await upsertAcademyBatchMember(client, {
      batchId: member.batchId,
      memberKey: member.memberKey,
      holderType: member.holderType,
      npcId: member.npcId,
      dayProgress,
      dailyScores: nextScores,
      finalScore: provisionalFinal,
      passed: provisionalFinal >= ACADEMY_PASS_SCORE,
      extraCertCount: extraCertCountFromAcademyScore(provisionalFinal),
      rankPosition: member.rankPosition
    });
  }
}

async function rankAcademyBatchMembers(
  client: import('pg').PoolClient,
  batchId: string
): Promise<AcademyBatchMemberRecord[]> {
  const members = await listAcademyBatchMembers(client, batchId);
  const enriched = members.map((member) => {
    const scores = member.dailyScores.map((item) => item.score);
    const finalScore = clamp(Math.round(averageScore(scores) * 0.82 + consistencyScore(scores) * 0.18), 0, 100);
    return {
      ...member,
      finalScore,
      passed: finalScore >= ACADEMY_PASS_SCORE,
      extraCertCount: extraCertCountFromAcademyScore(finalScore)
    };
  });

  enriched.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.dayProgress !== a.dayProgress) return b.dayProgress - a.dayProgress;
    return a.memberKey.localeCompare(b.memberKey);
  });

  for (let idx = 0; idx < enriched.length; idx += 1) {
    const member = enriched[idx];
    await upsertAcademyBatchMember(client, {
      batchId: member.batchId,
      memberKey: member.memberKey,
      holderType: member.holderType,
      npcId: member.npcId,
      dayProgress: member.dayProgress,
      dailyScores: member.dailyScores,
      finalScore: member.finalScore,
      passed: member.passed,
      extraCertCount: member.extraCertCount,
      rankPosition: idx + 1
    });
  }

  return listAcademyBatchMembers(client, batchId);
}

async function buildAcademyBatchStateForProfile(
  client: import('pg').PoolClient,
  profileId: string,
  nowDay: number,
  playerName: string
): Promise<AcademyBatchState | null> {
  const active = await getActiveAcademyBatch(client, profileId);
  const batch = active ?? (await getLatestAcademyBatch(client, profileId));
  if (!batch) return null;

  if (active) {
    await autoProgressNpcBatchMembers(client, batch, nowDay);
  }

  const members = await rankAcademyBatchMembers(client, batch.batchId);
  const playerMember = members.find((item) => item.holderType === 'PLAYER') ?? null;

  const npcRoster = await listCurrentNpcRuntime(client, profileId, { limit: V5_MAX_NPCS });
  const npcNameMap = new Map(npcRoster.items.map((item) => [item.npcId, item.name]));
  const standings = members.map((member) => {
    const name = member.holderType === 'PLAYER' ? playerName : npcNameMap.get(member.npcId ?? '') ?? member.memberKey;
    return mapMemberToStanding(member, name);
  });

  const standingsTop10 = standings.slice(0, 10);
  const playerStanding = standings.find((item) => item.holderType === 'PLAYER') ?? null;
  const playerProgress = playerMember?.dayProgress ?? 0;
  const expectedWorldDay = batch.startDay + playerProgress;
  const canSubmitToday = batch.status === 'ACTIVE' && batch.lockEnabled && playerProgress < ACADEMY_TOTAL_DAYS && nowDay >= expectedWorldDay;

  const graduation = (() => {
    const payload = batch.graduationPayload;
    if (!payload || Object.keys(payload).length === 0) return null;
    const passed = Boolean(payload.passed);
    const playerRank = Number(payload.playerRank ?? playerStanding?.rankPosition ?? 0);
    const totalCadets = Number(payload.totalCadets ?? standings.length);
    const certificateCodes = Array.isArray(payload.certificateCodes)
      ? payload.certificateCodes.filter((item): item is string => typeof item === 'string')
      : [];
    const message = String(payload.message ?? (passed ? 'Lulus graduation academy.' : 'Belum lulus graduation academy.'));
    return {
      passed,
      playerRank,
      totalCadets,
      certificateCodes,
      message
    };
  })();

  return {
    batchId: batch.batchId,
    track: batch.track,
    tier: batch.tier,
    status: batch.status,
    lockEnabled: batch.lockEnabled,
    startDay: batch.startDay,
    endDay: batch.endDay,
    totalDays: ACADEMY_TOTAL_DAYS,
    playerDayProgress: playerProgress,
    expectedWorldDay,
    canSubmitToday,
    nextQuestionSetId:
      batch.status === 'ACTIVE' && batch.lockEnabled && playerProgress < ACADEMY_TOTAL_DAYS
        ? buildAcademyQuestionSet(batch.track, playerProgress + 1).setId
        : null,
    standingsTop10,
    playerStanding,
    graduation
  };
}

type QuotaDecisionInput = {
  worldDay: number;
  division: string;
  missionPressure: number;
  casualtyPressure: number;
  governance: { nationalStability: number; militaryStability: number; militaryFundCents: number };
  head: { npcId: string; name: string; leadership: number; resilience: number; fatigue: number } | null;
};

function computeQuotaDecision(input: QuotaDecisionInput): {
  quotaTotal: number;
  cooldownDays: number;
  decisionNote: string;
  reasons: Record<string, unknown>;
} {
  const stability = (input.governance.nationalStability + input.governance.militaryStability) / 2;
  const stabilityBoost = (stability - 50) / 18;
  const fundBoost = clamp(input.governance.militaryFundCents / 180_000, -2, 3);
  if (!input.head) {
    const quotaTotal = clamp(Math.round(5 + input.missionPressure - input.casualtyPressure + stabilityBoost + fundBoost), 2, 16);
    const cooldownDays = clamp(Math.round(2 + input.casualtyPressure * 0.7), 1, 7);
    return {
      quotaTotal,
      cooldownDays,
      decisionNote: `System board menetapkan kuota ${quotaTotal}. Faktor: mission pressure ${input.missionPressure}, casualty pressure ${input.casualtyPressure.toFixed(1)}, stability ${Math.round(stability)}.`,
      reasons: {
        mode: 'SYSTEM_DYNAMIC',
        missionPressure: input.missionPressure,
        casualtyPressure: Number(input.casualtyPressure.toFixed(2)),
        stability: Math.round(stability),
        fundCents: input.governance.militaryFundCents
      }
    };
  }

  const leadershipFactor = (input.head.leadership + input.head.resilience) / 55;
  const fatiguePenalty = input.head.fatigue / 35;
  const quotaTotal = clamp(Math.round(6 + leadershipFactor + input.missionPressure + stabilityBoost + fundBoost - fatiguePenalty - input.casualtyPressure), 2, 18);
  const cooldownDays = clamp(Math.round(2 + fatiguePenalty + input.casualtyPressure * 0.8), 1, 9);
  return {
    quotaTotal,
    cooldownDays,
    decisionNote: `Head ${input.head.name} menetapkan kuota ${quotaTotal} (leadership=${input.head.leadership}, resilience=${input.head.resilience}, fatigue=${input.head.fatigue}).`,
    reasons: {
      mode: 'HEAD_AI',
      headNpcId: input.head.npcId,
      leadership: input.head.leadership,
      resilience: input.head.resilience,
      fatigue: input.head.fatigue,
      missionPressure: input.missionPressure,
      casualtyPressure: Number(input.casualtyPressure.toFixed(2)),
      stability: Math.round(stability),
      fundCents: input.governance.militaryFundCents
    }
  };
}

async function ensureQuotaBoard(
  client: import('pg').PoolClient,
  profileId: string,
  nowDay: number,
  mission: MissionInstanceV5 | null,
  npcSummary: { kia: number; total: number }
): Promise<DivisionQuotaState[]> {
  const governance = await getLegacyGovernanceSnapshot(client, profileId);
  const existing = await listDivisionQuotaStates(client, profileId);
  const existingByDivision = new Map(existing.map((item) => [item.division, item]));

  const missionPressure = (() => {
    if (!mission || mission.status !== 'ACTIVE') return 1;
    if (mission.dangerTier === 'EXTREME') return 4;
    if (mission.dangerTier === 'HIGH') return 3;
    if (mission.dangerTier === 'MEDIUM') return 2;
    return 1;
  })();
  const casualtyPressure = npcSummary.total <= 0 ? 0 : clamp((npcSummary.kia / npcSummary.total) * 6, 0, 4);

  for (const division of REGISTERED_DIVISIONS.map((item) => item.name)) {
    const current = existingByDivision.get(division);
    const head = await findDivisionHeadCandidate(client, profileId, division);
    if (!current) {
      const decision = computeQuotaDecision({ worldDay: nowDay, division, missionPressure, casualtyPressure, governance, head });
      await upsertDivisionQuotaState(client, {
        profileId,
        division,
        headNpcId: head?.npcId ?? null,
        quotaTotal: decision.quotaTotal,
        quotaUsed: 0,
        status: 'OPEN',
        cooldownUntilDay: null,
        cooldownDays: decision.cooldownDays,
        decisionNote: decision.decisionNote,
        updatedDay: nowDay
      });
      await appendQuotaDecisionLog(client, {
        profileId,
        division,
        headNpcId: head?.npcId ?? null,
        decisionDay: nowDay,
        quotaTotal: decision.quotaTotal,
        cooldownDays: decision.cooldownDays,
        reasons: decision.reasons,
        note: decision.decisionNote
      });
      continue;
    }

    let nextState: DivisionQuotaState = { ...current, headNpcId: head?.npcId ?? current.headNpcId, headName: head?.name ?? current.headName };

    if (nextState.status === 'OPEN' && nextState.quotaUsed >= nextState.quotaTotal) {
      nextState = {
        ...nextState,
        status: 'COOLDOWN',
        cooldownUntilDay: nowDay + nextState.cooldownDays,
        decisionNote: `${nextState.headName ?? 'System'} menutup kuota sementara. Menunggu cooldown ${nextState.cooldownDays} hari.`,
        updatedDay: nowDay
      };
      await upsertDivisionQuotaState(client, {
        profileId,
        division,
        headNpcId: nextState.headNpcId,
        quotaTotal: nextState.quotaTotal,
        quotaUsed: nextState.quotaUsed,
        status: nextState.status,
        cooldownUntilDay: nextState.cooldownUntilDay,
        cooldownDays: nextState.cooldownDays,
        decisionNote: nextState.decisionNote,
        updatedDay: nextState.updatedDay
      });
      continue;
    }

    if (nextState.status === 'COOLDOWN' && nextState.cooldownUntilDay !== null && nowDay >= nextState.cooldownUntilDay) {
      const decision = computeQuotaDecision({ worldDay: nowDay, division, missionPressure, casualtyPressure, governance, head });
      nextState = {
        ...nextState,
        quotaTotal: decision.quotaTotal,
        quotaUsed: 0,
        status: 'OPEN',
        cooldownUntilDay: null,
        cooldownDays: decision.cooldownDays,
        decisionNote: decision.decisionNote,
        updatedDay: nowDay
      };
      await upsertDivisionQuotaState(client, {
        profileId,
        division,
        headNpcId: nextState.headNpcId,
        quotaTotal: nextState.quotaTotal,
        quotaUsed: nextState.quotaUsed,
        status: nextState.status,
        cooldownUntilDay: nextState.cooldownUntilDay,
        cooldownDays: nextState.cooldownDays,
        decisionNote: nextState.decisionNote,
        updatedDay: nextState.updatedDay
      });
      await appendQuotaDecisionLog(client, {
        profileId,
        division,
        headNpcId: nextState.headNpcId,
        decisionDay: nowDay,
        quotaTotal: nextState.quotaTotal,
        cooldownDays: nextState.cooldownDays,
        reasons: {
          mode: nextState.headNpcId ? 'HEAD_AI' : 'SYSTEM_DYNAMIC',
          trigger: 'COOLDOWN_REOPEN',
          missionPressure,
          casualtyPressure: Number(casualtyPressure.toFixed(2))
        },
        note: nextState.decisionNote
      });
    }
  }

  return listDivisionQuotaStates(client, profileId);
}

async function buildExpansionState(
  client: import('pg').PoolClient,
  profileId: string,
  nowMs: number,
  preferredDivision?: string | null
): Promise<ExpansionStateV51> {
  const snapshot = await buildSnapshotV5(client, profileId, nowMs);
  if (!snapshot) {
    return buildEmptyExpansionState(0);
  }

  const cacheKey = makeExpansionCacheKey(profileId, snapshot.stateVersion, snapshot.world.currentDay, preferredDivision ?? null);
  const cached = readExpansionStateCache(cacheKey, nowMs);
  if (cached) return cached;

  const quotaBoard = await ensureQuotaBoard(client, profileId, snapshot.world.currentDay, snapshot.activeMission, {
    kia: snapshot.npcSummary.kia,
    total: snapshot.npcSummary.total
  });

  const academyBatch = await buildAcademyBatchStateForProfile(client, profileId, snapshot.world.currentDay, snapshot.player.playerName);
  const lockInfo = await getAcademyLockInfo(client, profileId);
  const division =
    preferredDivision && quotaBoard.some((item) => item.division === preferredDivision)
      ? preferredDivision
      : quotaBoard.find((item) => item.status === 'OPEN')?.division ?? quotaBoard[0]?.division ?? REGISTERED_DIVISIONS[0]?.name ?? null;

  const competition = division ? await listRecruitmentCompetitionEntries(client, profileId, division, 20) : [];
  const playerEntry = competition.find((item) => item.holderType === 'PLAYER') ?? null;
  const playerRank = playerEntry?.rank ?? null;
  const adaptive = getAdaptiveTickMetrics();

  const state: ExpansionStateV51 = {
    academyLockActive: lockInfo.locked,
    academyLockReason: lockInfo.locked ? 'ACADEMY_BATCH_ACTIVE' : null,
    academyBatch,
    quotaBoard,
    recruitmentRace: {
      division,
      top10: competition.slice(0, 10),
      playerRank,
      playerEntry,
      generatedAtDay: snapshot.world.currentDay
    },
    performance: {
      maxNpcOps: V5_MAX_NPCS,
      adaptiveBudget: adaptive.adaptiveBudget,
      tickPressure: adaptive.tickPressure,
      pollingHintMs: lockInfo.locked ? 5_000 : 15_000
    }
  };

  writeExpansionStateCache(cacheKey, state, nowMs);
  return state;
}

export async function startSessionV5(request: FastifyRequest, reply: FastifyReply, payload: { resetWorld?: boolean }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, userId, nowMs }) => {
    if (payload.resetWorld) {
      await clearV5World(client, profileId);
      const profile = await getProfileBaseByUserId(client, userId);
      if (!profile) {
        return { statusCode: 404, payload: { error: 'Profile not found' } };
      }
      await ensureV5World(client, profile, nowMs);
      invalidateExpansionStateCache(profileId);
    }

    await setSessionActiveUntil(client, profileId, nowMs, 30_000);
    await runWorldTick(client, profileId, nowMs, { maxNpcOps: V5_MAX_NPCS });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);

    return {
      payload: {
        started: true,
        resetApplied: Boolean(payload.resetWorld),
        snapshot
      }
    };
  });
}

export async function heartbeatSessionV5(request: FastifyRequest, reply: FastifyReply, payload: { sessionTtlMs?: number }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    await setSessionActiveUntil(client, profileId, nowMs, payload.sessionTtlMs ?? 30_000);
    await runWorldTick(client, profileId, nowMs, { maxNpcOps: V5_MAX_NPCS });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { ok: true, snapshot } };
  });
}

export async function syncSessionV5(request: FastifyRequest, reply: FastifyReply, sinceVersion?: number): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    await setSessionActiveUntil(client, profileId, nowMs, 30_000);
    const tickResult = await runWorldTick(client, profileId, nowMs, { maxNpcOps: V5_MAX_NPCS });
    const snapshot = tickResult.snapshot ?? (await buildSnapshotV5(client, profileId, nowMs));

    if (!snapshot) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    if (!sinceVersion || sinceVersion <= 0 || sinceVersion > snapshot.stateVersion) {
      return {
        payload: {
          fullSync: true,
          snapshot,
          delta: null
        }
      };
    }

    const deltas = await listWorldDeltasSince(client, profileId, sinceVersion);
    const merged = mergeDeltas(sinceVersion, deltas);
    if (!merged) {
      return {
        payload: {
          fullSync: false,
          snapshot,
          delta: null
        }
      };
    }

    const farBehind = snapshot.stateVersion - sinceVersion > 100;
    if (farBehind || deltas.length >= 70) {
      return {
        payload: {
          fullSync: true,
          snapshot,
          delta: null
        }
      };
    }

    return {
      payload: {
        fullSync: false,
        snapshot,
        delta: merged
      }
    };
  });
}

export async function listNpcsV5(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { status?: NpcRuntimeStatus; cursor?: number; limit?: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId }) => {
    const roster = await listCurrentNpcRuntime(client, profileId, query);
    return {
      payload: {
        items: roster.items,
        nextCursor: roster.nextCursor
      }
    };
  });
}

export async function getNpcDetailV5(request: FastifyRequest, reply: FastifyReply, npcId: string): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId }) => {
    const npc = await getNpcRuntimeById(client, profileId, npcId);
    if (!npc) {
      return { statusCode: 404, payload: { error: 'NPC not found' } };
    }

    const events = await listRecentLifecycleEvents(client, profileId, 30);
    const certifications = await listCertifications(client, profileId, { holderType: 'NPC', npcId });

    return {
      payload: {
        npc,
        lifecycleEvents: events.filter((item) => item.npcId === npcId),
        certifications
      }
    };
  });
}

export async function planMissionV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: {
    missionType: MissionInstanceV5['missionType'];
    dangerTier: MissionInstanceV5['dangerTier'];
    strategy: string;
    objective: string;
    prepChecklist: string[];
    participantNpcIds: string[];
  }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const lockBlocked = await guardAcademyLockResponse(client, profileId);
    if (lockBlocked) return lockBlocked;

    const latest = await getLatestMission(client, profileId);
    if (latest && latest.status === 'ACTIVE') {
      return { statusCode: 409, payload: { error: 'Active mission already exists', mission: latest } };
    }

    const chainQuality = Math.max(45, Math.min(95, 55 + (payload.strategy.length % 30) + payload.prepChecklist.length * 2));
    const logisticReadiness = Math.max(40, Math.min(95, 50 + (payload.objective.length % 25) + payload.prepChecklist.length * 3));

    const world = await lockV5World(client, profileId);
    const issuedDay = world?.currentDay ?? Math.max(0, Math.floor(nowMs / 1000) % 1000000);

    const mission = await insertMissionPlan(client, {
      profileId,
      missionType: payload.missionType,
      dangerTier: payload.dangerTier,
      issuedDay,
      strategy: payload.strategy,
      objective: payload.objective,
      prepChecklist: payload.prepChecklist,
      chainQuality,
      logisticReadiness,
      participantNpcIds: payload.participantNpcIds
    });

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { mission, snapshot } };
  });
}

export async function executeMissionV5(request: FastifyRequest, reply: FastifyReply, payload: { missionId: string; playerParticipates?: boolean }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const lockBlocked = await guardAcademyLockResponse(client, profileId);
    if (lockBlocked) return lockBlocked;

    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const mission = await getLatestMission(client, profileId);
    if (!mission || mission.status !== 'ACTIVE' || mission.missionId !== payload.missionId) {
      return { statusCode: 409, payload: { error: 'Mission not active' } };
    }

    const plan = mission.plan;
    const planQuality = (plan?.chainQuality ?? 55) + (plan?.logisticReadiness ?? 55);
    const dangerPenalty = { LOW: 10, MEDIUM: 20, HIGH: 30, EXTREME: 40 }[mission.dangerTier];
    const playerBonus = payload.playerParticipates ? 8 : 0;
    const successScore = Math.max(1, Math.min(99, planQuality / 2 + playerBonus - dangerPenalty + Math.floor(Math.random() * 20) - 10));
    const success = successScore >= 52;
    const casualties = success ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 4);

    const execution = {
      success,
      successScore,
      casualties,
      moraleDelta: success ? 6 : -7,
      healthDelta: success ? -2 : -6,
      fundDeltaCents: success ? 13_000 : -7_000
    };

    const resolved = await resolveMission(client, { profileId, missionId: mission.missionId, execution });
    if (!resolved) {
      return { statusCode: 404, payload: { error: 'Mission not found' } };
    }

    let morale = Math.max(0, Math.min(100, world.morale + execution.moraleDelta));
    let health = Math.max(0, Math.min(100, world.health + execution.healthDelta));
    const moneyCents = world.moneyCents + execution.fundDeltaCents;

    if (casualties > 0) {
      const npcRows = await lockCurrentNpcsForUpdate(client, profileId, V5_MAX_NPCS);
      const candidates = npcRows.filter((item) => item.status !== 'KIA').slice(0, casualties);
      for (const npc of candidates) {
        npc.status = 'KIA';
        npc.deathDay = world.currentDay;
        npc.lastTask = 'mission-casualty';
        await updateNpcRuntimeState(client, profileId, npc, world.currentDay);
        await queueNpcReplacement(client, {
          profileId,
          slotNo: npc.slotNo,
          generationNext: npc.generation + 1,
          enqueuedDay: world.currentDay,
          dueDay: world.currentDay + 2 + (npc.slotNo % 5),
          replacedNpcId: npc.npcId
        });
      }
      morale = Math.max(0, morale - casualties * 2);
      health = Math.max(0, health - casualties);
    }

    await updateWorldCore(client, {
      profileId,
      stateVersion: world.stateVersion + 1,
      lastTickMs: nowMs,
      currentDay: world.currentDay,
      moneyCents,
      morale,
      health,
      rankIndex: world.rankIndex,
      assignment: world.assignment,
      commandAuthority: Math.max(0, Math.min(100, world.commandAuthority + (success ? 2 : -2)))
    });

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { mission: resolved, snapshot } };
  });
}

export async function getCurrentCeremonyV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const ceremony = await getCurrentCeremony(client, profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { ceremony, snapshot } };
  });
}

export async function completeCeremonyV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const lockBlocked = await guardAcademyLockResponse(client, profileId);
    if (lockBlocked) return lockBlocked;

    const ceremony = await getCurrentCeremony(client, profileId);
    if (!ceremony || ceremony.status !== 'PENDING') {
      return { statusCode: 409, payload: { error: 'No pending ceremony' } };
    }

    const done = await completeCeremonyCycle(client, profileId, ceremony.cycleId, nowMs);
    const world = await lockV5World(client, profileId);
    if (world) {
      await updateWorldCore(client, {
        profileId,
        stateVersion: world.stateVersion + 1,
        lastTickMs: nowMs,
        currentDay: world.currentDay,
        moneyCents: world.moneyCents + 6_000,
        morale: Math.min(100, world.morale + 8),
        health: Math.min(100, world.health + 2),
        rankIndex: world.rankIndex,
        assignment: world.assignment,
        commandAuthority: Math.min(100, world.commandAuthority + 3)
      });
    }

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { ceremony: done, snapshot } };
  });
}

export async function enrollAcademyV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { enrolleeType: 'PLAYER' | 'NPC'; npcId?: string; track: string; tier: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const enrollmentId = await insertAcademyEnrollment(client, {
      profileId,
      enrolleeType: payload.enrolleeType,
      npcId: payload.npcId ?? null,
      track: payload.track,
      tier: payload.tier,
      startedDay: world.currentDay
    });

    const score = Math.max(0, Math.min(100, 55 + payload.tier * 8 + (payload.track.length % 12) + Math.floor(Math.random() * 25)));
    const passed = score >= 68;

    await completeAcademyEnrollment(client, {
      profileId,
      enrollmentId,
      score,
      passed,
      completedDay: world.currentDay
    });

    if (passed) {
      const certCode = `${payload.track}_T${payload.tier}_CERT`;
      const certTier = certTierFromCode(certCode);
      await upsertCertification(client, {
        profileId,
        certId: `cert-${payload.enrolleeType.toLowerCase()}-${payload.npcId ?? 'player'}-${world.currentDay}-${payload.track.toLowerCase()}`,
        holderType: payload.enrolleeType,
        npcId: payload.enrolleeType === 'NPC' ? payload.npcId ?? null : null,
        certCode,
        track: payload.track,
        tier: certTier,
        grade: gradeFromScore(score),
        issuedDay: world.currentDay,
        expiresDay: world.currentDay + 540,
        valid: true,
        sourceEnrollmentId: enrollmentId
      });
    }

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { enrollmentId, passed, score, snapshot } };
  });
}

export async function submitCertificationExamV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { holderType: 'PLAYER' | 'NPC'; npcId?: string; certCode: string; score: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const lockBlocked = await guardAcademyLockResponse(client, profileId);
    if (lockBlocked) return lockBlocked;

    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const tier = certTierFromCode(payload.certCode);
    const grade = gradeFromScore(payload.score);
    const passed = payload.score >= 70;

    await upsertCertification(client, {
      profileId,
      certId: `exam-${payload.holderType.toLowerCase()}-${payload.npcId ?? 'player'}-${payload.certCode.toLowerCase()}-${world.currentDay}`,
      holderType: payload.holderType,
      npcId: payload.holderType === 'NPC' ? payload.npcId ?? null : null,
      certCode: payload.certCode,
      track: payload.certCode.split('_')[0] ?? 'GENERAL',
      tier,
      grade,
      issuedDay: world.currentDay,
      expiresDay: world.currentDay + (tier >= 2 ? 720 : 480),
      valid: passed,
      sourceEnrollmentId: null
    });

    const certifications = await listCertifications(client, profileId, {
      holderType: payload.holderType,
      npcId: payload.holderType === 'NPC' ? payload.npcId : undefined
    });

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { passed, grade, certifications, snapshot } };
  });
}

function isBaseDiplomaCertCode(certCode: string): boolean {
  const token = certCode.toUpperCase();
  return token.includes('FOUNDATION') || token.includes('OFFICER') || token.includes('HIGH_COMMAND');
}

function resolveBaseCertCode(track: string): string {
  const normalized = track.toUpperCase();
  if (normalized === 'HIGH_COMMAND') return 'HIGH_COMMAND_STRATEGY';
  if (normalized === 'CYBER') return 'SPECIALIST_CYBER_OPS';
  if (normalized === 'TRIBUNAL') return 'TRIBUNAL_RULES_OF_ENGAGEMENT';
  return 'OFFICER_FOUNDATION';
}

function gradeBonus(grade: 'A' | 'B' | 'C' | 'D'): number {
  if (grade === 'A') return 20;
  if (grade === 'B') return 14;
  if (grade === 'C') return 8;
  return 3;
}

type ExpansionStateCacheEntry = {
  state: ExpansionStateV51;
  cachedAtMs: number;
};

const expansionStateCache = new Map<string, ExpansionStateCacheEntry>();
const EXPANSION_STATE_CACHE_TTL_MS = 2_500;
const MAX_EXPANSION_CACHE_ENTRIES = 256;

function makeExpansionCacheKey(profileId: string, stateVersion: number, worldDay: number, preferredDivision?: string | null): string {
  return `${profileId}:${stateVersion}:${worldDay}:${preferredDivision ?? 'AUTO'}`;
}

function readExpansionStateCache(cacheKey: string, nowMs: number): ExpansionStateV51 | null {
  const cached = expansionStateCache.get(cacheKey);
  if (!cached) return null;
  if (nowMs - cached.cachedAtMs > EXPANSION_STATE_CACHE_TTL_MS) {
    expansionStateCache.delete(cacheKey);
    return null;
  }
  return cached.state;
}

function writeExpansionStateCache(cacheKey: string, state: ExpansionStateV51, nowMs: number): void {
  expansionStateCache.set(cacheKey, { state, cachedAtMs: nowMs });
  if (expansionStateCache.size <= MAX_EXPANSION_CACHE_ENTRIES) return;
  const oldestKey = expansionStateCache.keys().next().value;
  if (typeof oldestKey === 'string') {
    expansionStateCache.delete(oldestKey);
  }
}

function invalidateExpansionStateCache(profileId: string): void {
  const prefix = `${profileId}:`;
  for (const key of expansionStateCache.keys()) {
    if (key.startsWith(prefix)) {
      expansionStateCache.delete(key);
    }
  }
}

function summarizePlayerCertifications(certifications: CertificationRecordV5[]): {
  hasBaseDiploma: boolean;
  baseDiplomaCode: string | null;
  baseDiplomaGrade: 'A' | 'B' | 'C' | 'D' | null;
  extraCertCount: number;
  validCertCount: number;
} {
  const validCerts = certifications.filter((item) => item.valid);
  const baseDiplomas = validCerts.filter((item) => isBaseDiplomaCertCode(item.certCode));
  const primaryBaseDiploma =
    baseDiplomas
      .slice()
      .sort((a, b) => {
        const gradeDiff = gradeBonus(b.grade) - gradeBonus(a.grade);
        if (gradeDiff !== 0) return gradeDiff;
        return b.issuedDay - a.issuedDay;
      })[0] ?? null;

  return {
    hasBaseDiploma: Boolean(primaryBaseDiploma),
    baseDiplomaCode: primaryBaseDiploma?.certCode ?? null,
    baseDiplomaGrade: primaryBaseDiploma?.grade ?? null,
    extraCertCount: Math.max(0, validCerts.length - baseDiplomas.length),
    validCertCount: validCerts.length
  };
}

export async function getExpansionStateV51(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const state = await buildExpansionState(client, profileId, nowMs);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function startAcademyBatchV51(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { track: 'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'; tier: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const active = await getActiveAcademyBatch(client, profileId);
    if (active && active.lockEnabled && active.status === 'ACTIVE') {
      const existingState = await buildExpansionState(client, profileId, nowMs);
      return {
        statusCode: 409,
        payload: {
          error: 'ACADEMY_LOCK_ACTIVE',
          code: 'ACADEMY_LOCK_ACTIVE',
          batchId: active.batchId,
          state: existingState
        }
      };
    }

    const batchId = `batch-${profileId.slice(0, 8)}-${world.currentDay}-${randomUUID().slice(0, 8)}`;
    await createAcademyBatch(client, {
      batchId,
      profileId,
      track: payload.track,
      tier: payload.tier,
      startDay: world.currentDay,
      endDay: world.currentDay + (ACADEMY_TOTAL_DAYS - 1)
    });

    await upsertAcademyBatchMember(client, {
      batchId,
      memberKey: 'PLAYER',
      holderType: 'PLAYER',
      npcId: null,
      dayProgress: 0,
      dailyScores: [],
      finalScore: 0,
      passed: false,
      rankPosition: 0,
      extraCertCount: 0
    });

    const npcRoster = await lockCurrentNpcsForUpdate(client, profileId, V5_MAX_NPCS);
    const npcCandidates = npcRoster.filter((item) => item.status !== 'KIA').slice(0, 72);
    for (const npc of npcCandidates) {
      await upsertAcademyBatchMember(client, {
        batchId,
        memberKey: npc.npcId,
        holderType: 'NPC',
        npcId: npc.npcId,
        dayProgress: 0,
        dailyScores: [],
        finalScore: 0,
        passed: false,
        rankPosition: 0,
        extraCertCount: 0
      });
    }

    invalidateExpansionStateCache(profileId);
    const state = await buildExpansionState(client, profileId, nowMs);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        started: true,
        batchId,
        track: payload.track,
        tier: payload.tier,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function getAcademyBatchCurrentV51(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const state = await buildExpansionState(client, profileId, nowMs);
    const batch = state.academyBatch;
    const questionSet =
      batch && batch.status === 'ACTIVE' && batch.lockEnabled && batch.playerDayProgress < ACADEMY_TOTAL_DAYS
        ? buildAcademyQuestionSet(batch.track, batch.playerDayProgress + 1)
        : null;
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        academyLockActive: state.academyLockActive,
        academyBatch: batch,
        questionSet,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function submitAcademyBatchDayV51(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { answers: number[] }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const batch = await getActiveAcademyBatch(client, profileId);
    if (!batch || batch.status !== 'ACTIVE') {
      return { statusCode: 409, payload: { error: 'Tidak ada batch academy aktif.' } };
    }
    if (!batch.lockEnabled) {
      return { statusCode: 409, payload: { error: 'Batch academy tidak dalam mode lock.' } };
    }

    const playerMember = await getAcademyBatchMember(client, batch.batchId, 'PLAYER');
    if (!playerMember) {
      return { statusCode: 409, payload: { error: 'Data player batch tidak ditemukan.' } };
    }
    if (playerMember.dayProgress >= ACADEMY_TOTAL_DAYS) {
      return { statusCode: 409, payload: { error: 'Seluruh hari academy sudah diselesaikan. Lakukan graduation.' } };
    }

    const expectedWorldDay = batch.startDay + playerMember.dayProgress;
    if (world.currentDay < expectedWorldDay) {
      return {
        statusCode: 409,
        payload: {
          error: 'Belum bisa submit hari berikutnya.',
          expectedWorldDay,
          currentWorldDay: world.currentDay
        }
      };
    }

    const academyDay = playerMember.dayProgress + 1;
    const questionSet = buildAcademyQuestionSet(batch.track, academyDay);
    const dayScore = scoreMultipleChoice(questionSet.correct, payload.answers);
    const nextDaily = [
      ...playerMember.dailyScores,
      {
        academyDay,
        worldDay: world.currentDay,
        score: dayScore,
        source: 'PLAYER' as const
      }
    ];
    const nextProgress = playerMember.dayProgress + 1;
    const provisionalFinal = clamp(Math.round(averageScore(nextDaily.map((item) => item.score)) * 0.82 + consistencyScore(nextDaily.map((item) => item.score)) * 0.18), 0, 100);

    await upsertAcademyBatchMember(client, {
      batchId: batch.batchId,
      memberKey: 'PLAYER',
      holderType: 'PLAYER',
      npcId: null,
      dayProgress: nextProgress,
      dailyScores: nextDaily,
      finalScore: provisionalFinal,
      passed: provisionalFinal >= ACADEMY_PASS_SCORE,
      rankPosition: playerMember.rankPosition,
      extraCertCount: extraCertCountFromAcademyScore(provisionalFinal)
    });

    await autoProgressNpcBatchMembers(client, batch, world.currentDay);
    await rankAcademyBatchMembers(client, batch.batchId);

    invalidateExpansionStateCache(profileId);
    const state = await buildExpansionState(client, profileId, nowMs);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        submitted: true,
        academyDay,
        dayScore,
        dayPassed: dayScore >= 70,
        readyToGraduate: nextProgress >= ACADEMY_TOTAL_DAYS,
        academyBatch: state.academyBatch,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function graduateAcademyBatchV51(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const batch = await getActiveAcademyBatch(client, profileId);
    if (!batch || batch.status !== 'ACTIVE') {
      return { statusCode: 409, payload: { error: 'Tidak ada batch academy aktif untuk graduation.' } };
    }

    const playerMember = await getAcademyBatchMember(client, batch.batchId, 'PLAYER');
    if (!playerMember || playerMember.dayProgress < ACADEMY_TOTAL_DAYS) {
      return { statusCode: 409, payload: { error: 'Progress academy belum mencapai hari ke-8.' } };
    }
    if (world.currentDay < batch.endDay) {
      return { statusCode: 409, payload: { error: 'Graduation belum tersedia. Selesaikan hingga day ke-8 dunia game.' } };
    }

    await autoProgressNpcBatchMembers(client, batch, world.currentDay);
    const ranked = await rankAcademyBatchMembers(client, batch.batchId);
    const playerRanked = ranked.find((item) => item.holderType === 'PLAYER') ?? null;
    if (!playerRanked) {
      return { statusCode: 409, payload: { error: 'Data ranking player tidak ditemukan.' } };
    }

    const passed = playerRanked.finalScore >= ACADEMY_PASS_SCORE;
    const baseCertCode = resolveBaseCertCode(batch.track);
    const certCodes: string[] = [];

    if (passed) {
      certCodes.push(baseCertCode);
      await upsertCertification(client, {
        profileId,
        certId: `v51-base-${profileId}-${batch.batchId}`,
        holderType: 'PLAYER',
        npcId: null,
        certCode: baseCertCode,
        track: batch.track,
        tier: certTierFromCode(baseCertCode),
        grade: gradeFromScore(playerRanked.finalScore),
        issuedDay: world.currentDay,
        expiresDay: world.currentDay + 540,
        valid: true,
        sourceEnrollmentId: null
      });

      for (let i = 0; i < playerRanked.extraCertCount; i += 1) {
        const code = `${batch.track}_EXTRA_CERT_${i + 1}`;
        certCodes.push(code);
        await upsertCertification(client, {
          profileId,
          certId: `v51-extra-${profileId}-${batch.batchId}-${i + 1}`,
          holderType: 'PLAYER',
          npcId: null,
          certCode: code,
          track: batch.track,
          tier: 1,
          grade: gradeFromScore(Math.max(70, playerRanked.finalScore - i * 4)),
          issuedDay: world.currentDay,
          expiresDay: world.currentDay + 420,
          valid: true,
          sourceEnrollmentId: null
        });
      }
    }

    const graduationPayload = {
      passed,
      playerRank: playerRanked.rankPosition,
      totalCadets: ranked.length,
      certificateCodes: certCodes,
      message: passed
        ? `Graduation sukses. Rank Anda #${playerRanked.rankPosition} dari ${ranked.length} kadet.`
        : `Graduation selesai namun belum lulus. Rank Anda #${playerRanked.rankPosition} dari ${ranked.length} kadet.`
    };

    await updateAcademyBatchMeta(client, {
      batchId: batch.batchId,
      status: passed ? 'GRADUATED' : 'FAILED',
      lockEnabled: false,
      graduationPayload
    });

    invalidateExpansionStateCache(profileId);
    const state = await buildExpansionState(client, profileId, nowMs);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        graduated: true,
        ...graduationPayload,
        academyBatch: state.academyBatch,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function getRecruitmentBoardV51(
  request: FastifyRequest,
  reply: FastifyReply,
  preferredDivision?: string
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const state = await buildExpansionState(client, profileId, nowMs, preferredDivision ?? null);
    const division = state.recruitmentRace.division;
    const requirement = division ? requirementTierForDivision(division) : { label: 'STANDARD' as const, minExtraCerts: 1 };
    const quota = division ? state.quotaBoard.find((item) => item.division === division) ?? null : null;
    const questionSet = division ? buildRecruitmentQuestionSet(division) : null;
    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const certSummary = summarizePlayerCertifications(playerCerts);
    const missingExtraCerts = Math.max(0, requirement.minExtraCerts - certSummary.extraCertCount);
    const playerEligibility = {
      hasBaseDiploma: certSummary.hasBaseDiploma,
      baseDiplomaCode: certSummary.baseDiplomaCode,
      baseDiplomaGrade: certSummary.baseDiplomaGrade,
      extraCertCount: certSummary.extraCertCount,
      requiredExtraCerts: requirement.minExtraCerts,
      missingExtraCerts,
      bonusScore: Number(clamp((certSummary.extraCertCount - requirement.minExtraCerts) * 1.5, 0, 8).toFixed(2)),
      bonusCap: 8,
      eligible: certSummary.hasBaseDiploma && missingExtraCerts <= 0
    };
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        board: {
          division,
          requirement,
          playerEligibility,
          quota,
          quotaBoard: state.quotaBoard,
          race: state.recruitmentRace,
          questionSet
        },
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function applyRecruitmentV51(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { division: string; answers: number[] }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const lockBlocked = await guardAcademyLockResponse(client, profileId);
    if (lockBlocked) return lockBlocked;

    const division = payload.division.trim();
    if (!division) {
      return { statusCode: 400, payload: { error: 'Division tidak valid.' } };
    }
    if (!REGISTERED_DIVISIONS.some((item) => item.name === division)) {
      return { statusCode: 404, payload: { error: 'Division tidak terdaftar.' } };
    }

    const state = await buildExpansionState(client, profileId, nowMs, division);
    const quota = state.quotaBoard.find((item) => item.division === division);
    if (!quota) {
      return { statusCode: 404, payload: { error: 'Division quota tidak ditemukan.' } };
    }
    if (quota.status !== 'OPEN' || quota.quotaRemaining <= 0) {
      return {
        statusCode: 409,
        payload: {
          error: 'Kuota divisi sedang ditutup/cooldown.',
          quota
        }
      };
    }

    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const certSummary = summarizePlayerCertifications(playerCerts);
    const requirement = requirementTierForDivision(division);

    if (!certSummary.hasBaseDiploma) {
      return {
        statusCode: 409,
        payload: {
          error: 'Sertifikasi dasar academy (diploma) belum terdeteksi.',
          code: 'MISSING_BASE_DIPLOMA',
          requirement,
          playerEligibility: {
            hasBaseDiploma: false,
            baseDiplomaCode: null,
            baseDiplomaGrade: null,
            extraCertCount: certSummary.extraCertCount,
            requiredExtraCerts: requirement.minExtraCerts,
            missingExtraCerts: requirement.minExtraCerts,
            bonusScore: 0,
            bonusCap: 8,
            eligible: false
          }
        }
      };
    }

    if (certSummary.extraCertCount < requirement.minExtraCerts) {
      return {
        statusCode: 409,
        payload: {
          error: `Sertifikasi tambahan belum cukup (${certSummary.extraCertCount}/${requirement.minExtraCerts}).`,
          code: 'MISSING_EXTRA_CERT',
          requirement,
          playerEligibility: {
            hasBaseDiploma: true,
            baseDiplomaCode: certSummary.baseDiplomaCode,
            baseDiplomaGrade: certSummary.baseDiplomaGrade,
            extraCertCount: certSummary.extraCertCount,
            requiredExtraCerts: requirement.minExtraCerts,
            missingExtraCerts: requirement.minExtraCerts - certSummary.extraCertCount,
            bonusScore: 0,
            bonusCap: 8,
            eligible: false
          }
        }
      };
    }

    const academyBatch = await buildAcademyBatchStateForProfile(client, profileId, world.currentDay, world.playerName);
    const diplomaScore = clamp(academyBatch?.playerStanding?.finalScore ?? 72, 0, 100);
    const playerDailyScores = academyBatch?.batchId ? (await getAcademyBatchMember(client, academyBatch.batchId, 'PLAYER'))?.dailyScores.map((item) => item.score) ?? [] : [];
    const dailyConsistency = clamp(playerDailyScores.length > 0 ? consistencyScore(playerDailyScores) : 70, 0, 100);
    const certStrength = clamp(48 + certSummary.extraCertCount * 12 + gradeBonus(certSummary.baseDiplomaGrade ?? 'C'), 0, 100);
    const examScore = scoreRecruitmentExam(division, payload.answers);
    const serviceReputation = clamp(world.commandAuthority * 0.6 + world.morale * 0.4, 0, 100);
    const playerComposite = computeCompositeScore({
      diplomaScore,
      dailyConsistency,
      certStrength,
      examScore,
      serviceReputation,
      extraCertCount: certSummary.extraCertCount,
      requiredExtraCerts: requirement.minExtraCerts
    });

    const candidateCount = clamp(Math.max(12, quota.quotaRemaining * 4), 12, 48);
    const npcRoster = await listCurrentNpcRuntime(client, profileId, { limit: V5_MAX_NPCS });
    const npcCandidates = npcRoster.items.filter((item) => item.status !== 'KIA').slice(0, candidateCount);

    const candidates: Array<{
      holderType: 'PLAYER' | 'NPC';
      npcId: string | null;
      name: string;
      appliedDay: number;
      appliedOrder: number;
      examScore: number;
      compositeScore: number;
      fatigue: number;
      extraCertCount: number;
      baseDiplomaScore: number;
      stableId: string;
      eligible: boolean;
      ineligibleCode: string | null;
      ineligibleReason: string | null;
    }> = [
      {
        holderType: 'PLAYER',
        npcId: null,
        name: world.playerName,
        appliedDay: world.currentDay,
        appliedOrder: 1,
        examScore,
        compositeScore: playerComposite,
        fatigue: 0,
        extraCertCount: certSummary.extraCertCount,
        baseDiplomaScore: diplomaScore,
        stableId: 'PLAYER',
        eligible: true,
        ineligibleCode: null,
        ineligibleReason: null
      }
    ];

    for (let npcIndex = 0; npcIndex < npcCandidates.length; npcIndex += 1) {
      const npc = npcCandidates[npcIndex];
      const seed = hashSeed(`${division}:${npc.npcId}:${world.currentDay}`);
      const npcExtraCert = clamp(Math.floor((npc.promotionPoints + npc.xp) / 55), 0, 6);
      const npcDiploma = clamp(Math.round((npc.leadership + npc.support) / 2), 50, 98);
      const npcConsistency = clamp(Math.round(76 - npc.fatigue * 0.25 + npc.resilience * 0.18), 35, 99);
      const npcCertStrength = clamp(45 + npcExtraCert * 11 + ((seed % 20) - 8), 30, 100);
      const npcExamScore = clamp(54 + (seed % 42) - Math.floor(npc.fatigue / 5), 25, 100);
      const npcService = clamp((npc.leadership + npc.resilience) / 2, 0, 100);
      const meetsBaseDiploma = npcDiploma >= ACADEMY_PASS_SCORE;
      const meetsExtraCert = npcExtraCert >= requirement.minExtraCerts;
      const eligible = meetsBaseDiploma && meetsExtraCert;
      const ineligibleCode = !meetsBaseDiploma ? 'MISSING_BASE_DIPLOMA' : !meetsExtraCert ? 'MISSING_EXTRA_CERT' : null;
      const ineligibleReason =
        ineligibleCode === 'MISSING_BASE_DIPLOMA'
          ? 'Diploma academy belum memenuhi syarat.'
          : ineligibleCode === 'MISSING_EXTRA_CERT'
            ? `Sertifikasi tambahan belum cukup (${npcExtraCert}/${requirement.minExtraCerts}).`
            : null;
      const composite = computeCompositeScore({
        diplomaScore: npcDiploma,
        dailyConsistency: npcConsistency,
        certStrength: npcCertStrength,
        examScore: npcExamScore,
        serviceReputation: npcService,
        extraCertCount: npcExtraCert,
        requiredExtraCerts: requirement.minExtraCerts
      });

      candidates.push({
        holderType: 'NPC',
        npcId: npc.npcId,
        name: npc.name,
        appliedDay: world.currentDay,
        appliedOrder: 2 + npcIndex + (seed % 4),
        examScore: npcExamScore,
        compositeScore: composite,
        fatigue: npc.fatigue,
        extraCertCount: npcExtraCert,
        baseDiplomaScore: npcDiploma,
        stableId: npc.npcId,
        eligible,
        ineligibleCode,
        ineligibleReason
      });
    }

    const eligibleCandidates = candidates.filter((item) => item.eligible).sort(candidateSort);
    const acceptedIds = new Set(eligibleCandidates.slice(0, quota.quotaRemaining).map((item) => item.stableId));
    const acceptedCount = acceptedIds.size;
    const playerAccepted = acceptedIds.has('PLAYER');
    const acceptedNpcIds = eligibleCandidates
      .slice(0, quota.quotaRemaining)
      .filter((item) => item.holderType === 'NPC' && item.npcId)
      .map((item) => item.npcId as string);

    let playerDecision: { status: 'ACCEPTED' | 'REJECTED'; code: string; reason: string } = {
      status: 'REJECTED',
      code: 'COMPOSITE_SCORE_BELOW_CUTOFF',
      reason: 'Skor kompetitif belum cukup pada gelombang ini.'
    };

    for (const candidate of candidates) {
      const status: 'ACCEPTED' | 'REJECTED' = acceptedIds.has(candidate.stableId) ? 'ACCEPTED' : 'REJECTED';
      const decisionCode =
        status === 'ACCEPTED'
          ? 'ACCEPTED'
          : candidate.ineligibleCode ?? 'COMPOSITE_SCORE_BELOW_CUTOFF';
      const reason =
        status === 'ACCEPTED'
          ? 'Lolos seleksi kuota divisi.'
          : candidate.ineligibleReason ?? 'Skor kompetitif belum cukup pada gelombang ini.';

      if (candidate.stableId === 'PLAYER') {
        playerDecision = { status, code: decisionCode, reason };
      }

      await insertRecruitmentApplicationV51(client, {
        profileId,
        division,
        holderType: candidate.holderType,
        npcId: candidate.npcId,
        holderName: candidate.name,
        appliedDay: candidate.appliedDay,
        baseDiplomaScore: candidate.baseDiplomaScore,
        extraCertCount: candidate.extraCertCount,
        examScore: candidate.examScore,
        compositeScore: candidate.compositeScore,
        fatigue: candidate.fatigue,
        status,
        reason
      });
    }

    let updatedQuota: DivisionQuotaState = quota;
    if (acceptedCount > 0) {
      const nextUsed = clamp(quota.quotaUsed + acceptedCount, 0, quota.quotaTotal);
      const quotaClosed = nextUsed >= quota.quotaTotal;
      updatedQuota = {
        ...quota,
        quotaUsed: nextUsed,
        quotaRemaining: Math.max(0, quota.quotaTotal - nextUsed),
        status: quotaClosed ? 'COOLDOWN' : 'OPEN',
        cooldownUntilDay: quotaClosed ? world.currentDay + quota.cooldownDays : null,
        decisionNote: quotaClosed
          ? `${quota.headName ?? 'System'} menutup kuota karena slot penuh pada gelombang ini.`
          : quota.decisionNote,
        updatedDay: world.currentDay
      };

      await upsertDivisionQuotaState(client, {
        profileId,
        division: updatedQuota.division,
        headNpcId: updatedQuota.headNpcId,
        quotaTotal: updatedQuota.quotaTotal,
        quotaUsed: updatedQuota.quotaUsed,
        status: updatedQuota.status,
        cooldownUntilDay: updatedQuota.cooldownUntilDay,
        cooldownDays: updatedQuota.cooldownDays,
        decisionNote: updatedQuota.decisionNote,
        updatedDay: updatedQuota.updatedDay
      });
    }

    if (acceptedNpcIds.length > 0) {
      await client.query(
        `
          UPDATE npc_entities
          SET division = $3, unit = $4, position = $5, updated_at = now()
          WHERE profile_id = $1
            AND npc_id = ANY($2::text[])
            AND is_current = TRUE
        `,
        [profileId, acceptedNpcIds, division, `${division} Intake Unit`, 'Probationary Officer']
      );
    }

    if (playerAccepted) {
      await updateWorldCore(client, {
        profileId,
        stateVersion: world.stateVersion + 1,
        lastTickMs: nowMs,
        currentDay: world.currentDay,
        moneyCents: world.moneyCents,
        morale: clamp(world.morale + 2, 0, 100),
        health: world.health,
        rankIndex: world.rankIndex,
        assignment: `${division} - Probationary Officer`,
        commandAuthority: clamp(world.commandAuthority + 2, 0, 100)
      });

      await client.query(
        `
          UPDATE game_states
          SET player_division = $2, player_position = $3, updated_at = now()
          WHERE profile_id = $1
        `,
        [profileId, division, 'Probationary Officer']
      );
    }

    invalidateExpansionStateCache(profileId);
    const entries = await listRecruitmentCompetitionEntries(client, profileId, division, 20);
    const playerEntry = entries.find((item) => item.holderType === 'PLAYER') ?? null;
    const stateAfter = await buildExpansionState(client, profileId, nowMs, division);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);

    return {
      payload: {
        accepted: playerAccepted,
        division,
        requirement,
        examScore,
        compositeScore: playerComposite,
        acceptedSlots: acceptedCount,
        quota: updatedQuota,
        playerDecision,
        playerEntry,
        raceTop10: entries.slice(0, 10),
        message: playerAccepted
          ? 'Selamat, Anda lolos seleksi rekrutmen divisi.'
          : `${playerDecision.reason} Tingkatkan nilai sertifikasi tambahan dan exam score.`,
        state: stateAfter,
        snapshot: snapshot ? { ...snapshot, expansion: stateAfter } : null
      }
    };
  });
}

export function registerV5TickScheduler(app: FastifyInstance): void {
  let timer: NodeJS.Timeout | null = null;

  app.addHook('onReady', async () => {
    timer = setInterval(() => {
      const nowMs = Date.now();
      runSchedulerTick(app.db, nowMs).catch((error) => {
        app.log.error({ err: error }, 'v5-scheduler-tick-failed');
      });
    }, 400);
  });

  app.addHook('onClose', async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}

