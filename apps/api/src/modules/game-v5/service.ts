import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type {
  AcademyCertificate,
  AcademyBatchState,
  AcademyBatchStanding,
  CertificationRecordV5,
  CommandChainOrder,
  CouncilState,
  CourtCaseV2,
  DomOperationCycle,
  DivisionQuotaState,
  EducationTitle,
  ExpansionStateV51,
  MailboxMessage,
  MissionInstanceV5,
  NpcCareerPlanState,
  NpcRuntimeStatus,
  RecruitmentPipelineState,
  SocialTimelineEvent,
  RecruitmentCompetitionEntry
} from '@mls/shared/game-types';
import { DIVISION_REFERENCE_PROFILES, REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import { attachAuth } from '../auth/service.js';
import { getAdaptiveTickMetrics, mergeDeltas, runSchedulerTick, runWorldTick } from './engine.js';
import {
  type AcademyBatchMemberRecord,
  applyLegacyGovernanceDelta,
  appendCommandChainAck,
  appendQuotaDecisionLog,
  buildEmptyExpansionState,
  buildSnapshotV5,
  completeAcademyEnrollment,
  completeCeremonyCycle,
  createAcademyBatch,
  createCommandChainOrder,
  createDomOperationCycle,
  ensureV5World,
  findDivisionHeadCandidate,
  getAcademyBatchMember,
  getActiveAcademyBatch,
  getCouncilState,
  getCouncilVoteByActor,
  getCourtCaseV2,
  getCommandChainOrder,
  getCurrentCeremony,
  getCurrentDomOperationCycle,
  getDatabaseNowMs,
  getLatestSocialTimelineEventByType,
  getDomOperationSession,
  getLatestAcademyBatch,
  getLegacyGovernanceSnapshot,
  getLatestMission,
  getMailboxSummary,
  getNpcCareerPlan,
  getNpcRuntimeById,
  getProfileBaseByUserId,
  getRecruitmentPipelineApplication,
  insertAcademyEnrollment,
  insertAssignmentHistory,
  insertCouncilVote,
  insertMailboxMessage,
  insertMissionPlan,
  insertRankHistory,
  insertRecruitmentApplicationV51,
  insertSocialTimelineEvent,
  listAcademyBatchMembers,
  listCommandChainAcks,
  listCommandChainOrders,
  listCouncils,
  listCourtCasesV2,
  listCertifications,
  listCurrentNpcRuntime,
  listDivisionQuotaStates,
  listDomOperationSessionsByCycle,
  listEducationTitles,
  listMailboxMessages,
  listRankHistory,
  listRecentLifecycleEvents,
  listRecruitmentCompetitionEntries,
  listRecruitmentPipelineApplications,
  listRecruitmentQueue,
  listSocialTimelineEvents,
  listWorldDeltasSince,
  lockCurrentNpcsForUpdate,
  lockV5RuntimeRows,
  lockV5World,
  markMailboxMessageRead,
  queueNpcReplacement,
  reserveDivisionQuotaSlot,
  resolveMission,
  setSessionActiveUntil,
  updateCommandChainOrderStatus,
  upsertCouncilState,
  upsertCourtCaseV2,
  upsertDomOperationSession,
  updateNpcRuntimeState,
  updateWorldCore,
  upsertAcademyBatchMember,
  upsertDivisionQuotaState,
  upsertRecruitmentPipelineApplication,
  updateAcademyBatchMeta,
  updateDomOperationCycleStatus,
  V5_MAX_NPCS,
  upsertCertification,
  wipeAllRuntimeDataPreserveAuth
} from './repo.js';

interface V5Context {
  client: import('pg').PoolClient;
  profileId: string;
  userId: string;
  nowMs: number;
}

const CONTEXT_SESSION_TTL_MS = 90_000;
const V5_CONTEXT_RETRY_LIMIT = 2;
const V5_RETRYABLE_TX_ERROR_CODES = new Set(['40P01', '40001']);

function isV5RetryableTxError(error: unknown): error is { code: string } {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    V5_RETRYABLE_TX_ERROR_CODES.has((error as { code: string }).code)
  );
}

function waitV5Retry(attempt: number): Promise<void> {
  const delayMs = 25 * (attempt + 1);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

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
    for (let attempt = 0; attempt <= V5_CONTEXT_RETRY_LIMIT; attempt += 1) {
      try {
        await client.query('BEGIN');
        const profile = await getProfileBaseByUserId(client, request.auth.userId);
        if (!profile) {
          await client.query('ROLLBACK');
          reply.code(404).send({ error: 'Profile not found' });
          return;
        }

        const dbNowMs = await getDatabaseNowMs(client);
        await ensureV5World(client, profile, dbNowMs);
        // Keep lock acquisition order aligned with legacy service transactions.
        await lockV5RuntimeRows(client, profile.profileId);
        const world = await lockV5World(client, profile.profileId);
        if (!world) {
          throw new Error(`Failed to lock game world for profile ${profile.profileId}`);
        }
        const nowMs = Math.max(dbNowMs, world.lastTickMs);
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
        return;
      } catch (error) {
        await client.query('ROLLBACK');
        if (isV5RetryableTxError(error) && attempt < V5_CONTEXT_RETRY_LIMIT) {
          request.log.warn({ err: error, attempt: attempt + 1 }, 'game-v5-retryable-transaction');
          await waitV5Retry(attempt);
          continue;
        }
        throw error;
      }
    }
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

function tierFromCertCode(certCode: string): 1 | 2 | 3 {
  const match = certCode.toUpperCase().match(/(?:^|_)T([123])(?:_|$)/);
  if (!match) return 1;
  const value = Number(match[1]);
  if (value >= 3) return 3;
  if (value <= 1) return 1;
  return 2;
}

function certTierFromCode(code: string): 1 | 2 | 3 {
  const normalized = code.toUpperCase();
  const parsedTier = tierFromCertCode(normalized);
  if (parsedTier !== 1) return parsedTier;
  if (normalized.includes('ELITE') || normalized.includes('STRATEGIC')) return 3;
  if (normalized.includes('HIGH') || normalized.includes('COMMAND') || normalized.includes('CYBER') || normalized.includes('TRIBUNAL')) return 2;
  return 1;
}

const ACADEMY_TOTAL_DAYS_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 4,
  2: 5,
  3: 6
};
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

function academyTotalDaysForTier(tier: number): number {
  if (tier >= 3) return ACADEMY_TOTAL_DAYS_BY_TIER[3];
  if (tier <= 1) return ACADEMY_TOTAL_DAYS_BY_TIER[1];
  return ACADEMY_TOTAL_DAYS_BY_TIER[2];
}

function buildAcademyQuestionSet(track: string, academyDay: number, totalDays: number): {
  setId: string;
  questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }>;
  correct: number[];
} {
  const dayIndex = clamp(academyDay, 1, totalDays) - 1;
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

function minimumAcademyTierForDivision(division: string): 1 | 2 | 3 {
  const requirement = requirementTierForDivision(division);
  if (requirement.label === 'ELITE') return 3;
  if (requirement.label === 'ADVANCED') return 2;
  return 1;
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
      message: 'Batch academy aktif. Selesaikan program sesuai durasi tier (4/5/6 hari) di halaman Academy terlebih dahulu.',
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
  batch: { batchId: string; startDay: number; track: string; tier: number; totalDays: number },
  worldDay: number
): Promise<void> {
  const targetProgress = clamp(worldDay - batch.startDay + 1, 0, batch.totalDays);
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

type AcademyGraduationPayload = {
  passed: boolean;
  playerRank: number;
  totalCadets: number;
  certificateCodes: string[];
  message: string;
};

async function failAcademyBatchCorruptState(
  client: import('pg').PoolClient,
  batchId: string,
  reason: string,
  totalCadets: number
): Promise<AcademyGraduationPayload> {
  const payload: AcademyGraduationPayload = {
    passed: false,
    playerRank: 0,
    totalCadets,
    certificateCodes: [],
    message: reason
  };

  await updateAcademyBatchMeta(client, {
    batchId,
    status: 'FAILED',
    lockEnabled: false,
    graduationPayload: payload
  });

  return payload;
}

async function finalizeAcademyBatchGraduation(
  client: import('pg').PoolClient,
  profileId: string,
  batch: { batchId: string; track: string; tier: number; startDay: number; totalDays: number },
  worldDay: number
): Promise<AcademyGraduationPayload> {
  await autoProgressNpcBatchMembers(client, batch, worldDay);
  const ranked = await rankAcademyBatchMembers(client, batch.batchId);
  const playerRanked = ranked.find((item) => item.holderType === 'PLAYER') ?? null;
  if (!playerRanked) {
    return failAcademyBatchCorruptState(
      client,
      batch.batchId,
      `Batch ${batch.batchId} ditutup otomatis karena data peserta PLAYER tidak valid.`,
      ranked.length
    );
  }

  const passed = playerRanked.finalScore >= ACADEMY_PASS_SCORE;
  const baseCertCode = resolveBaseCertCode(batch.track, batch.tier);
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
      tier: batch.tier >= 3 ? 3 : batch.tier <= 1 ? 1 : 2,
      grade: gradeFromScore(playerRanked.finalScore),
      issuedDay: worldDay,
      expiresDay: worldDay + 540,
      valid: true,
      sourceEnrollmentId: null
    });

    for (let i = 0; i < playerRanked.extraCertCount; i += 1) {
      const code = `${batch.track}_ADV_CERT_T${batch.tier}_${i + 1}`;
      certCodes.push(code);
      await upsertCertification(client, {
        profileId,
        certId: `v51-extra-${profileId}-${batch.batchId}-${i + 1}`,
        holderType: 'PLAYER',
        npcId: null,
        certCode: code,
        track: batch.track,
        tier: batch.tier >= 3 ? 3 : batch.tier <= 1 ? 1 : 2,
        grade: gradeFromScore(Math.max(70, playerRanked.finalScore - i * 4)),
        issuedDay: worldDay,
        expiresDay: worldDay + 420,
        valid: true,
        sourceEnrollmentId: null
      });
    }
  }

  const graduationPayload: AcademyGraduationPayload = {
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

  return graduationPayload;
}

async function autoFinalizeAcademyBatchIfReady(
  client: import('pg').PoolClient,
  profileId: string,
  batch: {
    batchId: string;
    track: string;
    tier: number;
    startDay: number;
    endDay: number;
    totalDays: number;
    status: 'ACTIVE' | 'GRADUATED' | 'FAILED';
    lockEnabled: boolean;
  },
  worldDay: number
): Promise<AcademyGraduationPayload | null> {
  if (batch.status !== 'ACTIVE' || !batch.lockEnabled) return null;
  const playerMember = await getAcademyBatchMember(client, batch.batchId, 'PLAYER');
  if (!playerMember) {
    return failAcademyBatchCorruptState(
      client,
      batch.batchId,
      `Batch ${batch.batchId} ditutup otomatis karena data member PLAYER hilang.`,
      0
    );
  }
  if (playerMember.dayProgress < batch.totalDays) return null;
  if (worldDay < batch.endDay) return null;
  return finalizeAcademyBatchGraduation(client, profileId, batch, worldDay);
}

async function buildAcademyBatchStateForProfile(
  client: import('pg').PoolClient,
  profileId: string,
  nowDay: number,
  playerName: string
): Promise<AcademyBatchState | null> {
  let active = await getActiveAcademyBatch(client, profileId);
  let batch = active ?? (await getLatestAcademyBatch(client, profileId));
  if (!batch) return null;

  if (active) {
    const graduationFinalized = await autoFinalizeAcademyBatchIfReady(client, profileId, batch, nowDay);
    if (graduationFinalized) {
      active = null;
      const latest = await getLatestAcademyBatch(client, profileId);
      if (!latest) return null;
      batch = latest;
    } else {
      await autoProgressNpcBatchMembers(client, batch, nowDay);
    }
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
  const canSubmitToday = batch.status === 'ACTIVE' && batch.lockEnabled && playerProgress < batch.totalDays && nowDay >= expectedWorldDay;

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
    totalDays: batch.totalDays,
    playerDayProgress: playerProgress,
    expectedWorldDay,
    canSubmitToday,
    nextQuestionSetId:
      batch.status === 'ACTIVE' && batch.lockEnabled && playerProgress < batch.totalDays
        ? buildAcademyQuestionSet(batch.track, playerProgress + 1, batch.totalDays).setId
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
  const recruitmentPipeline = await listRecruitmentPipelineApplications(client, profileId, { limit: 20 });
  const domCycle = await getCurrentDomOperationCycle(client, profileId);
  const governance = await getLegacyGovernanceSnapshot(client, profileId);
  const replacementQueue = await listRecruitmentQueue(client, profileId);
  const lastRaiderAttack = await getLatestSocialTimelineEventByType(client, profileId, 'RAIDER_ATTACK');
  const councils = await listCouncils(client, profileId, { limit: 20 });
  const openCourtCases = await listCourtCasesV2(client, profileId, { status: 'PENDING', limit: 20 });
  const mailboxSummary = await getMailboxSummary(client, profileId);
  const socialTimelineSummary = await listSocialTimelineEvents(client, profileId, { limit: 8 });
  const commandOrders = await listCommandChainOrders(client, profileId, { limit: 40 });
  const openOrders = commandOrders.filter((item) => item.status === 'PENDING' || item.status === 'FORWARDED').length;
  const breachedOrders = commandOrders.filter((item) => item.status === 'BREACHED').length;
  const latestCommandOrder = commandOrders[0] ?? null;
  const raiderThreatScore = computeRaiderThreatScore(governance);
  const raiderCadenceDays = computeRaiderCadenceDays(raiderThreatScore);
  const raiderNextAttackDay =
    lastRaiderAttack && lastRaiderAttack.eventDay >= 0
      ? lastRaiderAttack.eventDay + raiderCadenceDays
      : snapshot.world.currentDay + 3;
  const domMedalPool = computeDomCycleMedalPool(
    {
      commandAuthority: snapshot.player.commandAuthority,
      morale: snapshot.player.morale,
      health: snapshot.player.health
    },
    {
      militaryStability: governance.militaryStability,
      nationalStability: governance.nationalStability
    }
  );
  const domAllocated = domCycle ? sumAllocatedCycleMedals(domCycle.sessions) : 0;
  const domCompletedSessions = domCycle ? domCycle.sessions.filter((item) => item.status === 'COMPLETED').length : 0;
  const domPendingSessions = domCycle ? Math.max(0, 3 - domCompletedSessions) : 0;

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
    },
    recruitmentPipeline,
    domCycle,
    councils,
    openCourtCases,
    mailboxSummary,
    socialTimelineSummary,
    commandChainSummary: {
      openOrders,
      breachedOrders,
      latest: latestCommandOrder
    },
    governanceSummary: {
      nationalStability: governance.nationalStability,
      militaryStability: governance.militaryStability,
      militaryFundCents: governance.militaryFundCents,
      corruptionRisk: governance.corruptionRisk,
      riskIndex: clamp(Math.round((governance.corruptionRisk * 0.62) + ((100 - governance.militaryStability) * 0.38)), 0, 100)
    },
    raiderThreat: {
      threatLevel: raiderThreatScore >= 75 ? 'HIGH' : raiderThreatScore >= 50 ? 'MEDIUM' : 'LOW',
      threatScore: raiderThreatScore,
      cadenceDays: raiderCadenceDays,
      lastAttackDay: lastRaiderAttack?.eventDay ?? null,
      nextAttackDay: raiderNextAttackDay,
      daysUntilNext: Math.max(0, raiderNextAttackDay - snapshot.world.currentDay),
      pendingReplacementCount: replacementQueue.length
    },
    domMedalCompetition: {
      cycleId: domCycle?.cycleId ?? null,
      totalQuota: domMedalPool,
      allocated: domAllocated,
      remaining: Math.max(0, domMedalPool - domAllocated),
      completedSessions: domCompletedSessions,
      pendingSessions: domPendingSessions,
      playerSessionNo: DOM_PLAYER_SESSION_NO,
      playerNpcSlots: DOM_PLAYER_NPC_SLOTS
    }
  };

  writeExpansionStateCache(cacheKey, state, nowMs);
  return state;
}

export async function startSessionV5(request: FastifyRequest, reply: FastifyReply, payload: { resetWorld?: boolean }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, userId, nowMs }) => {
    if (payload.resetWorld) {
      await wipeAllRuntimeDataPreserveAuth(client);
      const profile = await getProfileBaseByUserId(client, userId);
      if (!profile) {
        return { statusCode: 404, payload: { error: 'Profile not found' } };
      }
      await ensureV5World(client, profile, nowMs);
      expansionStateCache.clear();
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
    const careerPlan = await getNpcCareerPlan(client, profileId, npcId);
    const activeApplication =
      careerPlan?.lastApplicationId != null
        ? await getRecruitmentPipelineApplication(client, profileId, careerPlan.lastApplicationId)
        : null;

    const desiredDivision = careerPlan?.desiredDivision ?? npc.desiredDivision ?? null;
    const requiredTier = desiredDivision ? minimumAcademyTierForDivision(desiredDivision) : 1;
    const strategyTargetTier = npc.strategyMode === 'DEEP_T3' ? 3 : npc.strategyMode === 'RUSH_T1' ? 1 : 2;
    const targetTier = Math.max(
      requiredTier,
      careerPlan?.targetTier ?? strategyTargetTier
    ) as 1 | 2 | 3;
    const academyProgress = {
      academyTier: npc.academyTier,
      minimumT1Passed: npc.academyTier >= 1,
      targetTier,
      requiredTierForDesiredDivision: desiredDivision ? requiredTier : null,
      remainingTier: Math.max(0, targetTier - npc.academyTier)
    };
    const careerPlanSummary: NpcCareerPlanState | null = careerPlan
      ? {
          ...careerPlan,
          desiredDivision
        }
      : null;

    return {
      payload: {
        npc,
        lifecycleEvents: events.filter((item) => item.npcId === npcId),
        certifications,
        careerPlan: careerPlanSummary
          ? {
              ...careerPlanSummary,
              activeApplication
            }
          : null,
        academyProgress
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

    await applyLegacyGovernanceDelta(client, {
      profileId,
      nationalDelta: success ? 2 : -3 - Math.floor(casualties / 2),
      militaryDelta: success ? 3 - casualties : -4 - casualties,
      fundDeltaCents: execution.fundDeltaCents,
      corruptionDelta: success ? -1 : 1 + Math.floor(casualties / 2)
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
      const legacyCeremonyDay = done?.ceremonyDay ?? (world.currentDay >= 15 ? world.currentDay - (world.currentDay % 15) : 0);
      const legacyAwards = (done?.awards ?? []).map((award) => ({
        order: award.orderNo,
        npcName: award.recipientName,
        division: 'N/A',
        unit: 'N/A',
        position: 'N/A',
        medalName: award.medal,
        ribbonName: award.ribbon,
        reason: award.reason
      }));

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
      await applyLegacyGovernanceDelta(client, {
        profileId,
        nationalDelta: 1,
        militaryDelta: 2,
        corruptionDelta: -1
      });
      await client.query(
        `
          UPDATE game_states
          SET
            current_day = GREATEST(current_day, $2),
            ceremony_completed_day = GREATEST(ceremony_completed_day, $3),
            ceremony_recent_awards = $4::jsonb,
            server_reference_time_ms = CASE
              WHEN pause_reason = 'SUBPAGE'::pause_reason AND paused_at_ms IS NOT NULL
                THEN server_reference_time_ms + GREATEST(0, $5 - paused_at_ms)
              ELSE server_reference_time_ms
            END,
            paused_at_ms = CASE WHEN pause_reason = 'SUBPAGE'::pause_reason THEN NULL ELSE paused_at_ms END,
            pause_reason = CASE WHEN pause_reason = 'SUBPAGE'::pause_reason THEN NULL ELSE pause_reason END,
            pause_token = CASE WHEN pause_reason = 'SUBPAGE'::pause_reason THEN NULL ELSE pause_token END,
            pause_expires_at_ms = CASE WHEN pause_reason = 'SUBPAGE'::pause_reason THEN NULL ELSE pause_expires_at_ms END,
            updated_at = now()
          WHERE profile_id = $1
        `,
        [profileId, world.currentDay, legacyCeremonyDay, JSON.stringify(legacyAwards), nowMs]
      );
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
  if (token.includes('DIPLOMA')) return true;
  return (
    token === 'OFFICER_FOUNDATION' ||
    token === 'HIGH_COMMAND_STRATEGY' ||
    token === 'SPECIALIST_CYBER_OPS' ||
    token === 'TRIBUNAL_RULES_OF_ENGAGEMENT'
  );
}

function resolveBaseCertCode(track: string, tier: number): string {
  const normalized = track.toUpperCase();
  const normalizedTier = tier >= 3 ? 3 : tier <= 1 ? 1 : 2;
  if (normalized === 'HIGH_COMMAND') return `HIGH_COMMAND_DIPLOMA_T${normalizedTier}`;
  if (normalized === 'CYBER') return `CYBER_DIPLOMA_T${normalizedTier}`;
  if (normalized === 'TRIBUNAL') return `TRIBUNAL_DIPLOMA_T${normalizedTier}`;
  if (normalized === 'SPECIALIST') return `SPECIALIST_DIPLOMA_T${normalizedTier}`;
  return `OFFICER_DIPLOMA_T${normalizedTier}`;
}

function gradeBonus(grade: 'A' | 'B' | 'C' | 'D'): number {
  if (grade === 'A') return 20;
  if (grade === 'B') return 14;
  if (grade === 'C') return 8;
  return 3;
}

function scoreFromGrade(grade: 'A' | 'B' | 'C' | 'D', certTier: 1 | 2 | 3): number {
  const base = grade === 'A' ? 94 : grade === 'B' ? 86 : grade === 'C' ? 77 : 66;
  return clamp(base + (certTier - 1) * 2, 0, 100);
}

function resolveTrackLabel(track: string): string {
  const normalized = track.toUpperCase();
  if (normalized === 'HIGH_COMMAND') return 'High Command';
  if (normalized === 'SPECIALIST') return 'Specialist';
  if (normalized === 'TRIBUNAL') return 'Tribunal';
  if (normalized === 'CYBER') return 'Cyber';
  return 'Officer';
}

function divisionFreedomFromCertification(cert: CertificationRecordV5): AcademyCertificate['divisionFreedomLevel'] {
  if (!cert.valid) return 'LIMITED';
  if (cert.tier >= 3) return cert.grade === 'A' ? 'ELITE' : 'ADVANCED';
  if (cert.tier === 2) return cert.grade === 'A' || cert.grade === 'B' ? 'ADVANCED' : 'STANDARD';
  return cert.grade === 'A' ? 'STANDARD' : 'LIMITED';
}

function academyNameFromCertification(cert: CertificationRecordV5): string {
  const trackLabel = resolveTrackLabel(cert.track);
  const code = cert.certCode.toUpperCase();
  if (code.includes('DIPLOMA')) return `Diploma Academy ${trackLabel} T${cert.tier}`;
  if (code.includes('ADV_CERT') || code.includes('EXTRA_CERT')) return `Sertifikasi Lanjutan ${trackLabel} T${cert.tier}`;
  return `Sertifikasi ${trackLabel} T${cert.tier}`;
}

function mapCertificationToInventoryCertificate(cert: CertificationRecordV5): AcademyCertificate {
  const trackLabel = resolveTrackLabel(cert.track);
  return {
    id: cert.certId,
    tier: cert.tier,
    academyName: academyNameFromCertification(cert),
    score: scoreFromGrade(cert.grade, cert.tier),
    grade: cert.grade,
    divisionFreedomLevel: divisionFreedomFromCertification(cert),
    trainerName: 'Military Academy Board V5',
    issuedAtDay: cert.issuedDay,
    message: cert.valid
      ? `${cert.certCode} valid hingga day ${cert.expiresDay}.`
      : `${cert.certCode} tidak valid karena skor di bawah ambang lulus.`,
    assignedDivision: `${trackLabel} Corps`
  };
}

function listPlayerInventoryCertificates(certifications: CertificationRecordV5[]): AcademyCertificate[] {
  return certifications
    .filter((item) => item.valid && item.holderType === 'PLAYER')
    .slice()
    .sort((a, b) => {
      if (b.issuedDay !== a.issuedDay) return b.issuedDay - a.issuedDay;
      if (b.tier !== a.tier) return b.tier - a.tier;
      return b.certCode.localeCompare(a.certCode);
    })
    .map((item) => mapCertificationToInventoryCertificate(item));
}

function hasEducationPrefix(baseName: string): boolean {
  return baseName.trim().toUpperCase().startsWith('DR.');
}

function hasEducationSuffix(baseName: string): boolean {
  return baseName.trim().toUpperCase().endsWith('S.ML');
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

const RECRUITMENT_PIPELINE_TOTAL_DAYS = 4;
const DOM_OPERATION_CYCLE_DAYS = 13;
const DOM_PLAYER_SESSION_NO: 1 = 1;
const DOM_PLAYER_NPC_SLOTS = 8;
const COMMAND_CHAIN_DEFAULT_HOPS = 3;
const DOM_MEDAL_POOL_MIN = 3;
const DOM_MEDAL_POOL_MAX = 8;

function computeRaiderCadenceDays(threatScore: number): number {
  if (threatScore >= 75) return 7;
  if (threatScore >= 50) return 9;
  return 11;
}

function computeRaiderThreatScore(governance: {
  nationalStability: number;
  militaryStability: number;
  corruptionRisk: number;
}): number {
  return clamp(
    Math.round(
      ((100 - governance.nationalStability) * 0.42) +
        ((100 - governance.militaryStability) * 0.38) +
        governance.corruptionRisk * 0.2
    ),
    0,
    100
  );
}

function computeDomCycleMedalPool(
  world: { commandAuthority: number; morale: number; health: number },
  governance: { militaryStability: number; nationalStability: number }
): number {
  const readinessFactor = (world.commandAuthority + world.morale + world.health) / 3;
  const stabilityFactor = (governance.militaryStability + governance.nationalStability) / 2;
  const rawPool = Math.round(4 + readinessFactor / 28 + (stabilityFactor - 50) / 25);
  return clamp(rawPool, DOM_MEDAL_POOL_MIN, DOM_MEDAL_POOL_MAX);
}

function sumAllocatedCycleMedals(sessions: DomOperationCycle['sessions']): number {
  return sessions.reduce((sum, session) => {
    if (session.status !== 'COMPLETED') return sum;
    const quota = Number(session.result?.medalQuota ?? 0);
    return sum + (Number.isFinite(quota) ? Math.max(0, Math.floor(quota)) : 0);
  }, 0);
}

function decorateNameWithEducationTitles(
  baseName: string,
  certifications: CertificationRecordV5[],
  titles: EducationTitle[]
): string {
  const validCerts = certifications.filter((item) => item.valid);
  const diplomaTierSet = new Set<number>(
    validCerts.filter((item) => isBaseDiplomaCertCode(item.certCode)).map((item) => item.tier)
  );
  const completedThreeAcademyTiers = diplomaTierSet.has(1) && diplomaTierSet.has(2) && diplomaTierSet.has(3);
  const hasAnyDiploma = diplomaTierSet.size > 0;

  const matched = titles.filter((title) =>
    validCerts.some(
      (cert) =>
        cert.valid &&
        cert.tier >= title.minTier &&
        (cert.certCode.toUpperCase() === title.titleCode.toUpperCase() || cert.track.toUpperCase() === title.sourceTrack.toUpperCase())
    )
  );
  const catalogSuffix = matched
    .filter((item) => item.mode === 'SUFFIX')
    .sort((a, b) => b.minTier - a.minTier)[0];

  const selectedPrefix = completedThreeAcademyTiers ? 'Dr.' : '';
  const selectedSuffix = hasAnyDiploma ? 'S.Ml' : catalogSuffix?.label ?? '';
  const left = selectedPrefix && !hasEducationPrefix(baseName) ? `${selectedPrefix} ` : '';
  const right = selectedSuffix && !hasEducationSuffix(baseName) ? ` ${selectedSuffix}` : '';
  return `${left}${baseName}${right}`.trim();
}

async function pushMailboxAndTimeline(
  client: import('pg').PoolClient,
  input: {
    profileId: string;
    worldDay: number;
    category: MailboxMessage['category'];
    subject: string;
    body: string;
    relatedRef?: string | null;
    timelineEventType: string;
    timelineTitle: string;
    timelineDetail: string;
    actorType?: 'PLAYER' | 'NPC';
    actorNpcId?: string | null;
  }
): Promise<void> {
  await insertMailboxMessage(client, {
    messageId: `mail-${input.profileId.slice(0, 8)}-${input.worldDay}-${randomUUID().slice(0, 8)}`,
    profileId: input.profileId,
    senderType: 'SYSTEM',
    senderNpcId: null,
    subject: input.subject,
    body: input.body,
    category: input.category,
    relatedRef: input.relatedRef ?? null,
    createdDay: input.worldDay
  });

  await insertSocialTimelineEvent(client, {
    profileId: input.profileId,
    actorType: input.actorType ?? 'PLAYER',
    actorNpcId: input.actorNpcId ?? null,
    eventType: input.timelineEventType,
    title: input.timelineTitle,
    detail: input.timelineDetail,
    eventDay: input.worldDay,
    meta: {
      category: input.category,
      relatedRef: input.relatedRef ?? null
    }
  });
}

async function ensureCouncilsInitialized(
  client: import('pg').PoolClient,
  profileId: string,
  worldDay: number
): Promise<CouncilState[]> {
  const existing = await listCouncils(client, profileId, { limit: 20 });
  const byType = new Map(existing.map((item) => [item.councilType, item]));
  const defaults: Array<{ councilType: CouncilState['councilType']; agenda: string; quorum: number }> = [
    { councilType: 'MLC', agenda: 'Evaluasi dan amandemen Military Law aktif.', quorum: 5 },
    { councilType: 'DOM', agenda: 'Perencanaan siklus operasi DOM 13-hari.', quorum: 4 },
    { councilType: 'PERSONNEL_BOARD', agenda: 'Promosi, demosi, mutasi, dan distribusi jabatan.', quorum: 4 },
    { councilType: 'STRATEGIC_COUNCIL', agenda: 'Arah strategi nasional dan stabilitas militer.', quorum: 5 }
  ];
  for (const item of defaults) {
    if (byType.has(item.councilType)) continue;
    const councilId = `${item.councilType.toLowerCase()}-${profileId.slice(0, 8)}-${worldDay}`;
    await upsertCouncilState(client, {
      profileId,
      councilId,
      councilType: item.councilType,
      agenda: item.agenda,
      status: 'OPEN',
      openedDay: worldDay,
      closedDay: null,
      quorum: item.quorum,
      votes: { approve: 0, reject: 0, abstain: 0 }
    });
  }
  return listCouncils(client, profileId, { limit: 20 });
}

async function ensureDomCycleCurrent(
  client: import('pg').PoolClient,
  profileId: string,
  worldDay: number
): Promise<DomOperationCycle> {
  const cycleStart = worldDay - (worldDay % DOM_OPERATION_CYCLE_DAYS);
  const cycleEnd = cycleStart + (DOM_OPERATION_CYCLE_DAYS - 1);
  const cycleId = `dom-${profileId.slice(0, 8)}-${cycleStart}`;

  const current = await getCurrentDomOperationCycle(client, profileId);
  if (current && current.startDay !== cycleStart && current.status === 'ACTIVE') {
    await updateDomOperationCycleStatus(client, { profileId, cycleId: current.cycleId, status: 'COMPLETED' });
  }

  await createDomOperationCycle(client, {
    cycleId,
    profileId,
    startDay: cycleStart,
    endDay: cycleEnd,
    status: worldDay > cycleEnd ? 'COMPLETED' : 'ACTIVE'
  });

  for (let sessionNo = 1; sessionNo <= 3; sessionNo += 1) {
    const sessionId = `${cycleId}-s${sessionNo}`;
    const existing = await getDomOperationSession(client, profileId, sessionId);
    await upsertDomOperationSession(client, {
      sessionId,
      cycleId,
      profileId,
      sessionNo: sessionNo as 1 | 2 | 3,
      participantMode: sessionNo === DOM_PLAYER_SESSION_NO ? 'PLAYER_ELIGIBLE' : 'NPC_ONLY',
      npcSlots: sessionNo === DOM_PLAYER_SESSION_NO ? DOM_PLAYER_NPC_SLOTS : 12,
      playerJoined: existing?.playerJoined ?? false,
      playerJoinDay: existing?.playerJoinDay ?? null,
      status: existing?.status ?? 'PLANNED',
      result: existing?.result ?? {}
    });
  }

  const resolved = await getCurrentDomOperationCycle(client, profileId);
  if (!resolved) {
    throw new Error('Failed to ensure DOM cycle');
  }
  return resolved;
}

function buildRecruitmentPipelineFinalScore(input: {
  tryoutScore: number;
  commandAuthority: number;
  morale: number;
  health: number;
  extraCertCount: number;
}): number {
  const certFactor = clamp(input.extraCertCount * 3.5, 0, 15);
  const stabilityFactor = clamp(input.commandAuthority * 0.45 + input.morale * 0.35 + input.health * 0.2, 0, 100);
  return Number(clamp(input.tryoutScore * 0.62 + stabilityFactor * 0.28 + certFactor, 0, 100).toFixed(2));
}

function buildDefaultCommandChainPath(input: {
  npcs: Array<{ npcId: string; division: string; status: string; leadership: number; loyalty: number; integrityRisk: number; betrayalRisk: number }>;
  targetNpcId: string | null;
  targetDivision: string | null;
}): string[] {
  const active = input.npcs.filter((npc) => npc.status === 'ACTIVE');
  const scoped = input.targetDivision ? active.filter((npc) => npc.division === input.targetDivision) : active;
  const pool = (scoped.length > 0 ? scoped : active).slice();
  pool.sort((a, b) => {
    const scoreA = a.leadership * 1.3 + a.loyalty - a.integrityRisk * 0.7 - a.betrayalRisk * 0.9;
    const scoreB = b.leadership * 1.3 + b.loyalty - b.integrityRisk * 0.7 - b.betrayalRisk * 0.9;
    return scoreB - scoreA;
  });
  const path = pool.slice(0, COMMAND_CHAIN_DEFAULT_HOPS).map((npc) => npc.npcId);
  if (input.targetNpcId && !path.includes(input.targetNpcId)) {
    path.push(input.targetNpcId);
  }
  return Array.from(new Set(path)).slice(0, 12);
}

function normalizeCommandChainPath(path: string[], targetNpcId: string | null): string[] {
  const cleaned = Array.from(new Set(path.filter((item) => typeof item === 'string' && item.length >= 3))).slice(0, 12);
  if (targetNpcId && !cleaned.includes(targetNpcId)) {
    cleaned.push(targetNpcId);
  }
  return cleaned;
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

    const totalDays = academyTotalDaysForTier(payload.tier);
    const batchId = `batch-${profileId.slice(0, 8)}-${world.currentDay}-${randomUUID().slice(0, 8)}`;
    await createAcademyBatch(client, {
      batchId,
      profileId,
      track: payload.track,
      tier: payload.tier,
      startDay: world.currentDay,
      endDay: world.currentDay + (totalDays - 1),
      totalDays
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
      batch && batch.status === 'ACTIVE' && batch.lockEnabled && batch.playerDayProgress < batch.totalDays
        ? buildAcademyQuestionSet(batch.track, batch.playerDayProgress + 1, batch.totalDays)
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
    if (playerMember.dayProgress >= batch.totalDays) {
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
    const questionSet = buildAcademyQuestionSet(batch.track, academyDay, batch.totalDays);
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
    const autoGraduationPayload = await autoFinalizeAcademyBatchIfReady(client, profileId, batch, world.currentDay);

    invalidateExpansionStateCache(profileId);
    const state = await buildExpansionState(client, profileId, nowMs);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        submitted: true,
        academyDay,
        dayScore,
        dayPassed: dayScore >= 70,
        readyToGraduate: nextProgress >= batch.totalDays && !autoGraduationPayload,
        graduated: Boolean(autoGraduationPayload),
        graduation: autoGraduationPayload,
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
    if (!playerMember || playerMember.dayProgress < batch.totalDays) {
      return { statusCode: 409, payload: { error: `Progress academy belum mencapai hari ke-${batch.totalDays}.` } };
    }
    if (world.currentDay < batch.endDay) {
      return { statusCode: 409, payload: { error: `Graduation belum tersedia. Selesaikan hingga day ke-${batch.totalDays} dunia game.` } };
    }

    const graduationPayload = await finalizeAcademyBatchGraduation(client, profileId, batch, world.currentDay);

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

    const requirement = requirementTierForDivision(division);
    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const certSummary = summarizePlayerCertifications(playerCerts);
    const minimumAcademyTier = minimumAcademyTierForDivision(division);
    if (!certSummary.hasBaseDiploma || certSummary.extraCertCount < requirement.minExtraCerts) {
      return {
        statusCode: 409,
        payload: {
          error: !certSummary.hasBaseDiploma
            ? 'Sertifikasi dasar academy (diploma) belum terdeteksi.'
            : `Sertifikasi tambahan belum cukup (${certSummary.extraCertCount}/${requirement.minExtraCerts}).`,
          code: !certSummary.hasBaseDiploma ? 'MISSING_BASE_DIPLOMA' : 'MISSING_EXTRA_CERT',
          requirement,
          minimumAcademyTier
        }
      };
    }

    const activeApplications = await listRecruitmentPipelineApplications(client, profileId, { holderType: 'PLAYER', limit: 20 });
    const activeApplication = activeApplications.find(
      (item) => item.status === 'REGISTRATION' || item.status === 'TRYOUT' || item.status === 'SELECTION'
    );
    if (activeApplication && activeApplication.division !== division) {
      return {
        statusCode: 409,
        payload: {
          error: `Masih ada aplikasi aktif di ${activeApplication.division}.`,
          code: 'ACTIVE_APPLICATION_EXISTS',
          application: activeApplication
        }
      };
    }

    const payloadFor = async (
      application: RecruitmentPipelineState,
      input: {
        stage: 'REGISTRATION' | 'TRYOUT' | 'SELECTION' | 'ANNOUNCEMENT';
        accepted?: boolean;
        message: string;
        code: string;
        reason: string;
        quota?: DivisionQuotaState | null;
      }
    ) => {
      invalidateExpansionStateCache(profileId);
      const state = await buildExpansionState(client, profileId, nowMs, application.division);
      const snapshot = await buildSnapshotV5(client, profileId, nowMs);
      const quota = input.quota ?? state.quotaBoard.find((item) => item.division === application.division) ?? null;
      const accepted = Boolean(input.accepted);
      return {
        accepted,
        division: application.division,
        requirement,
        examScore: application.tryoutScore,
        compositeScore: application.finalScore,
        acceptedSlots: accepted ? 1 : 0,
        quota,
        playerDecision: {
          status: accepted ? ('ACCEPTED' as const) : ('REJECTED' as const),
          code: input.code,
          reason: input.reason
        },
        playerEntry: null,
        raceTop10: state.recruitmentRace.top10,
        stage: input.stage,
        application,
        schedule: {
          registrationDay: application.registeredDay,
          tryoutDay: application.registeredDay + 1,
          selectionDay: application.registeredDay + 2,
          announcementDay: application.registeredDay + 3,
          totalDays: RECRUITMENT_PIPELINE_TOTAL_DAYS
        },
        message: input.message,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      };
    };

    if (!activeApplication) {
      const titleCatalog = await listEducationTitles(client);
      const displayName = decorateNameWithEducationTitles(world.playerName, playerCerts, titleCatalog);
      const application = await upsertRecruitmentPipelineApplication(client, {
        profileId,
        applicationId: `rap-${profileId.slice(0, 8)}-${world.currentDay}-${randomUUID().slice(0, 8)}`,
        holderType: 'PLAYER',
        npcId: null,
        holderName: displayName,
        division,
        status: 'REGISTRATION',
        registeredDay: world.currentDay,
        tryoutDay: null,
        selectionDay: null,
        announcementDay: null,
        tryoutScore: 0,
        finalScore: 0,
        note: 'LEGACY_WRAPPER_REGISTRATION'
      });

      await pushMailboxAndTimeline(client, {
        profileId,
        worldDay: world.currentDay,
        category: 'GENERAL',
        subject: `Registrasi Rekrutmen Divisi: ${division}`,
        body: 'Aplikasi legacy diterjemahkan ke pipeline Day 1/4. Lanjutkan saat day gate terbuka.',
        relatedRef: application.applicationId,
        timelineEventType: 'RECRUITMENT_REGISTRATION',
        timelineTitle: 'Registrasi Divisi (Wrapper)',
        timelineDetail: `Wrapper legacy mengunci tahap REGISTRATION untuk ${division}.`
      });

      return {
        payload: await payloadFor(application, {
          stage: 'REGISTRATION',
          message: 'Registrasi berhasil. Tryout tersedia pada hari ke-2 pipeline.',
          code: 'REGISTERED',
          reason: 'Menunggu tryout (day-2).'
        })
      };
    }

    if (activeApplication.status === 'REGISTRATION') {
      if (world.currentDay < activeApplication.registeredDay + 1) {
        return {
          payload: await payloadFor(activeApplication, {
            stage: 'REGISTRATION',
            message: 'Tryout belum tersedia. Tunggu day gate hari ke-2.',
            code: 'WAIT_TRYOUT_DAY',
            reason: `Tryout tersedia pada day ${activeApplication.registeredDay + 1}.`
          })
        };
      }

      const tryoutScore = scoreRecruitmentExam(activeApplication.division, payload.answers);
      const updated = await upsertRecruitmentPipelineApplication(client, {
        profileId,
        ...activeApplication,
        status: 'TRYOUT',
        tryoutDay: world.currentDay,
        tryoutScore,
        note: 'LEGACY_WRAPPER_TRYOUT_COMPLETED'
      });

      await pushMailboxAndTimeline(client, {
        profileId,
        worldDay: world.currentDay,
        category: 'GENERAL',
        subject: `Hasil Tryout ${activeApplication.division}`,
        body: `Tryout wrapper selesai dengan skor ${tryoutScore}. Selection tersedia pada Day 3 pipeline.`,
        relatedRef: activeApplication.applicationId,
        timelineEventType: 'RECRUITMENT_TRYOUT',
        timelineTitle: 'Tryout Selesai (Wrapper)',
        timelineDetail: `Skor tryout ${activeApplication.division}: ${tryoutScore}.`
      });

      return {
        payload: await payloadFor(updated, {
          stage: 'TRYOUT',
          message: 'Tryout selesai. Selection bisa diproses pada hari ke-3 pipeline.',
          code: 'TRYOUT_COMPLETED',
          reason: 'Menunggu selection (day-3).'
        })
      };
    }

    if (activeApplication.status === 'TRYOUT') {
      if (world.currentDay < activeApplication.registeredDay + 2) {
        return {
          payload: await payloadFor(activeApplication, {
            stage: 'TRYOUT',
            message: 'Selection belum tersedia. Tunggu day gate hari ke-3.',
            code: 'WAIT_SELECTION_DAY',
            reason: `Selection tersedia pada day ${activeApplication.registeredDay + 2}.`
          })
        };
      }

      const finalScore = buildRecruitmentPipelineFinalScore({
        tryoutScore: activeApplication.tryoutScore,
        commandAuthority: world.commandAuthority,
        morale: world.morale,
        health: world.health,
        extraCertCount: certSummary.extraCertCount
      });

      const updated = await upsertRecruitmentPipelineApplication(client, {
        profileId,
        ...activeApplication,
        status: 'SELECTION',
        selectionDay: world.currentDay,
        finalScore,
        note: 'LEGACY_WRAPPER_SELECTION_SCORED'
      });

      await pushMailboxAndTimeline(client, {
        profileId,
        worldDay: world.currentDay,
        category: 'GENERAL',
        subject: `Tahap Selection ${activeApplication.division}`,
        body: `Selection wrapper selesai. Final score sementara: ${finalScore}. Announcement tersedia Day 4.`,
        relatedRef: activeApplication.applicationId,
        timelineEventType: 'RECRUITMENT_SELECTION',
        timelineTitle: 'Selection Selesai (Wrapper)',
        timelineDetail: `Final score ${activeApplication.division}: ${finalScore}.`
      });

      return {
        payload: await payloadFor(updated, {
          stage: 'SELECTION',
          message: 'Selection selesai. Announcement tersedia pada hari ke-4 pipeline.',
          code: 'SELECTION_COMPLETED',
          reason: 'Menunggu announcement (day-4).'
        })
      };
    }

    if (activeApplication.status === 'SELECTION') {
      if (world.currentDay < activeApplication.registeredDay + 3) {
        return {
          payload: await payloadFor(activeApplication, {
            stage: 'SELECTION',
            message: 'Announcement belum tersedia. Tunggu day gate hari ke-4.',
            code: 'WAIT_ANNOUNCEMENT_DAY',
            reason: `Announcement tersedia pada day ${activeApplication.registeredDay + 3}.`
          })
        };
      }

      const meetsScore = activeApplication.finalScore >= 68;
      const quotaDecision = meetsScore
        ? await reserveDivisionQuotaSlot(client, {
            profileId,
            division: activeApplication.division,
            currentDay: world.currentDay
          })
        : { accepted: false as const, reason: 'QUOTA_FULL' as const, quota: null as DivisionQuotaState | null };
      const accepted = meetsScore && quotaDecision.accepted;

      const announcementNote = accepted
        ? 'LEGACY_WRAPPER_ANNOUNCEMENT_ACCEPTED'
        : meetsScore
          ? quotaDecision.reason === 'COOLDOWN'
            ? 'LEGACY_WRAPPER_ANNOUNCEMENT_REJECTED_QUOTA_COOLDOWN'
            : quotaDecision.reason === 'MISSING_QUOTA'
              ? 'LEGACY_WRAPPER_ANNOUNCEMENT_REJECTED_QUOTA_MISSING'
              : 'LEGACY_WRAPPER_ANNOUNCEMENT_REJECTED_QUOTA_FULL'
          : 'LEGACY_WRAPPER_ANNOUNCEMENT_REJECTED_SCORE';
      const announced = await upsertRecruitmentPipelineApplication(client, {
        profileId,
        ...activeApplication,
        status: accepted ? 'ANNOUNCEMENT_ACCEPTED' : 'ANNOUNCEMENT_REJECTED',
        announcementDay: world.currentDay,
        note: announcementNote
      });

      if (accepted) {
        const [oldDivisionRaw, oldPositionRaw] = world.assignment.split('-').map((item) => item.trim());
        const oldDivision = oldDivisionRaw && oldDivisionRaw.length > 0 ? oldDivisionRaw : 'Nondivisi';
        const oldPosition = oldPositionRaw && oldPositionRaw.length > 0 ? oldPositionRaw : world.assignment;
        const newPosition = 'Probationary Officer';
        await updateWorldCore(client, {
          profileId,
          stateVersion: world.stateVersion + 1,
          lastTickMs: nowMs,
          currentDay: world.currentDay,
          moneyCents: world.moneyCents,
          morale: clamp(world.morale + 2, 0, 100),
          health: world.health,
          rankIndex: world.rankIndex,
          assignment: `${activeApplication.division} - ${newPosition}`,
          commandAuthority: clamp(world.commandAuthority + 2, 0, 100)
        });
        await client.query(
          `
            UPDATE game_states
            SET player_division = $2, player_position = $3, updated_at = now()
            WHERE profile_id = $1
          `,
          [profileId, activeApplication.division, newPosition]
        );
        await insertAssignmentHistory(client, {
          profileId,
          actorType: 'PLAYER',
          npcId: null,
          oldDivision,
          newDivision: activeApplication.division,
          oldPosition,
          newPosition,
          reason: 'RECRUITMENT_PIPELINE_ACCEPTED_WRAPPER',
          changedDay: world.currentDay
        });
      }

      await pushMailboxAndTimeline(client, {
        profileId,
        worldDay: world.currentDay,
        category: accepted ? 'MUTATION' : 'GENERAL',
        subject: accepted
          ? `Announcement: Diterima ${activeApplication.division}`
          : `Announcement: Gagal ${activeApplication.division}`,
        body: accepted
          ? `Selamat, Anda diterima di ${activeApplication.division}. Penugasan awal sebagai Probationary Officer.`
          : meetsScore
            ? 'Skor memenuhi batas tetapi kuota tidak tersedia saat announcement.'
            : 'Aplikasi belum lolos karena final score di bawah batas.',
        relatedRef: activeApplication.applicationId,
        timelineEventType: 'RECRUITMENT_ANNOUNCEMENT',
        timelineTitle: accepted ? 'Recruitment Accepted (Wrapper)' : 'Recruitment Rejected (Wrapper)',
        timelineDetail: accepted
          ? `Diterima di ${activeApplication.division} pada Day 4 pipeline.`
          : `Belum lolos di ${activeApplication.division}.`
      });

      const rejectionCode = !meetsScore
        ? 'COMPOSITE_SCORE_BELOW_CUTOFF'
        : quotaDecision.reason === 'COOLDOWN'
          ? 'QUOTA_COOLDOWN'
          : quotaDecision.reason === 'MISSING_QUOTA'
            ? 'MISSING_QUOTA'
            : 'QUOTA_FULL';
      const rejectionReason = !meetsScore
        ? 'Skor akhir di bawah ambang kelulusan.'
        : quotaDecision.reason === 'COOLDOWN'
          ? 'Kuota sedang cooldown.'
          : quotaDecision.reason === 'MISSING_QUOTA'
            ? 'Data kuota divisi belum tersedia.'
            : 'Kuota divisi telah habis.';

      return {
        payload: await payloadFor(announced, {
          stage: 'ANNOUNCEMENT',
          accepted,
          message: accepted
            ? 'Wrapper legacy berhasil menuntaskan pipeline 4 tahap: status diterima.'
            : 'Wrapper legacy menuntaskan pipeline 4 tahap: status belum diterima.',
          code: accepted ? 'ACCEPTED' : rejectionCode,
          reason: accepted ? 'Lolos seleksi kuota divisi.' : rejectionReason,
          quota: quotaDecision.quota
        })
      };
    }

    const lastState = await buildExpansionState(client, profileId, nowMs, division);
    const lastQuota = lastState.quotaBoard.find((item) => item.division === division) ?? null;
    const accepted = activeApplication.status === 'ANNOUNCEMENT_ACCEPTED';
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        accepted,
        division: activeApplication.division,
        requirement,
        examScore: activeApplication.tryoutScore,
        compositeScore: activeApplication.finalScore,
        acceptedSlots: accepted ? 1 : 0,
        quota: lastQuota,
        playerDecision: {
          status: accepted ? 'ACCEPTED' : 'REJECTED',
          code: accepted ? 'ACCEPTED' : 'ANNOUNCEMENT_REJECTED',
          reason: accepted ? 'Lolos seleksi kuota divisi.' : 'Aplikasi sudah ditutup dengan status rejected.'
        },
        playerEntry: null,
        raceTop10: lastState.recruitmentRace.top10,
        stage: 'ANNOUNCEMENT',
        application: activeApplication,
        schedule: {
          registrationDay: activeApplication.registeredDay,
          tryoutDay: activeApplication.registeredDay + 1,
          selectionDay: activeApplication.registeredDay + 2,
          announcementDay: activeApplication.registeredDay + 3,
          totalDays: RECRUITMENT_PIPELINE_TOTAL_DAYS
        },
        message: 'Aplikasi pipeline sudah berada pada tahap final.',
        state: lastState,
        snapshot: snapshot ? { ...snapshot, expansion: lastState } : null
      }
    };
  });
}

export async function getRankHistoryV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const entries = await listRankHistory(client, profileId, { limit: 160 });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { items: entries, snapshot } };
  });
}

export async function getDivisionsCatalogV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const state = await buildExpansionState(client, profileId, nowMs);
    const quotasByDivision = new Map(state.quotaBoard.map((item) => [item.division, item]));
    const items = DIVISION_REFERENCE_PROFILES.map((division) => ({
      ...division,
      requirement: requirementTierForDivision(division.name),
      quota: quotasByDivision.get(division.name) ?? null
    }));
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { items, snapshot: snapshot ? { ...snapshot, expansion: state } : null } };
  });
}

export async function registerDivisionApplicationV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { division: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const lockBlocked = await guardAcademyLockResponse(client, profileId);
    if (lockBlocked) return lockBlocked;

    const division = payload.division.trim();
    if (!REGISTERED_DIVISIONS.some((item) => item.name === division)) {
      return { statusCode: 404, payload: { error: 'Division tidak terdaftar.' } };
    }
    const requirement = requirementTierForDivision(division);
    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const certSummary = summarizePlayerCertifications(playerCerts);
    if (!certSummary.hasBaseDiploma) {
      return {
        statusCode: 409,
        payload: {
          error: 'Sertifikasi dasar academy (Tier-1) belum terdeteksi.',
          code: 'MISSING_BASE_DIPLOMA',
          requirement
        }
      };
    }
    if (certSummary.extraCertCount < requirement.minExtraCerts) {
      return {
        statusCode: 409,
        payload: {
          error: `Sertifikasi tambahan belum cukup (${certSummary.extraCertCount}/${requirement.minExtraCerts}).`,
          code: 'MISSING_EXTRA_CERT',
          requirement
        }
      };
    }

    const activeApplications = await listRecruitmentPipelineApplications(client, profileId, { holderType: 'PLAYER', limit: 20 });
    const openApplication = activeApplications.find(
      (item) => item.status === 'REGISTRATION' || item.status === 'TRYOUT' || item.status === 'SELECTION'
    );
    if (openApplication) {
      return {
        statusCode: 409,
        payload: {
          error: 'Masih ada aplikasi rekrutmen aktif. Selesaikan aplikasi sebelumnya.',
          application: openApplication
        }
      };
    }

    const titleCatalog = await listEducationTitles(client);
    const displayName = decorateNameWithEducationTitles(world.playerName, playerCerts, titleCatalog);
    const application = await upsertRecruitmentPipelineApplication(client, {
      profileId,
      applicationId: `rap-${profileId.slice(0, 8)}-${world.currentDay}-${randomUUID().slice(0, 8)}`,
      holderType: 'PLAYER',
      npcId: null,
      holderName: displayName,
      division,
      status: 'REGISTRATION',
      registeredDay: world.currentDay,
      tryoutDay: null,
      selectionDay: null,
      announcementDay: null,
      tryoutScore: 0,
      finalScore: 0,
      note: 'REGISTRATION_LOCKED'
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'GENERAL',
      subject: `Registrasi Rekrutmen Divisi: ${division}`,
      body: 'Registrasi kandidat diterima. Tryout dapat dijalankan mulai hari ke-2 pipeline.',
      relatedRef: application.applicationId,
      timelineEventType: 'RECRUITMENT_REGISTRATION',
      timelineTitle: 'Registrasi Divisi',
      timelineDetail: `Aplikasi ${division} masuk tahap REGISTRATION (Day 1/4).`
    });

    invalidateExpansionStateCache(profileId);
    const state = await buildExpansionState(client, profileId, nowMs, division);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        application,
        schedule: {
          registrationDay: application.registeredDay,
          tryoutDay: application.registeredDay + 1,
          selectionDay: application.registeredDay + 2,
          announcementDay: application.registeredDay + 3,
          totalDays: RECRUITMENT_PIPELINE_TOTAL_DAYS
        },
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function runDivisionApplicationTryoutV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { applicationId: string; answers: number[] }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const application = await getRecruitmentPipelineApplication(client, profileId, payload.applicationId);
    if (!application) {
      return { statusCode: 404, payload: { error: 'Application tidak ditemukan.' } };
    }
    if (application.status !== 'REGISTRATION') {
      return { statusCode: 409, payload: { error: 'Tryout hanya bisa dijalankan setelah REGISTRATION.' } };
    }
    if (world.currentDay < application.registeredDay + 1) {
      return {
        statusCode: 409,
        payload: {
          error: 'Tryout baru tersedia pada hari ke-2 pipeline.',
          currentDay: world.currentDay,
          requiredDay: application.registeredDay + 1
        }
      };
    }

    const tryoutScore = scoreRecruitmentExam(application.division, payload.answers);
    const updated = await upsertRecruitmentPipelineApplication(client, {
      profileId,
      ...application,
      status: 'TRYOUT',
      tryoutDay: world.currentDay,
      tryoutScore,
      note: 'TRYOUT_COMPLETED'
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'GENERAL',
      subject: `Hasil Tryout ${application.division}`,
      body: `Tryout selesai dengan skor ${tryoutScore}. Tahap berikutnya: Selection (Day 3).`,
      relatedRef: application.applicationId,
      timelineEventType: 'RECRUITMENT_TRYOUT',
      timelineTitle: 'Tryout Selesai',
      timelineDetail: `Skor tryout ${application.division}: ${tryoutScore}.`
    });

    invalidateExpansionStateCache(profileId);
    const state = await buildExpansionState(client, profileId, nowMs, application.division);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        application: updated,
        nextStageAvailableDay: application.registeredDay + 2,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function finalizeDivisionApplicationV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { applicationId: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const application = await getRecruitmentPipelineApplication(client, profileId, payload.applicationId);
    if (!application) {
      return { statusCode: 404, payload: { error: 'Application tidak ditemukan.' } };
    }

    if (application.status === 'REGISTRATION') {
      return { statusCode: 409, payload: { error: 'Tidak bisa melompat tahap. Jalankan TRYOUT terlebih dahulu.' } };
    }

    if (application.status === 'TRYOUT') {
      if (world.currentDay < application.registeredDay + 2) {
        return {
          statusCode: 409,
          payload: {
            error: 'Tahap Selection tersedia pada hari ke-3 pipeline.',
            currentDay: world.currentDay,
            requiredDay: application.registeredDay + 2
          }
        };
      }

      const certs = await listCertifications(client, profileId, { holderType: 'PLAYER' });
      const certSummary = summarizePlayerCertifications(certs);
      const finalScore = buildRecruitmentPipelineFinalScore({
        tryoutScore: application.tryoutScore,
        commandAuthority: world.commandAuthority,
        morale: world.morale,
        health: world.health,
        extraCertCount: certSummary.extraCertCount
      });

      const updatedSelection = await upsertRecruitmentPipelineApplication(client, {
        profileId,
        ...application,
        status: 'SELECTION',
        selectionDay: world.currentDay,
        finalScore,
        note: 'SELECTION_SCORED'
      });

      await pushMailboxAndTimeline(client, {
        profileId,
        worldDay: world.currentDay,
        category: 'GENERAL',
        subject: `Tahap Selection ${application.division}`,
        body: `Selection scoring selesai. Nilai akhir sementara: ${finalScore}. Announcement tersedia pada Day 4.`,
        relatedRef: application.applicationId,
        timelineEventType: 'RECRUITMENT_SELECTION',
        timelineTitle: 'Selection Selesai',
        timelineDetail: `Final score ${application.division}: ${finalScore}.`
      });

      invalidateExpansionStateCache(profileId);
      const state = await buildExpansionState(client, profileId, nowMs, application.division);
      const snapshot = await buildSnapshotV5(client, profileId, nowMs);
      return {
        payload: {
          stage: 'SELECTION',
          application: updatedSelection,
          nextStageAvailableDay: application.registeredDay + 3,
          state,
          snapshot: snapshot ? { ...snapshot, expansion: state } : null
        }
      };
    }

    if (application.status === 'SELECTION') {
      if (world.currentDay < application.registeredDay + 3) {
        return {
          statusCode: 409,
          payload: {
            error: 'Announcement hanya tersedia pada hari ke-4 pipeline.',
            currentDay: world.currentDay,
            requiredDay: application.registeredDay + 3
          }
        };
      }

      const meetsScore = application.finalScore >= 68;
      const quotaDecision = meetsScore
        ? await reserveDivisionQuotaSlot(client, {
            profileId,
            division: application.division,
            currentDay: world.currentDay
          })
        : { accepted: false as const, reason: 'QUOTA_FULL' as const, quota: null as DivisionQuotaState | null };
      const accepted = meetsScore && quotaDecision.accepted;

      const updated = await upsertRecruitmentPipelineApplication(client, {
        profileId,
        ...application,
        status: accepted ? 'ANNOUNCEMENT_ACCEPTED' : 'ANNOUNCEMENT_REJECTED',
        announcementDay: world.currentDay,
        note: accepted
          ? 'ANNOUNCEMENT_ACCEPTED'
          : meetsScore
            ? quotaDecision.reason === 'COOLDOWN'
              ? 'ANNOUNCEMENT_REJECTED_QUOTA_COOLDOWN'
              : quotaDecision.reason === 'MISSING_QUOTA'
                ? 'ANNOUNCEMENT_REJECTED_QUOTA_MISSING'
                : 'ANNOUNCEMENT_REJECTED_QUOTA'
            : 'ANNOUNCEMENT_REJECTED_SCORE'
      });

      if (accepted) {
        const [oldDivisionRaw, oldPositionRaw] = world.assignment.split('-').map((item) => item.trim());
        const oldDivision = oldDivisionRaw && oldDivisionRaw.length > 0 ? oldDivisionRaw : 'Nondivisi';
        const oldPosition = oldPositionRaw && oldPositionRaw.length > 0 ? oldPositionRaw : world.assignment;
        const newPosition = 'Probationary Officer';

        await updateWorldCore(client, {
          profileId,
          stateVersion: world.stateVersion + 1,
          lastTickMs: nowMs,
          currentDay: world.currentDay,
          moneyCents: world.moneyCents,
          morale: clamp(world.morale + 3, 0, 100),
          health: world.health,
          rankIndex: world.rankIndex,
          assignment: `${application.division} - ${newPosition}`,
          commandAuthority: clamp(world.commandAuthority + 2, 0, 100)
        });

        await client.query(
          `
            UPDATE game_states
            SET player_division = $2, player_position = $3, updated_at = now()
            WHERE profile_id = $1
          `,
          [profileId, application.division, newPosition]
        );

        await insertAssignmentHistory(client, {
          profileId,
          actorType: 'PLAYER',
          npcId: null,
          oldDivision,
          newDivision: application.division,
          oldPosition,
          newPosition,
          reason: 'RECRUITMENT_PIPELINE_ACCEPTED',
          changedDay: world.currentDay
        });
      }

      await pushMailboxAndTimeline(client, {
        profileId,
        worldDay: world.currentDay,
        category: accepted ? 'MUTATION' : 'GENERAL',
        subject: accepted ? `Announcement: Diterima ${application.division}` : `Announcement: Gagal ${application.division}`,
        body: accepted
          ? `Selamat, Anda diterima di ${application.division}. Penugasan awal sebagai Probationary Officer.`
          : meetsScore
            ? 'Skor memenuhi ambang, tetapi kuota divisi belum tersedia saat announcement.'
            : `Aplikasi ${application.division} dinyatakan belum lolos pada siklus ini.`,
        relatedRef: application.applicationId,
        timelineEventType: 'RECRUITMENT_ANNOUNCEMENT',
        timelineTitle: accepted ? 'Recruitment Accepted' : 'Recruitment Rejected',
        timelineDetail: accepted
          ? `Diterima di ${application.division} pada Day 4 pipeline.`
          : `Belum lolos di ${application.division}.`
      });

      invalidateExpansionStateCache(profileId);
      const state = await buildExpansionState(client, profileId, nowMs, application.division);
      const snapshot = await buildSnapshotV5(client, profileId, nowMs);
      return {
        payload: {
          stage: 'ANNOUNCEMENT',
          accepted,
          application: updated,
          state,
          snapshot: snapshot ? { ...snapshot, expansion: state } : null
        }
      };
    }

    return {
      payload: {
        stage: 'ANNOUNCEMENT',
        accepted: application.status === 'ANNOUNCEMENT_ACCEPTED',
        application
      }
    };
  });
}

export async function getDivisionApplicationV5(
  request: FastifyRequest,
  reply: FastifyReply,
  applicationId: string
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const application = await getRecruitmentPipelineApplication(client, profileId, applicationId);
    if (!application) {
      return { statusCode: 404, payload: { error: 'Application tidak ditemukan.' } };
    }
    const schedule = {
      registrationDay: application.registeredDay,
      tryoutDay: application.registeredDay + 1,
      selectionDay: application.registeredDay + 2,
      announcementDay: application.registeredDay + 3,
      totalDays: RECRUITMENT_PIPELINE_TOTAL_DAYS
    };
    const stageIndex = (() => {
      if (application.status === 'REGISTRATION') return 1;
      if (application.status === 'TRYOUT') return 2;
      if (application.status === 'SELECTION') return 3;
      return 4;
    })();
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        application,
        schedule,
        stageIndex,
        currentWorldDay: world.currentDay,
        canTryout: application.status === 'REGISTRATION' && world.currentDay >= schedule.tryoutDay,
        canFinalizeSelection: application.status === 'TRYOUT' && world.currentDay >= schedule.selectionDay,
        canAnnounce: application.status === 'SELECTION' && world.currentDay >= schedule.announcementDay,
        snapshot
      }
    };
  });
}

export async function getAcademyProgramsV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const programs = [
      { track: 'OFFICER', tiers: [1, 2, 3], durations: [4, 5, 6], description: 'Program dasar komando lintas divisi.' },
      { track: 'HIGH_COMMAND', tiers: [2, 3], durations: [5, 6], description: 'Strategi komando tinggi dan pengambilan keputusan kritis.' },
      { track: 'SPECIALIST', tiers: [1, 2, 3], durations: [4, 5, 6], description: 'Pendalaman keahlian teknis dan support ops.' },
      { track: 'TRIBUNAL', tiers: [2, 3], durations: [5, 6], description: 'Prosedur pengadilan militer dan military law.' },
      { track: 'CYBER', tiers: [2, 3], durations: [5, 6], description: 'Operasi cyber defense dan offense terintegrasi.' }
    ];
    const state = await buildExpansionState(client, profileId, nowMs);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        constants: {
          academyTierDays: ACADEMY_TOTAL_DAYS_BY_TIER
        },
        programs,
        state,
        snapshot: snapshot ? { ...snapshot, expansion: state } : null
      }
    };
  });
}

export async function getAcademyTitlesV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const titles = await listEducationTitles(client);
    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const world = await lockV5World(client, profileId);
    const playerDisplayName = world ? decorateNameWithEducationTitles(world.playerName, playerCerts, titles) : null;
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        titles,
        playerDisplayName,
        snapshot
      }
    };
  });
}

export async function getAcademyCertificationsV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const titles = await listEducationTitles(client);
    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const world = await lockV5World(client, profileId);
    const playerDisplayName = world ? decorateNameWithEducationTitles(world.playerName, playerCerts, titles) : null;
    const items = listPlayerInventoryCertificates(playerCerts);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        items,
        certifications: playerCerts,
        playerDisplayName,
        snapshot
      }
    };
  });
}

export async function getDomCycleCurrentV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const cycle = await ensureDomCycleCurrent(client, profileId, world.currentDay);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        constants: {
          domCycleDays: DOM_OPERATION_CYCLE_DAYS,
          sessionsPerCycle: 3,
          playerSessionNo: DOM_PLAYER_SESSION_NO,
          playerNpcSlots: DOM_PLAYER_NPC_SLOTS
        },
        cycle,
        snapshot
      }
    };
  });
}

export async function joinDomSessionV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { sessionId: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const cycle = await ensureDomCycleCurrent(client, profileId, world.currentDay);
    const targetSession = cycle.sessions.find((item) => item.sessionId === payload.sessionId) ?? null;
    if (!targetSession) {
      return { statusCode: 404, payload: { error: 'Session DOM tidak ditemukan.' } };
    }
    if (targetSession.participantMode !== 'PLAYER_ELIGIBLE' || targetSession.sessionNo !== DOM_PLAYER_SESSION_NO) {
      return { statusCode: 409, payload: { error: 'Session ini khusus NPC_ONLY dan tidak bisa diikuti player.' } };
    }

    const joinedOther = cycle.sessions.find((item) => item.playerJoined && item.sessionId !== targetSession.sessionId);
    if (joinedOther) {
      return {
        statusCode: 409,
        payload: {
          error: 'Player hanya boleh ikut 1 sesi per cycle DOM.',
          joinedSessionId: joinedOther.sessionId
        }
      };
    }

    const updatedSession = await upsertDomOperationSession(client, {
      sessionId: targetSession.sessionId,
      cycleId: cycle.cycleId,
      profileId,
      sessionNo: targetSession.sessionNo,
      participantMode: targetSession.participantMode,
      npcSlots: DOM_PLAYER_NPC_SLOTS,
      playerJoined: true,
      playerJoinDay: world.currentDay,
      status: targetSession.status === 'PLANNED' ? 'IN_PROGRESS' : targetSession.status,
      result: targetSession.result
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'GENERAL',
      subject: `Join DOM Session #${updatedSession.sessionNo}`,
      body: `Anda resmi terdaftar pada sesi DOM #${updatedSession.sessionNo} dengan slot NPC ${DOM_PLAYER_NPC_SLOTS}.`,
      relatedRef: updatedSession.sessionId,
      timelineEventType: 'DOM_JOIN',
      timelineTitle: 'Join Session DOM',
      timelineDetail: `Player join sesi DOM #${updatedSession.sessionNo}.`
    });

    const cycleAfter = await getCurrentDomOperationCycle(client, profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { session: updatedSession, cycle: cycleAfter, snapshot } };
  });
}

export async function executeDomSessionV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { sessionId: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const cycle = await ensureDomCycleCurrent(client, profileId, world.currentDay);
    const session = await getDomOperationSession(client, profileId, payload.sessionId);
    if (!session) {
      return { statusCode: 404, payload: { error: 'Session DOM tidak ditemukan.' } };
    }
    if (session.status === 'COMPLETED') {
      const snapshot = await buildSnapshotV5(client, profileId, nowMs);
      return { payload: { session, cycle, snapshot } };
    }

    const governance = await getLegacyGovernanceSnapshot(client, profileId);
    const sessionsInCycleBefore = await listDomOperationSessionsByCycle(client, profileId, cycle.cycleId);
    const cycleMedalPool = computeDomCycleMedalPool(
      {
        commandAuthority: world.commandAuthority,
        morale: world.morale,
        health: world.health
      },
      {
        militaryStability: governance.militaryStability,
        nationalStability: governance.nationalStability
      }
    );
    const cycleAllocatedBefore = sumAllocatedCycleMedals(sessionsInCycleBefore);
    const cycleRemainingBefore = Math.max(0, cycleMedalPool - cycleAllocatedBefore);

    const playerParticipates = session.participantMode === 'PLAYER_ELIGIBLE' && session.playerJoined;
    const participantCount = playerParticipates ? 1 + DOM_PLAYER_NPC_SLOTS : session.npcSlots;
    const randomSwing = Math.floor(Math.random() * 25) - 12;
    const scoreBase =
      46 +
      Math.round(world.commandAuthority * 0.27) +
      Math.round(world.morale * 0.18) +
      Math.round(world.health * 0.15) +
      (playerParticipates ? 8 : 0) +
      (session.sessionNo === 3 ? -4 : 0);
    const successScore = clamp(scoreBase + randomSwing, 1, 99);
    const success = successScore >= 56;
    const casualties = success ? Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3);
    const rawQuota = success
      ? clamp(
          Math.round((successScore - 50) / 16) +
            (session.sessionNo === DOM_PLAYER_SESSION_NO ? 1 : 0) -
            Math.max(0, casualties - 1),
          1,
          4
        )
      : 0;
    const medalQuota = success ? Math.min(cycleRemainingBefore, rawQuota) : 0;

    const result = {
      success,
      successScore,
      casualties,
      medalQuota,
      participantCount,
      mode: playerParticipates ? 'PLAYER_PLUS_NPC' : 'FULL_NPC',
      cycleMedalPool,
      cycleAllocatedBefore,
      cycleRemainingAfter: Math.max(0, cycleRemainingBefore - medalQuota)
    };

    const updatedSession = await upsertDomOperationSession(client, {
      sessionId: session.sessionId,
      cycleId: cycle.cycleId,
      profileId,
      sessionNo: session.sessionNo,
      participantMode: session.participantMode,
      npcSlots: session.npcSlots,
      playerJoined: session.playerJoined,
      playerJoinDay: session.playerJoinDay,
      status: 'COMPLETED',
      result
    });

    if (playerParticipates) {
      await updateWorldCore(client, {
        profileId,
        stateVersion: world.stateVersion + 1,
        lastTickMs: nowMs,
        currentDay: world.currentDay,
        moneyCents: world.moneyCents + (success ? 5_000 : -1_500),
        morale: clamp(world.morale + (success ? 4 : -3), 0, 100),
        health: clamp(world.health - (success ? 1 : 4), 0, 100),
        rankIndex: world.rankIndex,
        assignment: world.assignment,
        commandAuthority: clamp(world.commandAuthority + (success ? 2 : -1), 0, 100)
      });
    }

    await applyLegacyGovernanceDelta(client, {
      profileId,
      nationalDelta: success ? 1 : -2 - Math.floor(casualties / 2),
      militaryDelta: success ? 2 - casualties : -3 - casualties,
      fundDeltaCents: success
        ? 4_000 - casualties * 1_500 + (playerParticipates ? 1_500 : 0)
        : -3_500 - casualties * 1_200,
      corruptionDelta: success ? -1 : 1
    });

    const sessionsInCycle = await listDomOperationSessionsByCycle(client, profileId, cycle.cycleId);
    if (sessionsInCycle.length === 3 && sessionsInCycle.every((item) => item.status === 'COMPLETED')) {
      await updateDomOperationCycleStatus(client, { profileId, cycleId: cycle.cycleId, status: 'COMPLETED' });
    }

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: success ? 'GENERAL' : 'SANCTION',
      subject: `Laporan DOM Session #${session.sessionNo}`,
      body: success
        ? `Sesi berhasil (score ${successScore}) dengan casualty ${casualties}. Kuota medali sesi: ${medalQuota}. Sisa pool cycle: ${result.cycleRemainingAfter}/${result.cycleMedalPool}.`
        : `Sesi gagal (score ${successScore}) dengan casualty ${casualties}. Sisa pool cycle: ${result.cycleRemainingAfter}/${result.cycleMedalPool}.`,
      relatedRef: session.sessionId,
      timelineEventType: 'DOM_EXECUTION',
      timelineTitle: `DOM Session #${session.sessionNo} ${success ? 'Berhasil' : 'Gagal'}`,
      timelineDetail: `Score ${successScore}, casualty ${casualties}, mode ${result.mode}, medal ${medalQuota}/${result.cycleMedalPool}.`
    });

    invalidateExpansionStateCache(profileId);
    const cycleAfter = await getCurrentDomOperationCycle(client, profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { session: updatedSession, cycle: cycleAfter, snapshot } };
  });
}

export async function listCourtCasesV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const cases = await listCourtCasesV2(client, profileId, { limit: 120 });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { cases, snapshot } };
  });
}

export async function verdictCourtCaseV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { caseId: string; verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN'; note?: string; newDivision?: string; newPosition?: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const courtCase = await getCourtCaseV2(client, profileId, payload.caseId);
    if (!courtCase) {
      return { statusCode: 404, payload: { error: 'Case tidak ditemukan.' } };
    }
    if (courtCase.status === 'CLOSED') {
      return { statusCode: 409, payload: { error: 'Case sudah ditutup.' } };
    }

    const details = {
      ...courtCase.details,
      verdictNote: payload.note ?? null,
      resolvedBy: 'PLAYER',
      resolvedAtDay: world.currentDay
    };

    const updatedCase = await upsertCourtCaseV2(client, {
      ...courtCase,
      profileId,
      status: 'CLOSED',
      verdict: payload.verdict,
      decisionDay: world.currentDay,
      details
    });

    if (payload.verdict === 'UPHOLD' || payload.verdict === 'REASSIGN') {
      if (courtCase.targetType === 'PLAYER') {
        let nextRank = world.rankIndex;
        let nextAssignment = world.assignment;
        let nextMorale = world.morale;
        let nextCommandAuthority = world.commandAuthority;

        if (courtCase.caseType === 'DEMOTION' && payload.verdict === 'UPHOLD') {
          nextRank = Math.max(0, world.rankIndex - 1);
          await insertRankHistory(client, {
            profileId,
            actorType: 'PLAYER',
            npcId: null,
            oldRankIndex: world.rankIndex,
            newRankIndex: nextRank,
            reason: `COURT_${payload.verdict}`,
            changedDay: world.currentDay
          });
        }

        if (courtCase.caseType === 'DISMISSAL' && payload.verdict === 'UPHOLD') {
          nextAssignment = 'Dismissed Personnel - Former Officer';
          nextMorale = clamp(world.morale - 12, 0, 100);
          nextCommandAuthority = clamp(world.commandAuthority - 25, 0, 100);
        }

        if (courtCase.caseType === 'SANCTION' && payload.verdict === 'UPHOLD') {
          nextMorale = clamp(world.morale - 8, 0, 100);
          nextCommandAuthority = clamp(world.commandAuthority - 6, 0, 100);
        }

        if (courtCase.caseType === 'MUTATION' || payload.verdict === 'REASSIGN') {
          const newDivision = payload.newDivision ?? String(courtCase.details.targetDivision ?? 'Nondivisi');
          const newPosition = payload.newPosition ?? String(courtCase.details.targetPosition ?? 'Staff Officer');
          const [oldDivisionRaw, oldPositionRaw] = world.assignment.split('-').map((item) => item.trim());
          const oldDivision = oldDivisionRaw && oldDivisionRaw.length > 0 ? oldDivisionRaw : 'Nondivisi';
          const oldPosition = oldPositionRaw && oldPositionRaw.length > 0 ? oldPositionRaw : world.assignment;
          nextAssignment = `${newDivision} - ${newPosition}`;
          await insertAssignmentHistory(client, {
            profileId,
            actorType: 'PLAYER',
            npcId: null,
            oldDivision,
            newDivision,
            oldPosition,
            newPosition,
            reason: `COURT_${payload.verdict}`,
            changedDay: world.currentDay
          });
        }

        await updateWorldCore(client, {
          profileId,
          stateVersion: world.stateVersion + 1,
          lastTickMs: nowMs,
          currentDay: world.currentDay,
          moneyCents: world.moneyCents,
          morale: nextMorale,
          health: world.health,
          rankIndex: nextRank,
          assignment: nextAssignment,
          commandAuthority: nextCommandAuthority
        });
      } else if (courtCase.targetNpcId) {
        const npc = await getNpcRuntimeById(client, profileId, courtCase.targetNpcId);
        if (npc) {
          if (courtCase.caseType === 'DISMISSAL' && payload.verdict === 'UPHOLD') {
            npc.status = 'RESERVE';
            npc.position = 'Dismissed Reserve';
          } else if (courtCase.caseType === 'SANCTION' && payload.verdict === 'UPHOLD') {
            npc.fatigue = clamp(npc.fatigue + 12, 0, 100);
            npc.relationToPlayer = clamp(npc.relationToPlayer - 10, 0, 100);
          } else if (courtCase.caseType === 'MUTATION' || payload.verdict === 'REASSIGN') {
            const newDivision = payload.newDivision ?? String(courtCase.details.targetDivision ?? npc.division);
            const newPosition = payload.newPosition ?? String(courtCase.details.targetPosition ?? npc.position);
            await client.query(
              `
                UPDATE npc_entities
                SET division = $3, position = $4, unit = $5, updated_at = now()
                WHERE profile_id = $1 AND npc_id = $2 AND is_current = TRUE
              `,
              [profileId, npc.npcId, newDivision, newPosition, `${newDivision} Unit`]
            );
          }
          await updateNpcRuntimeState(client, profileId, npc, world.currentDay);
        }
      }
    }

    let governanceNationalDelta = 0;
    let governanceMilitaryDelta = 0;
    let governanceCorruptionDelta = 0;
    if (payload.verdict === 'UPHOLD') {
      if (courtCase.caseType === 'SANCTION' || courtCase.caseType === 'DEMOTION') {
        governanceMilitaryDelta += 1;
        governanceCorruptionDelta -= 1;
      } else if (courtCase.caseType === 'DISMISSAL') {
        governanceNationalDelta -= 2;
        governanceMilitaryDelta -= 1;
      } else {
        governanceMilitaryDelta += 1;
      }
    } else if (payload.verdict === 'DISMISS') {
      governanceNationalDelta -= 1;
      governanceMilitaryDelta -= 2;
      governanceCorruptionDelta += 2;
    } else if (payload.verdict === 'REASSIGN') {
      governanceMilitaryDelta += 1;
      governanceCorruptionDelta -= 1;
    }

    await applyLegacyGovernanceDelta(client, {
      profileId,
      nationalDelta: governanceNationalDelta,
      militaryDelta: governanceMilitaryDelta,
      corruptionDelta: governanceCorruptionDelta
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'COURT',
      subject: `Putusan Court Case ${courtCase.caseType}`,
      body: `Case ${courtCase.caseId} diputus dengan verdict ${payload.verdict}.`,
      relatedRef: courtCase.caseId,
      timelineEventType: 'COURT_VERDICT',
      timelineTitle: `Court Verdict ${payload.verdict}`,
      timelineDetail: `${courtCase.caseType} diputus ${payload.verdict}.`
    });

    invalidateExpansionStateCache(profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { case: updatedCase, snapshot } };
  });
}

export async function listCouncilsV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const councils = await ensureCouncilsInitialized(client, profileId, world.currentDay);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { councils, snapshot } };
  });
}

export async function voteCouncilV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { councilId: string; voteChoice: 'APPROVE' | 'REJECT' | 'ABSTAIN'; rationale?: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    await ensureCouncilsInitialized(client, profileId, world.currentDay);
    const council = await getCouncilState(client, profileId, payload.councilId);
    if (!council) {
      return { statusCode: 404, payload: { error: 'Council tidak ditemukan.' } };
    }
    if (council.status !== 'OPEN') {
      return { statusCode: 409, payload: { error: 'Council vote sudah ditutup.' } };
    }

    const existingVote = await getCouncilVoteByActor(client, {
      profileId,
      councilId: council.councilId,
      voterType: 'PLAYER',
      voterNpcId: null
    });
    if (existingVote) {
      return { statusCode: 409, payload: { error: 'Anda sudah voting pada council ini.' } };
    }

    await insertCouncilVote(client, {
      councilId: council.councilId,
      profileId,
      voterType: 'PLAYER',
      voterNpcId: null,
      voteChoice: payload.voteChoice,
      rationale: payload.rationale ?? '',
      votedDay: world.currentDay
    });

    let updatedCouncil = await getCouncilState(client, profileId, council.councilId);
    if (updatedCouncil) {
      const totalVotes = updatedCouncil.votes.approve + updatedCouncil.votes.reject + updatedCouncil.votes.abstain;
      if (updatedCouncil.status === 'OPEN' && totalVotes >= updatedCouncil.quorum) {
        await upsertCouncilState(client, {
          ...updatedCouncil,
          profileId,
          status: 'CLOSED',
          closedDay: world.currentDay
        });
        updatedCouncil = await getCouncilState(client, profileId, council.councilId);
      }
    }

    if (updatedCouncil?.status === 'CLOSED') {
      const approved = updatedCouncil.votes.approve >= updatedCouncil.votes.reject;
      await applyLegacyGovernanceDelta(client, {
        profileId,
        nationalDelta: approved ? 1 : -1,
        militaryDelta: approved ? 2 : -1,
        corruptionDelta: approved ? -1 : 1
      });
    }

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'COUNCIL_INVITE',
      subject: `Vote Tercatat: ${council.councilType}`,
      body: `Pilihan Anda (${payload.voteChoice}) telah dicatat untuk agenda: ${council.agenda}`,
      relatedRef: council.councilId,
      timelineEventType: 'COUNCIL_VOTE',
      timelineTitle: `Vote ${council.councilType}`,
      timelineDetail: `Vote ${payload.voteChoice} pada agenda council.`
    });

    invalidateExpansionStateCache(profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { council: updatedCouncil, snapshot } };
  });
}

export async function getMailboxV5(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { unreadOnly?: boolean; limit?: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const items = await listMailboxMessages(client, profileId, {
      unreadOnly: Boolean(query.unreadOnly),
      limit: query.limit ?? 40
    });
    const summary = await getMailboxSummary(client, profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { items, summary, snapshot } };
  });
}

export async function markMailboxReadV5(
  request: FastifyRequest,
  reply: FastifyReply,
  messageId: string
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const updated = await markMailboxMessageRead(client, {
      profileId,
      messageId,
      readDay: world.currentDay
    });
    if (!updated) {
      return { statusCode: 404, payload: { error: 'Message tidak ditemukan.' } };
    }
    const summary = await getMailboxSummary(client, profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { message: updated, summary, snapshot } };
  });
}

export async function getSocialTimelineV5(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { actorType?: 'PLAYER' | 'NPC'; limit?: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const events = await listSocialTimelineEvents(client, profileId, {
      actorType: query.actorType,
      limit: query.limit ?? 120
    });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { events, snapshot } };
  });
}

export async function listCommandChainOrdersV5(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { status?: CommandChainOrder['status']; limit?: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const orders = await listCommandChainOrders(client, profileId, {
      status: query.status,
      limit: query.limit ?? 80
    });
    const openOrders = orders.filter((item) => item.status === 'PENDING' || item.status === 'FORWARDED').length;
    const breachedOrders = orders.filter((item) => item.status === 'BREACHED').length;
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return {
      payload: {
        orders,
        summary: {
          openOrders,
          breachedOrders,
          latest: orders[0] ?? null
        },
        snapshot
      }
    };
  });
}

export async function createCommandChainOrderV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: {
    targetNpcId?: string;
    targetDivision?: string;
    message: string;
    priority?: CommandChainOrder['priority'];
    ackWindowDays?: number;
    chainPathNpcIds?: string[];
  }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const roster = await listCurrentNpcRuntime(client, profileId, { limit: V5_MAX_NPCS });
    const defaultPath = buildDefaultCommandChainPath({
      npcs: roster.items,
      targetNpcId: payload.targetNpcId ?? null,
      targetDivision: payload.targetDivision ?? null
    });
    const chainPathNpcIds = normalizeCommandChainPath(payload.chainPathNpcIds ?? defaultPath, payload.targetNpcId ?? null);
    const targetNpcId = payload.targetNpcId ?? chainPathNpcIds[chainPathNpcIds.length - 1] ?? null;
    const ackWindowDays = clamp(payload.ackWindowDays ?? 2, 1, 7);
    const orderId = `cco-${profileId.slice(0, 8)}-${world.currentDay}-${randomUUID().slice(0, 8)}`;
    const order = await createCommandChainOrder(client, {
      orderId,
      profileId,
      issuedDay: world.currentDay,
      issuerType: 'PLAYER',
      issuerNpcId: null,
      targetNpcId,
      targetDivision: payload.targetDivision ?? null,
      priority: payload.priority ?? 'MEDIUM',
      status: 'PENDING',
      ackDueDay: world.currentDay + ackWindowDays,
      completedDay: null,
      penaltyApplied: false,
      commandPayload: {
        message: payload.message,
        chainPathNpcIds,
        requiredAcks: chainPathNpcIds.length,
        lastForwardHop: 0
      }
    });

    await appendCommandChainAck(client, {
      orderId,
      profileId,
      actorType: 'PLAYER',
      actorNpcId: null,
      hopNo: 0,
      forwardedToNpcId: chainPathNpcIds[0] ?? null,
      ackDay: world.currentDay,
      note: 'ORDER_ISSUED'
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'GENERAL',
      subject: `Order Komando Berantai (${order.priority})`,
      body: `Order dibuat dengan due day ${order.ackDueDay}. Path: ${chainPathNpcIds.join(' -> ') || 'AUTO'}.`,
      relatedRef: order.orderId,
      timelineEventType: 'COMMAND_CHAIN_ORDER_CREATED',
      timelineTitle: 'Order Komando Dibuat',
      timelineDetail: payload.message
    });

    const acks = await listCommandChainAcks(client, profileId, orderId);
    invalidateExpansionStateCache(profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { order: { ...order, acks }, snapshot } };
  });
}

export async function getCommandChainOrderV5(
  request: FastifyRequest,
  reply: FastifyReply,
  orderId: string
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const order = await getCommandChainOrder(client, profileId, orderId);
    if (!order) {
      return { statusCode: 404, payload: { error: 'Order command chain tidak ditemukan.' } };
    }
    const acks = await listCommandChainAcks(client, profileId, orderId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { order: { ...order, acks }, snapshot } };
  });
}

export async function forwardCommandChainOrderV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { orderId: string; actorNpcId?: string; forwardedToNpcId: string; note?: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const order = await getCommandChainOrder(client, profileId, payload.orderId);
    if (!order) {
      return { statusCode: 404, payload: { error: 'Order command chain tidak ditemukan.' } };
    }
    if (!['PENDING', 'FORWARDED'].includes(order.status)) {
      return { statusCode: 409, payload: { error: `Order tidak bisa di-forward pada status ${order.status}.` } };
    }
    if (world.currentDay > order.ackDueDay) {
      await updateCommandChainOrderStatus(client, {
        profileId,
        orderId: order.orderId,
        status: 'BREACHED',
        completedDay: world.currentDay
      });
      return { statusCode: 409, payload: { error: 'Order melewati ack due day dan dinyatakan breached.' } };
    }

    const actorType = payload.actorNpcId ? 'NPC' : 'PLAYER';
    const acks = await listCommandChainAcks(client, profileId, order.orderId);
    const hopNo = (acks[acks.length - 1]?.hopNo ?? 0) + 1;
    await appendCommandChainAck(client, {
      orderId: order.orderId,
      profileId,
      actorType,
      actorNpcId: payload.actorNpcId ?? null,
      hopNo,
      forwardedToNpcId: payload.forwardedToNpcId,
      ackDay: world.currentDay,
      note: payload.note ?? 'FORWARDED'
    });

    const updatedPayload = {
      ...order.commandPayload,
      lastForwardHop: hopNo,
      lastForwardedToNpcId: payload.forwardedToNpcId
    };
    const updatedOrder = await createCommandChainOrder(client, {
      orderId: order.orderId,
      profileId,
      issuedDay: order.issuedDay,
      issuerType: order.issuerType,
      issuerNpcId: order.issuerNpcId,
      targetNpcId: order.targetNpcId,
      targetDivision: order.targetDivision,
      priority: order.priority,
      status: 'FORWARDED',
      ackDueDay: order.ackDueDay,
      completedDay: order.completedDay,
      penaltyApplied: order.penaltyApplied,
      commandPayload: updatedPayload
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'GENERAL',
      subject: `Forward Command Chain (${updatedOrder.priority})`,
      body: `Order ${updatedOrder.orderId} diteruskan ke NPC ${payload.forwardedToNpcId}.`,
      relatedRef: updatedOrder.orderId,
      timelineEventType: 'COMMAND_CHAIN_FORWARDED',
      timelineTitle: 'Order Diteruskan',
      timelineDetail: payload.note ?? 'Forward berhasil.'
    });

    const updatedAcks = await listCommandChainAcks(client, profileId, order.orderId);
    invalidateExpansionStateCache(profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { order: { ...updatedOrder, acks: updatedAcks }, snapshot } };
  });
}

export async function ackCommandChainOrderV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { orderId: string; actorNpcId?: string; note?: string }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }
    const order = await getCommandChainOrder(client, profileId, payload.orderId);
    if (!order) {
      return { statusCode: 404, payload: { error: 'Order command chain tidak ditemukan.' } };
    }
    if (!['PENDING', 'FORWARDED'].includes(order.status)) {
      return { statusCode: 409, payload: { error: `Order tidak bisa di-ack pada status ${order.status}.` } };
    }
    if (world.currentDay > order.ackDueDay) {
      await updateCommandChainOrderStatus(client, {
        profileId,
        orderId: order.orderId,
        status: 'BREACHED',
        completedDay: world.currentDay
      });
      return { statusCode: 409, payload: { error: 'Order melewati ack due day dan dinyatakan breached.' } };
    }

    const actorType = payload.actorNpcId ? 'NPC' : 'PLAYER';
    const acks = await listCommandChainAcks(client, profileId, order.orderId);
    const hopNo = (acks[acks.length - 1]?.hopNo ?? 0) + 1;
    await appendCommandChainAck(client, {
      orderId: order.orderId,
      profileId,
      actorType,
      actorNpcId: payload.actorNpcId ?? null,
      hopNo,
      forwardedToNpcId: null,
      ackDay: world.currentDay,
      note: payload.note ?? 'ACKNOWLEDGED'
    });

    const path = Array.isArray(order.commandPayload.chainPathNpcIds)
      ? order.commandPayload.chainPathNpcIds.filter((item): item is string => typeof item === 'string')
      : [];
    const finalNpcId = order.targetNpcId ?? (path[path.length - 1] ?? null);
    const isFinalAck = payload.actorNpcId ? payload.actorNpcId === finalNpcId : finalNpcId === null;

    const nextStatus: CommandChainOrder['status'] = isFinalAck ? 'ACKNOWLEDGED' : 'FORWARDED';
    const updatedOrder = await createCommandChainOrder(client, {
      orderId: order.orderId,
      profileId,
      issuedDay: order.issuedDay,
      issuerType: order.issuerType,
      issuerNpcId: order.issuerNpcId,
      targetNpcId: order.targetNpcId,
      targetDivision: order.targetDivision,
      priority: order.priority,
      status: nextStatus,
      ackDueDay: order.ackDueDay,
      completedDay: isFinalAck ? world.currentDay : order.completedDay,
      penaltyApplied: order.penaltyApplied,
      commandPayload: {
        ...order.commandPayload,
        lastAckHop: hopNo,
        lastAckActorNpcId: payload.actorNpcId ?? null
      }
    });

    await pushMailboxAndTimeline(client, {
      profileId,
      worldDay: world.currentDay,
      category: 'GENERAL',
      subject: isFinalAck ? 'Command Chain Tuntas' : 'Command Chain Acknowledged',
      body: isFinalAck
        ? `Order ${updatedOrder.orderId} acknowledged lengkap sebelum due day.`
        : `Order ${updatedOrder.orderId} acknowledged, menunggu hop berikutnya.`,
      relatedRef: updatedOrder.orderId,
      timelineEventType: isFinalAck ? 'COMMAND_CHAIN_ACK_COMPLETE' : 'COMMAND_CHAIN_ACK',
      timelineTitle: isFinalAck ? 'Ack Chain Lengkap' : 'Ack Chain Parsial',
      timelineDetail: payload.note ?? 'Acknowledgement tercatat.'
    });

    const updatedAcks = await listCommandChainAcks(client, profileId, order.orderId);
    invalidateExpansionStateCache(profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { order: { ...updatedOrder, acks: updatedAcks }, snapshot } };
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
