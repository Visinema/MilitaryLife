
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  AcademyBatchState,
  AcademyBatchStanding,
  CommandChainAck,
  CommandChainOrder,
  CouncilState,
  CourtCaseV2,
  DomOperationCycle,
  DomOperationSession,
  DivisionQuotaState,
  EducationTitle,
  ExpansionStateV51,
  MailboxMessage,
  RecruitmentPipelineState,
  RecruitmentCompetitionEntry,
  CeremonyCycleV5,
  CertificationRecordV5,
  GameSnapshotV5,
  MissionInstanceV5,
  NpcCareerPlanState,
  NpcCareerStage,
  NpcCareerStrategyMode,
  NpcLifecycleEvent,
  NpcRuntimeState,
  NpcRuntimeStatus,
  SocialTimelineEvent,
  WorldDelta
} from '@mls/shared/game-types';
import { buildNpcRegistry, MAX_ACTIVE_NPCS } from '@mls/shared/npc-registry';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
import type { BranchCode } from '@mls/shared/constants';

export const V5_MAX_NPCS = MAX_ACTIVE_NPCS;

export interface V5ProfileBase {
  profileId: string;
  playerName: string;
  branch: BranchCode;
}

export interface V5WorldLockedRow {
  profileId: string;
  playerName: string;
  branch: BranchCode;
  stateVersion: number;
  lastTickMs: number;
  sessionActiveUntilMs: number | null;
  gameTimeScale: 1 | 3;
  currentDay: number;
  moneyCents: number;
  morale: number;
  health: number;
  rankIndex: number;
  assignment: string;
  commandAuthority: number;
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseTimestamp(value: unknown, fallback = new Date(0).toISOString()): string {
  if (typeof value === 'string' && value) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return fallback;
}

function parseNpcStatus(value: unknown): NpcRuntimeStatus {
  const candidate = parseString(value, 'ACTIVE');
  if (candidate === 'INJURED' || candidate === 'KIA' || candidate === 'RESERVE' || candidate === 'RECRUITING') return candidate;
  return 'ACTIVE';
}

function parseNpcCareerStrategyMode(value: unknown): NpcCareerStrategyMode {
  const candidate = parseString(value, 'BALANCED_T2');
  if (candidate === 'RUSH_T1' || candidate === 'BALANCED_T2' || candidate === 'DEEP_T3') return candidate;
  return 'BALANCED_T2';
}

function parseNpcCareerStage(value: unknown): NpcCareerStage {
  const candidate = parseString(value, 'CIVILIAN_START');
  if (
    candidate === 'CIVILIAN_START' ||
    candidate === 'ACADEMY' ||
    candidate === 'DIVISION_PIPELINE' ||
    candidate === 'IN_DIVISION' ||
    candidate === 'MUTATION_PIPELINE'
  ) {
    return candidate;
  }
  return 'CIVILIAN_START';
}

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function mapNpcRow(row: Record<string, unknown>): NpcRuntimeState {
  return {
    npcId: parseString(row.npc_id),
    slotNo: parseNumber(row.slot_no, 1),
    generation: parseNumber(row.generation, 0),
    name: parseString(row.name),
    division: parseString(row.division),
    unit: parseString(row.unit),
    position: parseString(row.position),
    status: parseNpcStatus(row.status),
    joinedDay: parseNumber(row.joined_day, 0),
    deathDay: row.death_day == null ? null : parseNumber(row.death_day, 0),
    tactical: parseNumber(row.tactical, 50),
    support: parseNumber(row.support, 50),
    leadership: parseNumber(row.leadership, 50),
    resilience: parseNumber(row.resilience, 50),
    intelligence: parseNumber(row.intelligence, 50),
    competence: parseNumber(row.competence, 50),
    loyalty: parseNumber(row.loyalty, 60),
    integrityRisk: parseNumber(row.integrity_risk, 12),
    betrayalRisk: parseNumber(row.betrayal_risk, 8),
    fatigue: parseNumber(row.fatigue, 0),
    trauma: parseNumber(row.trauma, 0),
    xp: parseNumber(row.xp, 0),
    promotionPoints: parseNumber(row.promotion_points, 0),
    rankIndex: clamp(parseNumber(row.rank_index, 0), 0, 13),
    academyTier: clamp(parseNumber(row.academy_tier, 0), 0, 3) as 0 | 1 | 2 | 3,
    strategyMode: parseNpcCareerStrategyMode(row.strategy_mode),
    careerStage: parseNpcCareerStage(row.career_stage),
    desiredDivision: row.desired_division == null ? null : parseString(row.desired_division),
    relationToPlayer: parseNumber(row.relation_to_player, 50),
    lastTask: row.last_task == null ? null : parseString(row.last_task),
    updatedAtMs: parseNumber(row.updated_at_ms, Date.now())
  };
}

function mapNpcCareerPlanRow(row: Record<string, unknown>): NpcCareerPlanState {
  return {
    npcId: parseString(row.npc_id),
    strategyMode: parseNpcCareerStrategyMode(row.strategy_mode),
    careerStage: parseNpcCareerStage(row.career_stage),
    desiredDivision: row.desired_division == null ? null : parseString(row.desired_division),
    targetTier: clamp(parseNumber(row.target_tier, 1), 1, 3) as 1 | 2 | 3,
    nextActionDay: parseNumber(row.next_action_day, 0),
    lastActionDay: row.last_action_day == null ? null : parseNumber(row.last_action_day, 0),
    lastApplicationId: row.last_application_id == null ? null : parseString(row.last_application_id),
    meta:
      row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {}
  };
}

export async function getProfileBaseByUserId(client: PoolClient, userId: string): Promise<V5ProfileBase | null> {
  const result = await client.query<{ profile_id: string; player_name: string; branch: BranchCode }>(
    `
      SELECT p.id AS profile_id, p.name AS player_name, p.branch::text AS branch
      FROM profiles p
      WHERE p.user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) return null;
  return { profileId: row.profile_id, playerName: row.player_name, branch: row.branch };
}

export async function lockV5RuntimeRows(client: PoolClient, profileId: string): Promise<void> {
  // Keep lock order deterministic: game_worlds -> player_runtime.
  // This is used by legacy and V5 flows to prevent cross-endpoint deadlocks.
  await client.query(`SELECT profile_id FROM game_worlds WHERE profile_id = $1 FOR UPDATE`, [profileId]);
  await client.query(`SELECT profile_id FROM player_runtime WHERE profile_id = $1 FOR UPDATE`, [profileId]);
}

export async function clearV5World(client: PoolClient, profileId: string): Promise<void> {
  // Lock core runtime rows first so reset lock ordering matches world tick ordering.
  // This prevents deadlocks with concurrent requests that lock world/runtime then mutate academy/recruitment tables.
  await lockV5RuntimeRows(client, profileId);

  // academy_batch_members does not have profile_id, so it must be cleared via batch linkage.
  await client.query(
    `
      DELETE FROM academy_batch_members
      WHERE batch_id IN (
        SELECT batch_id FROM academy_batches WHERE profile_id = $1
      )
    `,
    [profileId]
  );

  const tablesWithProfileId = [
    'command_chain_acks',
    'command_chain_orders',
    'council_votes',
    'councils',
    'court_cases_v2',
    'dom_operation_sessions',
    'dom_operation_cycles',
    'recruitment_pipeline_applications',
    'personnel_assignment_history',
    'personnel_rank_history',
    'mailbox_messages',
    'social_timeline_events',
    'npc_career_plans',
    'npc_trait_memory',
    'quota_decision_logs',
    'recruitment_applications_v51',
    'academy_batches',
    'division_quota_states',
    'game_world_deltas',
    'recruitment_queue',
    'ceremony_awards',
    'ceremony_cycles',
    'certification_records',
    'academy_enrollments',
    'mission_participants',
    'mission_instances',
    'npc_lifecycle_events',
    'npc_task_queue',
    'npc_stats',
    'npc_entities',
    'player_runtime',
    'game_worlds'
  ];

  for (const table of tablesWithProfileId) {
    await client.query(`DELETE FROM ${table} WHERE profile_id = $1`, [profileId]);
  }
}

function defaultStrategyModeForSlot(slotNo: number, seedBase: number): NpcCareerStrategyMode {
  const pivot = Math.abs((slotNo * 19 + seedBase) % 9);
  if (pivot <= 2) return 'RUSH_T1';
  if (pivot >= 7) return 'DEEP_T3';
  return 'BALANCED_T2';
}

function targetTierForStrategyMode(mode: NpcCareerStrategyMode): 1 | 2 | 3 {
  if (mode === 'RUSH_T1') return 1;
  if (mode === 'DEEP_T3') return 3;
  return 2;
}

export async function ensureV5World(client: PoolClient, profile: V5ProfileBase, nowMs: number): Promise<void> {
  const existing = await client.query<{ profile_id: string }>(`SELECT profile_id FROM game_worlds WHERE profile_id = $1 LIMIT 1`, [profile.profileId]);
  if ((existing.rowCount ?? 0) > 0) return;

  const seedBase = profile.profileId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  await client.query(
    `
      INSERT INTO game_worlds (profile_id, state_version, last_tick_ms, session_active_until_ms, game_time_scale, current_day, world_seed)
      VALUES ($1, 1, $2, NULL, 1, 0, $3)
    `,
    [profile.profileId, nowMs, seedBase]
  );

  await client.query(
    `
      INSERT INTO player_runtime (profile_id, money_cents, morale, health, rank_index, assignment, command_authority, fatigue)
      VALUES ($1, 0, 70, 82, 0, 'Nondivisi - Recruit Cadet', 40, 0)
    `,
    [profile.profileId]
  );

  const registry = buildNpcRegistry(profile.branch, V5_MAX_NPCS);
  for (let i = 0; i < V5_MAX_NPCS; i += 1) {
    const slotNo = i + 1;
    const identity = registry[i];
    const npcId = `npc-${slotNo}-g0`;
    await client.query(
      `
        INSERT INTO npc_entities (profile_id, npc_id, slot_no, generation, name, division, unit, position, status, joined_day, death_day, is_current)
        VALUES ($1, $2, $3, 0, $4, $5, $6, $7, 'ACTIVE', 0, NULL, TRUE)
      `,
      [
        profile.profileId,
        npcId,
        slotNo,
        identity?.name ?? `NPC ${slotNo}`,
        'Nondivisi',
        'Academy Cadet Unit',
        'Recruit Cadet'
      ]
    );

    await client.query(
      `
        INSERT INTO npc_stats (
          profile_id, npc_id, tactical, support, leadership, resilience,
          intelligence, competence, loyalty, integrity_risk, betrayal_risk,
          fatigue, trauma, xp, promotion_points, rank_index, academy_tier, relation_to_player, last_tick_day, last_task
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0, 0, 0, 0, $12, 0, NULL)
      `,
      [
        profile.profileId,
        npcId,
        42 + ((slotNo * 7 + seedBase) % 38),
        40 + ((slotNo * 11 + seedBase) % 40),
        36 + ((slotNo * 13 + seedBase) % 45),
        45 + ((slotNo * 5 + seedBase) % 35),
        44 + ((slotNo * 9 + seedBase) % 36),
        46 + ((slotNo * 6 + seedBase) % 34),
        52 + ((slotNo * 4 + seedBase) % 28),
        8 + ((slotNo * 5 + seedBase) % 22),
        6 + ((slotNo * 7 + seedBase) % 20),
        40 + ((slotNo * 3 + seedBase) % 32)
      ]
    );

    await client.query(
      `
        INSERT INTO npc_trait_memory (profile_id, npc_id, ambition, discipline, integrity, sociability, memory)
        VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
        ON CONFLICT (profile_id, npc_id) DO NOTHING
      `,
      [
        profile.profileId,
        npcId,
        38 + ((slotNo * 7 + seedBase) % 45),
        44 + ((slotNo * 5 + seedBase) % 44),
        52 + ((slotNo * 3 + seedBase) % 42),
        34 + ((slotNo * 11 + seedBase) % 50)
      ]
    );

    const strategyMode = defaultStrategyModeForSlot(slotNo, seedBase);
    await client.query(
      `
        INSERT INTO npc_career_plans (
          profile_id, npc_id, strategy_mode, career_stage, desired_division,
          target_tier, next_action_day, last_action_day, last_application_id, meta
        )
        VALUES ($1, $2, $3, 'CIVILIAN_START', NULL, $4, 0, NULL, NULL, '{}'::jsonb)
        ON CONFLICT (profile_id, npc_id) DO NOTHING
      `,
      [profile.profileId, npcId, strategyMode, targetTierForStrategyMode(strategyMode)]
    );
  }
}
export async function lockV5World(client: PoolClient, profileId: string): Promise<V5WorldLockedRow | null> {
  const result = await client.query<{
    profile_id: string;
    player_name: string;
    branch: BranchCode;
    state_version: number;
    last_tick_ms: number;
    session_active_until_ms: number | null;
    game_time_scale: number;
    current_day: number;
    money_cents: number;
    morale: number;
    health: number;
    rank_index: number;
    assignment: string;
    command_authority: number;
  }>(
    `
      SELECT
        gw.profile_id,
        p.name AS player_name,
        p.branch::text AS branch,
        gw.state_version,
        gw.last_tick_ms,
        gw.session_active_until_ms,
        gw.game_time_scale,
        gw.current_day,
        pr.money_cents,
        pr.morale,
        pr.health,
        pr.rank_index,
        pr.assignment,
        pr.command_authority
      FROM game_worlds gw
      JOIN player_runtime pr ON pr.profile_id = gw.profile_id
      JOIN profiles p ON p.id = gw.profile_id
      WHERE gw.profile_id = $1
      FOR UPDATE OF gw, pr
    `,
    [profileId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    profileId: row.profile_id,
    playerName: row.player_name,
    branch: row.branch,
    stateVersion: parseNumber(row.state_version, 1),
    lastTickMs: parseNumber(row.last_tick_ms, 0),
    sessionActiveUntilMs: row.session_active_until_ms == null ? null : parseNumber(row.session_active_until_ms),
    gameTimeScale: row.game_time_scale === 3 ? 3 : 1,
    currentDay: parseNumber(row.current_day, 0),
    moneyCents: parseNumber(row.money_cents, 0),
    morale: parseNumber(row.morale, 70),
    health: parseNumber(row.health, 80),
    rankIndex: parseNumber(row.rank_index, 0),
    assignment: parseString(row.assignment, 'Field Command'),
    commandAuthority: parseNumber(row.command_authority, 40)
  };
}

export async function setSessionActiveUntil(client: PoolClient, profileId: string, nowMs: number, ttlMs: number): Promise<void> {
  await client.query(`UPDATE game_worlds SET session_active_until_ms = $2, updated_at = now() WHERE profile_id = $1`, [profileId, nowMs + ttlMs]);
}

export async function updateWorldCore(
  client: PoolClient,
  input: {
    profileId: string;
    stateVersion: number;
    lastTickMs: number;
    currentDay: number;
    moneyCents: number;
    morale: number;
    health: number;
    rankIndex: number;
    assignment: string;
    commandAuthority: number;
  }
): Promise<void> {
  await client.query(
    `
      UPDATE game_worlds
      SET state_version = $2, last_tick_ms = $3, current_day = $4, updated_at = now()
      WHERE profile_id = $1
    `,
    [input.profileId, input.stateVersion, input.lastTickMs, input.currentDay]
  );

  await client.query(
    `
      UPDATE player_runtime
      SET money_cents = $2, morale = $3, health = $4, rank_index = $5, assignment = $6, command_authority = $7, updated_at = now()
      WHERE profile_id = $1
    `,
    [input.profileId, input.moneyCents, input.morale, input.health, input.rankIndex, input.assignment, input.commandAuthority]
  );
}

export async function appendWorldDelta(client: PoolClient, profileId: string, stateVersion: number, delta: WorldDelta): Promise<void> {
  await client.query(
    `
      INSERT INTO game_world_deltas (profile_id, state_version, delta)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (profile_id, state_version) DO UPDATE
      SET delta = EXCLUDED.delta, created_at = now()
    `,
    [profileId, stateVersion, toJsonb(delta)]
  );
}

export async function listWorldDeltasSince(client: PoolClient, profileId: string, sinceVersion: number): Promise<WorldDelta[]> {
  const result = await client.query<{ delta: WorldDelta }>(
    `
      SELECT delta
      FROM game_world_deltas
      WHERE profile_id = $1 AND state_version > $2
      ORDER BY state_version ASC
      LIMIT 80
    `,
    [profileId, sinceVersion]
  );
  return result.rows.map((row) => row.delta);
}

export async function pruneWorldDeltas(client: PoolClient, profileId: string, keep = 120): Promise<void> {
  await client.query(
    `
      DELETE FROM game_world_deltas
      WHERE profile_id = $1
        AND state_version < (
          SELECT COALESCE(MAX(state_version), 0) - $2 FROM game_world_deltas WHERE profile_id = $1
        )
    `,
    [profileId, keep]
  );
}

export async function listCurrentNpcRuntime(
  client: PoolClient,
  profileId: string,
  options?: { status?: NpcRuntimeStatus; cursor?: number; limit?: number }
): Promise<{ items: NpcRuntimeState[]; nextCursor: number | null }> {
  const cursor = options?.cursor ?? 0;
  const limit = options?.limit ?? 20;
  const values: unknown[] = [profileId, cursor, limit + 1];
  let statusClause = '';
  if (options?.status) {
    values.push(options.status);
    statusClause = `AND e.status = $${values.length}`;
  }

  const result = await client.query(
    `
      SELECT
        e.npc_id,
        e.slot_no,
        e.generation,
        e.name,
        e.division,
        e.unit,
        e.position,
        e.status,
        e.joined_day,
        e.death_day,
        s.tactical,
        s.support,
        s.leadership,
        s.resilience,
        s.intelligence,
        s.competence,
        s.loyalty,
        s.integrity_risk,
        s.betrayal_risk,
        s.fatigue,
        s.trauma,
        s.xp,
        s.promotion_points,
        s.rank_index,
        s.academy_tier,
        cp.strategy_mode,
        cp.career_stage,
        cp.desired_division,
        s.relation_to_player,
        s.last_task,
        EXTRACT(EPOCH FROM GREATEST(e.updated_at, s.updated_at))::bigint * 1000 AS updated_at_ms
      FROM npc_entities e
      JOIN npc_stats s ON s.profile_id = e.profile_id AND s.npc_id = e.npc_id
      LEFT JOIN npc_career_plans cp ON cp.profile_id = e.profile_id AND cp.npc_id = e.npc_id
      WHERE e.profile_id = $1
        AND e.is_current = TRUE
        AND e.slot_no > $2
        ${statusClause}
      ORDER BY e.slot_no ASC
      LIMIT $3
    `,
    values
  );

  const mapped = result.rows.map((row) => mapNpcRow(row as Record<string, unknown>));
  const hasNext = mapped.length > limit;
  const items = hasNext ? mapped.slice(0, limit) : mapped;
  return { items, nextCursor: hasNext ? (items[items.length - 1]?.slotNo ?? null) : null };
}

export async function getNpcRuntimeById(client: PoolClient, profileId: string, npcId: string): Promise<NpcRuntimeState | null> {
  const result = await client.query(
    `
      SELECT
        e.npc_id,
        e.slot_no,
        e.generation,
        e.name,
        e.division,
        e.unit,
        e.position,
        e.status,
        e.joined_day,
        e.death_day,
        s.tactical,
        s.support,
        s.leadership,
        s.resilience,
        s.intelligence,
        s.competence,
        s.loyalty,
        s.integrity_risk,
        s.betrayal_risk,
        s.fatigue,
        s.trauma,
        s.xp,
        s.promotion_points,
        s.rank_index,
        s.academy_tier,
        cp.strategy_mode,
        cp.career_stage,
        cp.desired_division,
        s.relation_to_player,
        s.last_task,
        EXTRACT(EPOCH FROM GREATEST(e.updated_at, s.updated_at))::bigint * 1000 AS updated_at_ms
      FROM npc_entities e
      JOIN npc_stats s ON s.profile_id = e.profile_id AND s.npc_id = e.npc_id
      LEFT JOIN npc_career_plans cp ON cp.profile_id = e.profile_id AND cp.npc_id = e.npc_id
      WHERE e.profile_id = $1 AND e.npc_id = $2
      LIMIT 1
    `,
    [profileId, npcId]
  );
  const row = result.rows[0];
  return row ? mapNpcRow(row as Record<string, unknown>) : null;
}

export async function lockCurrentNpcsForUpdate(client: PoolClient, profileId: string, limit: number): Promise<NpcRuntimeState[]> {
  const result = await client.query(
    `
      SELECT
        e.npc_id,
        e.slot_no,
        e.generation,
        e.name,
        e.division,
        e.unit,
        e.position,
        e.status,
        e.joined_day,
        e.death_day,
        s.tactical,
        s.support,
        s.leadership,
        s.resilience,
        s.intelligence,
        s.competence,
        s.loyalty,
        s.integrity_risk,
        s.betrayal_risk,
        s.fatigue,
        s.trauma,
        s.xp,
        s.promotion_points,
        s.rank_index,
        s.academy_tier,
        cp.strategy_mode,
        cp.career_stage,
        cp.desired_division,
        s.relation_to_player,
        s.last_task,
        EXTRACT(EPOCH FROM GREATEST(e.updated_at, s.updated_at))::bigint * 1000 AS updated_at_ms
      FROM npc_entities e
      JOIN npc_stats s ON s.profile_id = e.profile_id AND s.npc_id = e.npc_id
      LEFT JOIN npc_career_plans cp ON cp.profile_id = e.profile_id AND cp.npc_id = e.npc_id
      WHERE e.profile_id = $1 AND e.is_current = TRUE
      ORDER BY e.slot_no ASC
      LIMIT $2
      FOR UPDATE OF e, s
    `,
    [profileId, limit]
  );

  return result.rows.map((row) => mapNpcRow(row as Record<string, unknown>));
}

export async function updateNpcRuntimeState(client: PoolClient, profileId: string, npc: NpcRuntimeState, lastTickDay: number): Promise<void> {
  await client.query(
    `
      UPDATE npc_entities
      SET status = $3, position = $4, death_day = $5, updated_at = now()
      WHERE profile_id = $1 AND npc_id = $2
    `,
    [profileId, npc.npcId, npc.status, npc.position, npc.deathDay]
  );

  await client.query(
    `
      UPDATE npc_stats
      SET
        tactical = $3,
        support = $4,
        leadership = $5,
        resilience = $6,
        intelligence = $7,
        competence = $8,
        loyalty = $9,
        integrity_risk = $10,
        betrayal_risk = $11,
        fatigue = $12,
        trauma = $13,
        xp = $14,
        promotion_points = $15,
        rank_index = $16,
        academy_tier = $17,
        relation_to_player = $18,
        last_tick_day = $19,
        last_task = $20,
        updated_at = now()
      WHERE profile_id = $1 AND npc_id = $2
    `,
    [
      profileId,
      npc.npcId,
      npc.tactical,
      npc.support,
      npc.leadership,
      npc.resilience,
      npc.intelligence,
      npc.competence,
      npc.loyalty,
      npc.integrityRisk,
      npc.betrayalRisk,
      npc.fatigue,
      npc.trauma,
      npc.xp,
      npc.promotionPoints,
      clamp(npc.rankIndex, 0, 13),
      clamp(npc.academyTier, 0, 3),
      npc.relationToPlayer,
      lastTickDay,
      npc.lastTask
    ]
  );
}

export async function updateNpcAssignmentCurrent(
  client: PoolClient,
  input: { profileId: string; npcId: string; division: string; unit: string; position: string }
): Promise<void> {
  await client.query(
    `
      UPDATE npc_entities
      SET division = $3, unit = $4, position = $5, updated_at = now()
      WHERE profile_id = $1 AND npc_id = $2 AND is_current = TRUE
    `,
    [input.profileId, input.npcId, input.division, input.unit, input.position]
  );
}

export async function upsertNpcCareerPlan(
  client: PoolClient,
  input: NpcCareerPlanState & { profileId: string }
): Promise<NpcCareerPlanState> {
  const result = await client.query(
    `
      INSERT INTO npc_career_plans (
        profile_id, npc_id, strategy_mode, career_stage, desired_division, target_tier,
        next_action_day, last_action_day, last_application_id, meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (profile_id, npc_id) DO UPDATE
      SET
        strategy_mode = EXCLUDED.strategy_mode,
        career_stage = EXCLUDED.career_stage,
        desired_division = EXCLUDED.desired_division,
        target_tier = EXCLUDED.target_tier,
        next_action_day = EXCLUDED.next_action_day,
        last_action_day = EXCLUDED.last_action_day,
        last_application_id = EXCLUDED.last_application_id,
        meta = EXCLUDED.meta,
        updated_at = now()
      RETURNING
        npc_id, strategy_mode, career_stage, desired_division, target_tier,
        next_action_day, last_action_day, last_application_id, meta
    `,
    [
      input.profileId,
      input.npcId,
      input.strategyMode,
      input.careerStage,
      input.desiredDivision,
      clamp(input.targetTier, 1, 3),
      Math.max(0, input.nextActionDay),
      input.lastActionDay == null ? null : Math.max(0, input.lastActionDay),
      input.lastApplicationId,
      toJsonb(input.meta ?? {})
    ]
  );
  return mapNpcCareerPlanRow(result.rows[0] as Record<string, unknown>);
}

export async function getNpcCareerPlan(
  client: PoolClient,
  profileId: string,
  npcId: string
): Promise<NpcCareerPlanState | null> {
  const result = await client.query(
    `
      SELECT
        npc_id, strategy_mode, career_stage, desired_division, target_tier,
        next_action_day, last_action_day, last_application_id, meta
      FROM npc_career_plans
      WHERE profile_id = $1 AND npc_id = $2
      LIMIT 1
    `,
    [profileId, npcId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapNpcCareerPlanRow(row) : null;
}

export async function listNpcCareerPlans(
  client: PoolClient,
  profileId: string,
  options?: { npcIds?: string[]; limit?: number }
): Promise<NpcCareerPlanState[]> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.npcIds && options.npcIds.length > 0) {
    values.push(options.npcIds);
    clauses.push(`npc_id = ANY($${values.length}::text[])`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 200, 500)));
  const limitPlaceholder = `$${values.length}`;
  const result = await client.query(
    `
      SELECT
        npc_id, strategy_mode, career_stage, desired_division, target_tier,
        next_action_day, last_action_day, last_application_id, meta
      FROM npc_career_plans
      WHERE ${clauses.join(' AND ')}
      ORDER BY next_action_day ASC, npc_id ASC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapNpcCareerPlanRow(row as Record<string, unknown>));
}

export interface NpcTraitMemoryProfile {
  npcId: string;
  ambition: number;
  discipline: number;
  integrity: number;
  sociability: number;
  memory: unknown[];
}

export async function listNpcTraitMemoryProfiles(
  client: PoolClient,
  profileId: string,
  npcIds: string[]
): Promise<NpcTraitMemoryProfile[]> {
  if (npcIds.length === 0) return [];
  const result = await client.query<{
    npc_id: string;
    ambition: number | string;
    discipline: number | string;
    integrity: number | string;
    sociability: number | string;
    memory: unknown;
  }>(
    `
      SELECT npc_id, ambition, discipline, integrity, sociability, memory
      FROM npc_trait_memory
      WHERE profile_id = $1
        AND npc_id = ANY($2::text[])
    `,
    [profileId, npcIds]
  );
  return result.rows.map((row) => ({
    npcId: row.npc_id,
    ambition: clamp(parseNumber(row.ambition, 50), 0, 100),
    discipline: clamp(parseNumber(row.discipline, 55), 0, 100),
    integrity: clamp(parseNumber(row.integrity, 60), 0, 100),
    sociability: clamp(parseNumber(row.sociability, 50), 0, 100),
    memory: Array.isArray(row.memory) ? row.memory : []
  }));
}

export async function reserveDivisionQuotaSlot(
  client: PoolClient,
  input: { profileId: string; division: string; currentDay: number }
): Promise<{
  accepted: boolean;
  reason: 'ACCEPTED' | 'MISSING_QUOTA' | 'COOLDOWN' | 'QUOTA_FULL';
  quota: DivisionQuotaState | null;
}> {
  const quotaResult = await client.query<{
    division: string;
    head_npc_id: string | null;
    quota_total: number | string;
    quota_used: number | string;
    status: 'OPEN' | 'COOLDOWN';
    cooldown_until_day: number | string | null;
    cooldown_days: number | string;
    decision_note: string;
    updated_day: number | string;
    head_name: string | null;
  }>(
    `
      SELECT
        q.division,
        q.head_npc_id,
        q.quota_total,
        q.quota_used,
        q.status,
        q.cooldown_until_day,
        q.cooldown_days,
        q.decision_note,
        q.updated_day,
        e.name AS head_name
      FROM division_quota_states q
      LEFT JOIN npc_entities e
        ON e.profile_id = q.profile_id
       AND e.npc_id = q.head_npc_id
       AND e.is_current = TRUE
      WHERE q.profile_id = $1 AND q.division = $2
      FOR UPDATE
    `,
    [input.profileId, input.division]
  );
  const row = quotaResult.rows[0];
  if (!row) {
    return { accepted: false, reason: 'MISSING_QUOTA', quota: null };
  }

  const quotaTotal = clamp(parseNumber(row.quota_total, 0), 0, 120);
  const quotaUsed = clamp(parseNumber(row.quota_used, 0), 0, 120);
  const cooldownDays = clamp(parseNumber(row.cooldown_days, 2), 1, 30);
  const quotaBase: DivisionQuotaState = {
    division: row.division,
    headNpcId: row.head_npc_id,
    headName: row.head_name,
    quotaTotal,
    quotaUsed,
    quotaRemaining: Math.max(0, quotaTotal - quotaUsed),
    status: row.status === 'COOLDOWN' ? 'COOLDOWN' : 'OPEN',
    cooldownUntilDay: row.cooldown_until_day == null ? null : parseNumber(row.cooldown_until_day, 0),
    cooldownDays,
    decisionNote: row.decision_note,
    updatedDay: parseNumber(row.updated_day, 0)
  };

  if (quotaBase.status !== 'OPEN') {
    return { accepted: false, reason: 'COOLDOWN', quota: quotaBase };
  }
  if (quotaBase.quotaRemaining <= 0) {
    return { accepted: false, reason: 'QUOTA_FULL', quota: quotaBase };
  }

  const nextUsed = clamp(quotaBase.quotaUsed + 1, 0, quotaBase.quotaTotal);
  const closed = nextUsed >= quotaBase.quotaTotal;
  const nextStatus: 'OPEN' | 'COOLDOWN' = closed ? 'COOLDOWN' : 'OPEN';
  const nextCooldownUntilDay = closed ? Math.max(0, input.currentDay) + cooldownDays : null;
  const nextDecisionNote = closed
    ? 'Kuota ditutup karena slot terpenuhi pada announcement recruitment.'
    : quotaBase.decisionNote;

  const updatedResult = await client.query<{
    division: string;
    head_npc_id: string | null;
    quota_total: number | string;
    quota_used: number | string;
    status: 'OPEN' | 'COOLDOWN';
    cooldown_until_day: number | string | null;
    cooldown_days: number | string;
    decision_note: string;
    updated_day: number | string;
  }>(
    `
      UPDATE division_quota_states
      SET
        quota_used = $3,
        status = $4,
        cooldown_until_day = $5,
        decision_note = $6,
        updated_day = $7,
        updated_at = now()
      WHERE profile_id = $1 AND division = $2
      RETURNING
        division, head_npc_id, quota_total, quota_used, status, cooldown_until_day, cooldown_days, decision_note, updated_day
    `,
    [input.profileId, input.division, nextUsed, nextStatus, nextCooldownUntilDay, nextDecisionNote, Math.max(0, input.currentDay)]
  );
  const updatedRow = updatedResult.rows[0];
  const updatedQuota: DivisionQuotaState = {
    division: parseString(updatedRow?.division, input.division),
    headNpcId: updatedRow?.head_npc_id ?? quotaBase.headNpcId,
    headName: quotaBase.headName,
    quotaTotal: clamp(parseNumber(updatedRow?.quota_total, quotaBase.quotaTotal), 0, 120),
    quotaUsed: clamp(parseNumber(updatedRow?.quota_used, nextUsed), 0, 120),
    quotaRemaining: Math.max(0, clamp(parseNumber(updatedRow?.quota_total, quotaBase.quotaTotal), 0, 120) - clamp(parseNumber(updatedRow?.quota_used, nextUsed), 0, 120)),
    status: updatedRow?.status === 'COOLDOWN' ? 'COOLDOWN' : 'OPEN',
    cooldownUntilDay: updatedRow?.cooldown_until_day == null ? null : parseNumber(updatedRow.cooldown_until_day, 0),
    cooldownDays: clamp(parseNumber(updatedRow?.cooldown_days, cooldownDays), 1, 30),
    decisionNote: parseString(updatedRow?.decision_note, nextDecisionNote),
    updatedDay: parseNumber(updatedRow?.updated_day, Math.max(0, input.currentDay))
  };
  return { accepted: true, reason: 'ACCEPTED', quota: updatedQuota };
}

export async function insertLifecycleEvent(
  client: PoolClient,
  input: { profileId: string; npcId: string; eventType: string; day: number; details?: Record<string, unknown> }
): Promise<void> {
  await client.query(
    `
      INSERT INTO npc_lifecycle_events (profile_id, npc_id, event_type, day, details)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [input.profileId, input.npcId, input.eventType, input.day, toJsonb(input.details ?? {})]
  );
}

export async function listRecentLifecycleEvents(client: PoolClient, profileId: string, limit = 20): Promise<NpcLifecycleEvent[]> {
  const result = await client.query<{ id: number; npc_id: string; event_type: NpcLifecycleEvent['eventType']; day: number; details: Record<string, unknown>; created_at: string }>(
    `
      SELECT id, npc_id, event_type, day, details, created_at
      FROM npc_lifecycle_events
      WHERE profile_id = $1
      ORDER BY id DESC
      LIMIT $2
    `,
    [profileId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    npcId: row.npc_id,
    eventType: row.event_type,
    day: row.day,
    details: row.details ?? {},
    createdAt: row.created_at
  }));
}

export async function queueNpcReplacement(
  client: PoolClient,
  input: { profileId: string; slotNo: number; generationNext: number; enqueuedDay: number; dueDay: number; replacedNpcId: string }
): Promise<void> {
  await client.query(
    `
      INSERT INTO recruitment_queue (profile_id, slot_no, generation_next, enqueued_day, due_day, status, replaced_npc_id, new_npc_id)
      VALUES ($1, $2, $3, $4, $5, 'QUEUED', $6, NULL)
    `,
    [input.profileId, input.slotNo, input.generationNext, input.enqueuedDay, input.dueDay, input.replacedNpcId]
  );
}

export async function listRecruitmentQueue(client: PoolClient, profileId: string): Promise<Array<{ slotNo: number; dueDay: number; generationNext: number; status: 'QUEUED' | 'FULFILLED' | 'CANCELLED' }>> {
  const result = await client.query<{ slot_no: number; due_day: number; generation_next: number; status: 'QUEUED' | 'FULFILLED' | 'CANCELLED' }>(
    `
      SELECT slot_no, due_day, generation_next, status
      FROM recruitment_queue
      WHERE profile_id = $1 AND status = 'QUEUED'
      ORDER BY due_day ASC, id ASC
      LIMIT 20
    `,
    [profileId]
  );

  return result.rows.map((row) => ({
    slotNo: row.slot_no,
    dueDay: row.due_day,
    generationNext: row.generation_next,
    status: row.status
  }));
}

export async function listDueRecruitmentQueueForUpdate(client: PoolClient, profileId: string, currentDay: number, limit: number): Promise<Array<{ id: number; slotNo: number; generationNext: number }>> {
  const result = await client.query<{ id: number; slot_no: number; generation_next: number }>(
    `
      SELECT id, slot_no, generation_next
      FROM recruitment_queue
      WHERE profile_id = $1 AND status = 'QUEUED' AND due_day <= $2
      ORDER BY due_day ASC, id ASC
      LIMIT $3
      FOR UPDATE
    `,
    [profileId, currentDay, limit]
  );

  return result.rows.map((row) => ({ id: row.id, slotNo: row.slot_no, generationNext: row.generation_next }));
}

export async function fulfillRecruitmentQueueItem(
  client: PoolClient,
  input: {
    profileId: string;
    queueId: number;
    slotNo: number;
    generationNext: number;
    npcId: string;
    name: string;
    division: string;
    unit: string;
    position: string;
    joinedDay: number;
  }
): Promise<void> {
  const strategyMode = defaultStrategyModeForSlot(input.slotNo, input.generationNext * 13);
  await client.query(`UPDATE npc_entities SET is_current = FALSE, updated_at = now() WHERE profile_id = $1 AND slot_no = $2 AND is_current = TRUE`, [input.profileId, input.slotNo]);
  await client.query(
    `
      INSERT INTO npc_entities (profile_id, npc_id, slot_no, generation, name, division, unit, position, status, joined_day, death_day, is_current)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, NULL, TRUE)
    `,
    [
      input.profileId,
      input.npcId,
      input.slotNo,
      input.generationNext,
      input.name,
      'Nondivisi',
      'Academy Cadet Unit',
      'Recruit Cadet',
      input.joinedDay
    ]
  );
  await client.query(
    `
      INSERT INTO npc_stats (
        profile_id, npc_id, tactical, support, leadership, resilience,
        intelligence, competence, loyalty, integrity_risk, betrayal_risk,
        fatigue, trauma, xp, promotion_points, rank_index, academy_tier, relation_to_player, last_tick_day, last_task
      )
      VALUES ($1, $2, 52, 52, 50, 55, 54, 56, 60, 10, 8, 0, 0, 0, 0, 0, 0, 50, $3, 'recruitment')
    `,
    [input.profileId, input.npcId, input.joinedDay]
  );
  await client.query(
    `
      INSERT INTO npc_trait_memory (profile_id, npc_id, ambition, discipline, integrity, sociability, memory)
      VALUES ($1, $2, 52, 58, 62, 50, '[]'::jsonb)
      ON CONFLICT (profile_id, npc_id) DO NOTHING
    `,
      [input.profileId, input.npcId]
  );
  await client.query(
    `
      INSERT INTO npc_career_plans (
        profile_id, npc_id, strategy_mode, career_stage, desired_division,
        target_tier, next_action_day, last_action_day, last_application_id, meta
      )
      VALUES ($1, $2, $3, 'CIVILIAN_START', NULL, $4, $5, NULL, NULL, '{}'::jsonb)
      ON CONFLICT (profile_id, npc_id) DO UPDATE
      SET
        strategy_mode = EXCLUDED.strategy_mode,
        career_stage = EXCLUDED.career_stage,
        desired_division = EXCLUDED.desired_division,
        target_tier = EXCLUDED.target_tier,
        next_action_day = EXCLUDED.next_action_day,
        last_action_day = EXCLUDED.last_action_day,
        last_application_id = EXCLUDED.last_application_id,
        meta = EXCLUDED.meta,
        updated_at = now()
    `,
    [input.profileId, input.npcId, strategyMode, targetTierForStrategyMode(strategyMode), Math.max(0, input.joinedDay)]
  );
  await client.query(`UPDATE recruitment_queue SET status = 'FULFILLED', new_npc_id = $3 WHERE id = $1 AND profile_id = $2`, [input.queueId, input.profileId, input.npcId]);
}

export async function getLatestMission(client: PoolClient, profileId: string): Promise<MissionInstanceV5 | null> {
  const result = await client.query<{ mission_id: string; status: MissionInstanceV5['status']; issued_day: number; mission_type: MissionInstanceV5['missionType']; danger_tier: MissionInstanceV5['dangerTier']; plan: MissionInstanceV5['plan']; result: MissionInstanceV5['execution']; updated_ms: number }>(
    `
      SELECT mission_id, status, issued_day, mission_type, danger_tier, plan, result, EXTRACT(EPOCH FROM updated_at)::bigint * 1000 AS updated_ms
      FROM mission_instances
      WHERE profile_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [profileId]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    missionId: row.mission_id,
    status: row.status,
    issuedDay: row.issued_day,
    missionType: row.mission_type,
    dangerTier: row.danger_tier,
    plan: row.plan ?? null,
    execution: row.result ?? null,
    updatedAtMs: parseNumber(row.updated_ms, Date.now())
  };
}

export async function insertMissionPlan(
  client: PoolClient,
  input: {
    profileId: string;
    missionType: MissionInstanceV5['missionType'];
    dangerTier: MissionInstanceV5['dangerTier'];
    issuedDay: number;
    strategy: string;
    objective: string;
    prepChecklist: string[];
    chainQuality: number;
    logisticReadiness: number;
    participantNpcIds: string[];
  }
): Promise<MissionInstanceV5> {
  const missionId = `v5-mission-${input.profileId.slice(0, 8)}-${input.issuedDay}-${randomUUID().slice(0, 8)}`;
  const plan = {
    strategy: input.strategy,
    objective: input.objective,
    prepChecklist: input.prepChecklist,
    chainQuality: input.chainQuality,
    logisticReadiness: input.logisticReadiness
  };

  await client.query(
    `
      INSERT INTO mission_instances (mission_id, profile_id, status, issued_day, mission_type, danger_tier, plan, result)
      VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6::jsonb, NULL)
    `,
    [missionId, input.profileId, input.issuedDay, input.missionType, input.dangerTier, toJsonb(plan)]
  );

  await client.query(`INSERT INTO mission_participants (mission_id, profile_id, npc_id, role, contribution) VALUES ($1, $2, NULL, 'PLAYER', '{}'::jsonb)`, [missionId, input.profileId]);
  for (const npcId of input.participantNpcIds) {
    await client.query(`INSERT INTO mission_participants (mission_id, profile_id, npc_id, role, contribution) VALUES ($1, $2, $3, 'NPC', '{}'::jsonb)`, [missionId, input.profileId, npcId]);
  }

  return {
    missionId,
    status: 'ACTIVE',
    issuedDay: input.issuedDay,
    missionType: input.missionType,
    dangerTier: input.dangerTier,
    plan,
    execution: null,
    updatedAtMs: Date.now()
  };
}

export async function resolveMission(client: PoolClient, input: { profileId: string; missionId: string; execution: NonNullable<MissionInstanceV5['execution']> }): Promise<MissionInstanceV5 | null> {
  const result = await client.query<{ issued_day: number; mission_type: MissionInstanceV5['missionType']; danger_tier: MissionInstanceV5['dangerTier']; plan: MissionInstanceV5['plan'] }>(
    `
      UPDATE mission_instances
      SET status = 'RESOLVED', result = $3::jsonb, updated_at = now()
      WHERE profile_id = $1 AND mission_id = $2
      RETURNING issued_day, mission_type, danger_tier, plan
    `,
    [input.profileId, input.missionId, toJsonb(input.execution)]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    missionId: input.missionId,
    status: 'RESOLVED',
    issuedDay: row.issued_day,
    missionType: row.mission_type,
    dangerTier: row.danger_tier,
    plan: row.plan ?? null,
    execution: input.execution,
    updatedAtMs: Date.now()
  };
}

export async function getCurrentCeremony(client: PoolClient, profileId: string): Promise<CeremonyCycleV5 | null> {
  const cycleResult = await client.query<{ cycle_id: string; ceremony_day: number; status: CeremonyCycleV5['status']; summary: CeremonyCycleV5['summary']; completed_at_ms: number | null }>(
    `
      SELECT cycle_id, ceremony_day, status, summary, completed_at_ms
      FROM ceremony_cycles
      WHERE profile_id = $1
      ORDER BY ceremony_day DESC
      LIMIT 1
    `,
    [profileId]
  );

  const cycle = cycleResult.rows[0];
  if (!cycle) return null;

  const awards = await client.query<{ order_no: number; npc_id: string | null; recipient_name: string; medal: string; ribbon: string; reason: string }>(
    `SELECT order_no, npc_id, recipient_name, medal, ribbon, reason FROM ceremony_awards WHERE cycle_id = $1 ORDER BY order_no ASC`,
    [cycle.cycle_id]
  );

  return {
    cycleId: cycle.cycle_id,
    ceremonyDay: cycle.ceremony_day,
    status: cycle.status,
    completedAtMs: cycle.completed_at_ms,
    summary: cycle.summary ?? { attendance: 0, kiaMemorialCount: 0, commandRotationApplied: false },
    awards: awards.rows.map((row) => ({
      orderNo: row.order_no,
      npcId: row.npc_id,
      recipientName: row.recipient_name,
      medal: row.medal,
      ribbon: row.ribbon,
      reason: row.reason
    }))
  };
}

export async function upsertCeremonyPending(client: PoolClient, input: { profileId: string; cycleId: string; ceremonyDay: number; summary: CeremonyCycleV5['summary']; awards: CeremonyCycleV5['awards'] }): Promise<CeremonyCycleV5> {
  await client.query(
    `
      INSERT INTO ceremony_cycles (cycle_id, profile_id, ceremony_day, status, summary, completed_at_ms)
      VALUES ($1, $2, $3, 'PENDING', $4::jsonb, NULL)
      ON CONFLICT (cycle_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()
    `,
    [input.cycleId, input.profileId, input.ceremonyDay, toJsonb(input.summary)]
  );

  await client.query(`DELETE FROM ceremony_awards WHERE cycle_id = $1`, [input.cycleId]);
  for (const award of input.awards) {
    await client.query(
      `
        INSERT INTO ceremony_awards (cycle_id, profile_id, npc_id, recipient_name, medal, ribbon, reason, order_no)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [input.cycleId, input.profileId, award.npcId, award.recipientName, award.medal, award.ribbon, award.reason, award.orderNo]
    );
  }

  return {
    cycleId: input.cycleId,
    ceremonyDay: input.ceremonyDay,
    status: 'PENDING',
    completedAtMs: null,
    summary: input.summary,
    awards: input.awards
  };
}
export async function completeCeremonyCycle(client: PoolClient, profileId: string, cycleId: string, nowMs: number): Promise<CeremonyCycleV5 | null> {
  const updated = await client.query(
    `
      UPDATE ceremony_cycles
      SET status = 'COMPLETED', completed_at_ms = $3, updated_at = now()
      WHERE profile_id = $1 AND cycle_id = $2
      RETURNING cycle_id
    `,
    [profileId, cycleId, nowMs]
  );
  if ((updated.rowCount ?? 0) === 0) return null;
  return getCurrentCeremony(client, profileId);
}

export async function insertAcademyEnrollment(
  client: PoolClient,
  input: { profileId: string; enrolleeType: 'PLAYER' | 'NPC'; npcId: string | null; track: string; tier: number; startedDay: number }
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      INSERT INTO academy_enrollments (profile_id, enrollee_type, npc_id, track, tier, status, started_day, details)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, '{}'::jsonb)
      RETURNING id
    `,
    [input.profileId, input.enrolleeType, input.npcId, input.track, input.tier, input.startedDay]
  );
  return result.rows[0]?.id ?? 0;
}

export async function completeAcademyEnrollment(client: PoolClient, input: { profileId: string; enrollmentId: number; score: number; passed: boolean; completedDay: number }): Promise<void> {
  await client.query(
    `
      UPDATE academy_enrollments
      SET status = $3, score = $4, completed_day = $5
      WHERE profile_id = $1 AND id = $2
    `,
    [input.profileId, input.enrollmentId, input.passed ? 'PASSED' : 'FAILED', input.score, input.completedDay]
  );
}

export async function upsertCertification(
  client: PoolClient,
  input: CertificationRecordV5 & { profileId: string; sourceEnrollmentId?: number | null }
): Promise<void> {
  await client.query(
    `
      INSERT INTO certification_records (cert_id, profile_id, holder_type, npc_id, cert_code, track, tier, grade, issued_day, expires_day, valid, source_enrollment_id, meta)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb)
      ON CONFLICT (cert_id) DO UPDATE
      SET valid = EXCLUDED.valid, expires_day = EXCLUDED.expires_day, grade = EXCLUDED.grade, meta = '{}'::jsonb
    `,
    [
      input.certId,
      input.profileId,
      input.holderType,
      input.npcId,
      input.certCode,
      input.track,
      input.tier,
      input.grade,
      input.issuedDay,
      input.expiresDay,
      input.valid,
      input.sourceEnrollmentId ?? null
    ]
  );
}

export async function listCertifications(client: PoolClient, profileId: string, options?: { holderType?: 'PLAYER' | 'NPC'; npcId?: string }): Promise<CertificationRecordV5[]> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.holderType) {
    values.push(options.holderType);
    clauses.push(`holder_type = $${values.length}`);
  }
  if (options?.npcId) {
    values.push(options.npcId);
    clauses.push(`npc_id = $${values.length}`);
  }

  const result = await client.query<{ cert_id: string; holder_type: 'PLAYER' | 'NPC'; npc_id: string | null; cert_code: string; track: string; tier: number; grade: 'A' | 'B' | 'C' | 'D'; issued_day: number; expires_day: number; valid: boolean }>(
    `
      SELECT cert_id, holder_type, npc_id, cert_code, track, tier, grade, issued_day, expires_day, valid
      FROM certification_records
      WHERE ${clauses.join(' AND ')}
      ORDER BY issued_day DESC, cert_id DESC
      LIMIT 80
    `,
    values
  );

  return result.rows.map((row) => ({
    certId: row.cert_id,
    holderType: row.holder_type,
    npcId: row.npc_id,
    certCode: row.cert_code,
    track: row.track,
    tier: row.tier as 1 | 2 | 3,
    grade: row.grade,
    issuedDay: row.issued_day,
    expiresDay: row.expires_day,
    valid: row.valid
  }));
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

export interface AcademyDailyScoreRecord {
  academyDay: number;
  worldDay: number;
  score: number;
  source: 'PLAYER' | 'NPC';
}

export interface AcademyBatchMemberRecord {
  batchId: string;
  memberKey: string;
  holderType: 'PLAYER' | 'NPC';
  npcId: string | null;
  dayProgress: number;
  dailyScores: AcademyDailyScoreRecord[];
  finalScore: number;
  passed: boolean;
  rankPosition: number;
  extraCertCount: number;
}

export interface AcademyBatchRecord {
  batchId: string;
  profileId: string;
  track: string;
  tier: number;
  startDay: number;
  endDay: number;
  totalDays: number;
  status: 'ACTIVE' | 'GRADUATED' | 'FAILED';
  lockEnabled: boolean;
  graduationPayload: Record<string, unknown>;
}

function normalizeDailyScores(value: unknown): AcademyDailyScoreRecord[] {
  return parseJsonArray(value)
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const source = item.source === 'NPC' ? 'NPC' : 'PLAYER';
      return {
        academyDay: parseNumber(item.academyDay, 0),
        worldDay: parseNumber(item.worldDay, 0),
        score: Math.max(0, Math.min(100, parseNumber(item.score, 0))),
        source
      };
    })
    .filter((item): item is AcademyDailyScoreRecord => Boolean(item))
    .slice(0, 16);
}

function mapAcademyBatchRow(row: Record<string, unknown>): AcademyBatchRecord {
  return {
    batchId: parseString(row.batch_id),
    profileId: parseString(row.profile_id),
    track: parseString(row.track),
    tier: parseNumber(row.tier, 1),
    startDay: parseNumber(row.start_day, 0),
    endDay: parseNumber(row.end_day, 0),
    totalDays: parseNumber(row.total_days, 8),
    status: parseString(row.status, 'ACTIVE') as AcademyBatchRecord['status'],
    lockEnabled: parseBoolean(row.lock_enabled, true),
    graduationPayload: parseJsonObject(row.graduation_payload)
  };
}

function mapAcademyBatchMemberRow(row: Record<string, unknown>): AcademyBatchMemberRecord {
  return {
    batchId: parseString(row.batch_id),
    memberKey: parseString(row.member_key),
    holderType: parseString(row.holder_type, 'PLAYER') === 'NPC' ? 'NPC' : 'PLAYER',
    npcId: row.npc_id == null ? null : parseString(row.npc_id),
    dayProgress: parseNumber(row.day_progress, 0),
    dailyScores: normalizeDailyScores(row.daily_scores),
    finalScore: parseNumber(row.final_score, 0),
    passed: parseBoolean(row.passed, false),
    rankPosition: parseNumber(row.rank_position, 0),
    extraCertCount: parseNumber(row.extra_cert_count, 0)
  };
}

export async function getLegacyGovernanceSnapshot(
  client: PoolClient,
  profileId: string
): Promise<{ nationalStability: number; militaryStability: number; militaryFundCents: number; corruptionRisk: number }> {
  const result = await client.query<{
    national_stability: number | string | null;
    military_stability: number | string | null;
    military_fund_cents: number | string | null;
    corruption_risk: number | string | null;
  }>(
    `
      SELECT national_stability, military_stability, military_fund_cents, corruption_risk
      FROM game_states
      WHERE profile_id = $1
      LIMIT 1
    `,
    [profileId]
  );
  const row = result.rows[0];
  return {
    nationalStability: parseNumber(row?.national_stability, 72),
    militaryStability: parseNumber(row?.military_stability, 70),
    militaryFundCents: parseNumber(row?.military_fund_cents, 250_000),
    corruptionRisk: parseNumber(row?.corruption_risk, 18)
  };
}

export async function applyLegacyGovernanceDelta(
  client: PoolClient,
  input: {
    profileId: string;
    nationalDelta?: number;
    militaryDelta?: number;
    fundDeltaCents?: number;
    corruptionDelta?: number;
  }
): Promise<{ nationalStability: number; militaryStability: number; militaryFundCents: number; corruptionRisk: number }> {
  const nationalDelta = Math.trunc(input.nationalDelta ?? 0);
  const militaryDelta = Math.trunc(input.militaryDelta ?? 0);
  const fundDeltaCents = Math.trunc(input.fundDeltaCents ?? 0);
  const corruptionDelta = Math.trunc(input.corruptionDelta ?? 0);

  if (nationalDelta === 0 && militaryDelta === 0 && fundDeltaCents === 0 && corruptionDelta === 0) {
    return getLegacyGovernanceSnapshot(client, input.profileId);
  }

  const result = await client.query<{
    national_stability: number | string;
    military_stability: number | string;
    military_fund_cents: number | string;
    corruption_risk: number | string;
  }>(
    `
      UPDATE game_states
      SET
        national_stability = GREATEST(0, LEAST(100, national_stability + $2)),
        military_stability = GREATEST(0, LEAST(100, military_stability + $3)),
        military_fund_cents = GREATEST(0, military_fund_cents + $4),
        corruption_risk = GREATEST(0, LEAST(100, corruption_risk + $5)),
        updated_at = now()
      WHERE profile_id = $1
      RETURNING national_stability, military_stability, military_fund_cents, corruption_risk
    `,
    [input.profileId, nationalDelta, militaryDelta, fundDeltaCents, corruptionDelta]
  );

  const row = result.rows[0];
  if (!row) {
    return getLegacyGovernanceSnapshot(client, input.profileId);
  }

  return {
    nationalStability: parseNumber(row.national_stability, 72),
    militaryStability: parseNumber(row.military_stability, 70),
    militaryFundCents: parseNumber(row.military_fund_cents, 250_000),
    corruptionRisk: parseNumber(row.corruption_risk, 18)
  };
}

export async function listDivisionQuotaStates(client: PoolClient, profileId: string): Promise<DivisionQuotaState[]> {
  const result = await client.query<{
    division: string;
    head_npc_id: string | null;
    quota_total: number | string;
    quota_used: number | string;
    status: 'OPEN' | 'COOLDOWN';
    cooldown_until_day: number | string | null;
    cooldown_days: number | string;
    decision_note: string;
    updated_day: number | string;
    head_name: string | null;
  }>(
    `
      SELECT
        q.division,
        q.head_npc_id,
        q.quota_total,
        q.quota_used,
        q.status,
        q.cooldown_until_day,
        q.cooldown_days,
        q.decision_note,
        q.updated_day,
        e.name AS head_name
      FROM division_quota_states q
      LEFT JOIN npc_entities e
        ON e.profile_id = q.profile_id
       AND e.npc_id = q.head_npc_id
       AND e.is_current = TRUE
      WHERE q.profile_id = $1
      ORDER BY q.division ASC
    `,
    [profileId]
  );

  return result.rows.map((row) => {
    const total = parseNumber(row.quota_total, 0);
    const used = parseNumber(row.quota_used, 0);
    return {
      division: row.division,
      headNpcId: row.head_npc_id,
      headName: row.head_name,
      quotaTotal: total,
      quotaUsed: used,
      quotaRemaining: Math.max(0, total - used),
      status: row.status === 'COOLDOWN' ? 'COOLDOWN' : 'OPEN',
      cooldownUntilDay: row.cooldown_until_day == null ? null : parseNumber(row.cooldown_until_day, 0),
      cooldownDays: parseNumber(row.cooldown_days, 2),
      decisionNote: row.decision_note,
      updatedDay: parseNumber(row.updated_day, 0)
    };
  });
}

export async function upsertDivisionQuotaState(
  client: PoolClient,
  input: {
    profileId: string;
    division: string;
    headNpcId: string | null;
    quotaTotal: number;
    quotaUsed: number;
    status: 'OPEN' | 'COOLDOWN';
    cooldownUntilDay: number | null;
    cooldownDays: number;
    decisionNote: string;
    updatedDay: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO division_quota_states (
        profile_id, division, head_npc_id, quota_total, quota_used, status,
        cooldown_until_day, cooldown_days, decision_note, updated_day
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (profile_id, division) DO UPDATE
      SET
        head_npc_id = EXCLUDED.head_npc_id,
        quota_total = EXCLUDED.quota_total,
        quota_used = EXCLUDED.quota_used,
        status = EXCLUDED.status,
        cooldown_until_day = EXCLUDED.cooldown_until_day,
        cooldown_days = EXCLUDED.cooldown_days,
        decision_note = EXCLUDED.decision_note,
        updated_day = EXCLUDED.updated_day,
        updated_at = now()
    `,
    [
      input.profileId,
      input.division,
      input.headNpcId,
      Math.max(0, Math.min(120, input.quotaTotal)),
      Math.max(0, Math.min(120, input.quotaUsed)),
      input.status,
      input.cooldownUntilDay,
      Math.max(1, Math.min(30, input.cooldownDays)),
      input.decisionNote,
      Math.max(0, input.updatedDay)
    ]
  );
}

export async function appendQuotaDecisionLog(
  client: PoolClient,
  input: {
    profileId: string;
    division: string;
    headNpcId: string | null;
    decisionDay: number;
    quotaTotal: number;
    cooldownDays: number;
    reasons: Record<string, unknown>;
    note: string;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO quota_decision_logs (
        profile_id, division, head_npc_id, decision_day, quota_total, cooldown_days, reasons, note
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `,
    [
      input.profileId,
      input.division,
      input.headNpcId,
      Math.max(0, input.decisionDay),
      Math.max(0, Math.min(120, input.quotaTotal)),
      Math.max(1, Math.min(30, input.cooldownDays)),
      toJsonb(input.reasons),
      input.note
    ]
  );
}

export async function findDivisionHeadCandidate(
  client: PoolClient,
  profileId: string,
  division: string
): Promise<{ npcId: string; name: string; leadership: number; resilience: number; fatigue: number } | null> {
  const result = await client.query<{
    npc_id: string;
    name: string;
    leadership: number | string;
    resilience: number | string;
    fatigue: number | string;
  }>(
    `
      SELECT
        e.npc_id,
        e.name,
        s.leadership,
        s.resilience,
        s.fatigue
      FROM npc_entities e
      JOIN npc_stats s
        ON s.profile_id = e.profile_id
       AND s.npc_id = e.npc_id
      WHERE e.profile_id = $1
        AND e.is_current = TRUE
        AND e.division = $2
        AND e.status = 'ACTIVE'
      ORDER BY s.leadership DESC, s.resilience DESC, s.fatigue ASC
      LIMIT 1
    `,
    [profileId, division]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    npcId: row.npc_id,
    name: row.name,
    leadership: parseNumber(row.leadership, 50),
    resilience: parseNumber(row.resilience, 50),
    fatigue: parseNumber(row.fatigue, 50)
  };
}

export async function createAcademyBatch(
  client: PoolClient,
  input: {
    batchId: string;
    profileId: string;
    track: string;
    tier: number;
    startDay: number;
    endDay: number;
    totalDays: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO academy_batches (batch_id, profile_id, track, tier, start_day, end_day, total_days, status, lock_enabled, graduation_payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', TRUE, '{}'::jsonb)
    `,
    [
      input.batchId,
      input.profileId,
      input.track,
      Math.max(1, Math.min(3, input.tier)),
      input.startDay,
      input.endDay,
      Math.max(4, Math.min(12, input.totalDays))
    ]
  );
}

export async function getActiveAcademyBatch(client: PoolClient, profileId: string): Promise<AcademyBatchRecord | null> {
  const result = await client.query(
    `
      SELECT batch_id, profile_id, track, tier, start_day, end_day, total_days, status, lock_enabled, graduation_payload
      FROM academy_batches
      WHERE profile_id = $1 AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [profileId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapAcademyBatchRow(row) : null;
}

export async function getLatestAcademyBatch(client: PoolClient, profileId: string): Promise<AcademyBatchRecord | null> {
  const result = await client.query(
    `
      SELECT batch_id, profile_id, track, tier, start_day, end_day, total_days, status, lock_enabled, graduation_payload
      FROM academy_batches
      WHERE profile_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [profileId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapAcademyBatchRow(row) : null;
}

export async function upsertAcademyBatchMember(
  client: PoolClient,
  input: {
    batchId: string;
    memberKey: string;
    holderType: 'PLAYER' | 'NPC';
    npcId: string | null;
    dayProgress?: number;
    dailyScores?: AcademyDailyScoreRecord[];
    finalScore?: number;
    passed?: boolean;
    rankPosition?: number;
    extraCertCount?: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO academy_batch_members (
        batch_id, member_key, holder_type, npc_id, day_progress, daily_scores,
        final_score, passed, rank_position, extra_cert_count
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
      ON CONFLICT (batch_id, member_key) DO UPDATE
      SET
        holder_type = EXCLUDED.holder_type,
        npc_id = EXCLUDED.npc_id,
        day_progress = EXCLUDED.day_progress,
        daily_scores = EXCLUDED.daily_scores,
        final_score = EXCLUDED.final_score,
        passed = EXCLUDED.passed,
        rank_position = EXCLUDED.rank_position,
        extra_cert_count = EXCLUDED.extra_cert_count,
        updated_at = now()
    `,
    [
      input.batchId,
      input.memberKey,
      input.holderType,
      input.npcId,
      Math.max(0, Math.min(12, input.dayProgress ?? 0)),
      toJsonb(input.dailyScores ?? []),
      Math.max(0, Math.min(100, input.finalScore ?? 0)),
      Boolean(input.passed),
      Math.max(0, input.rankPosition ?? 0),
      Math.max(0, Math.min(12, input.extraCertCount ?? 0))
    ]
  );
}

export async function listAcademyBatchMembers(
  client: PoolClient,
  batchId: string
): Promise<AcademyBatchMemberRecord[]> {
  const result = await client.query(
    `
      SELECT batch_id, member_key, holder_type, npc_id, day_progress, daily_scores, final_score, passed, rank_position, extra_cert_count
      FROM academy_batch_members
      WHERE batch_id = $1
      ORDER BY holder_type ASC, member_key ASC
    `,
    [batchId]
  );
  return result.rows.map((row) => mapAcademyBatchMemberRow(row as Record<string, unknown>));
}

export async function getAcademyBatchMember(
  client: PoolClient,
  batchId: string,
  memberKey: string
): Promise<AcademyBatchMemberRecord | null> {
  const result = await client.query(
    `
      SELECT batch_id, member_key, holder_type, npc_id, day_progress, daily_scores, final_score, passed, rank_position, extra_cert_count
      FROM academy_batch_members
      WHERE batch_id = $1 AND member_key = $2
      LIMIT 1
    `,
    [batchId, memberKey]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapAcademyBatchMemberRow(row) : null;
}

export async function updateAcademyBatchMeta(
  client: PoolClient,
  input: {
    batchId: string;
    status: 'ACTIVE' | 'GRADUATED' | 'FAILED';
    lockEnabled: boolean;
    graduationPayload: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      UPDATE academy_batches
      SET status = $2, lock_enabled = $3, graduation_payload = $4::jsonb, updated_at = now()
      WHERE batch_id = $1
    `,
    [input.batchId, input.status, input.lockEnabled, toJsonb(input.graduationPayload)]
  );
}

export async function insertRecruitmentApplicationV51(
  client: PoolClient,
  input: {
    profileId: string;
    division: string;
    holderType: 'PLAYER' | 'NPC';
    npcId: string | null;
    holderName: string;
    appliedDay: number;
    baseDiplomaScore: number;
    extraCertCount: number;
    examScore: number;
    compositeScore: number;
    fatigue: number;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    reason: string;
  }
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      INSERT INTO recruitment_applications_v51 (
        profile_id, division, holder_type, npc_id, holder_name, applied_day,
        base_diploma_score, extra_cert_count, exam_score, composite_score, fatigue, status, reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `,
    [
      input.profileId,
      input.division,
      input.holderType,
      input.npcId,
      input.holderName,
      Math.max(0, input.appliedDay),
      Math.max(0, Math.min(100, input.baseDiplomaScore)),
      Math.max(0, Math.min(30, input.extraCertCount)),
      Math.max(0, Math.min(100, input.examScore)),
      Math.max(0, Math.min(999, input.compositeScore)),
      Math.max(0, Math.min(100, input.fatigue)),
      input.status,
      input.reason
    ]
  );
  return result.rows[0]?.id ?? 0;
}

export async function updateRecruitmentApplicationStatusV51(
  client: PoolClient,
  profileId: string,
  id: number,
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED',
  reason: string
): Promise<void> {
  await client.query(
    `
      UPDATE recruitment_applications_v51
      SET status = $3, reason = $4
      WHERE profile_id = $1 AND id = $2
    `,
    [profileId, id, status, reason]
  );
}

export async function listRecruitmentCompetitionEntries(
  client: PoolClient,
  profileId: string,
  division: string,
  limit = 40
): Promise<RecruitmentCompetitionEntry[]> {
  const result = await client.query<{
    holder_type: 'PLAYER' | 'NPC';
    npc_id: string | null;
    holder_name: string;
    division: string;
    id: number;
    applied_day: number | string;
    exam_score: number | string;
    composite_score: number | string;
    fatigue: number | string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    reason: string | null;
  }>(
    `
      WITH latest AS (
        SELECT DISTINCT ON (holder_type, COALESCE(npc_id, 'PLAYER'))
          id,
          holder_type,
          npc_id,
          holder_name,
          division,
          applied_day,
          exam_score,
          composite_score,
          fatigue,
          status,
          reason
        FROM recruitment_applications_v51
        WHERE profile_id = $1 AND division = $2
        ORDER BY holder_type, COALESCE(npc_id, 'PLAYER'), applied_day DESC, id DESC
      )
      SELECT id, holder_type, npc_id, holder_name, division, applied_day, exam_score, composite_score, fatigue, status, reason
      FROM latest
      ORDER BY composite_score DESC, applied_day ASC, fatigue ASC, id ASC
      LIMIT $3
    `,
    [profileId, division, Math.max(1, Math.min(120, limit))]
  );

  return result.rows.map((row, idx) => ({
    holderType: row.holder_type,
    npcId: row.npc_id,
    name: row.holder_name,
    division: row.division,
    appliedDay: parseNumber(row.applied_day, 0),
    examScore: parseNumber(row.exam_score, 0),
    compositeScore: Number(parseNumber(row.composite_score, 0).toFixed(2)),
    fatigue: parseNumber(row.fatigue, 0),
    status: row.status,
    reason: row.reason ?? null,
    rank: idx + 1
  }));
}

export function buildEmptyExpansionState(day: number): ExpansionStateV51 {
  return {
    academyLockActive: false,
    academyLockReason: null,
    academyBatch: null,
    quotaBoard: REGISTERED_DIVISIONS.map((division) => ({
      division: division.name,
      headNpcId: null,
      headName: null,
      quotaTotal: 0,
      quotaUsed: 0,
      quotaRemaining: 0,
      status: 'COOLDOWN' as const,
      cooldownUntilDay: day + 1,
      cooldownDays: 1,
      decisionNote: 'Quota belum diinisialisasi.',
      updatedDay: day
    })),
    recruitmentRace: {
      division: null,
      top10: [],
      playerRank: null,
      playerEntry: null,
      generatedAtDay: day
    },
    performance: {
      maxNpcOps: V5_MAX_NPCS,
      adaptiveBudget: V5_MAX_NPCS,
      tickPressure: 'LOW',
      pollingHintMs: 20_000
    }
  };
}

export async function getNpcSummary(client: PoolClient, profileId: string): Promise<GameSnapshotV5['npcSummary']> {
  const result = await client.query<{ status: NpcRuntimeStatus; count: string }>(
    `
      SELECT status, COUNT(*)::text AS count
      FROM npc_entities
      WHERE profile_id = $1 AND is_current = TRUE
      GROUP BY status
    `,
    [profileId]
  );

  const summary: GameSnapshotV5['npcSummary'] = { total: 0, active: 0, injured: 0, reserve: 0, kia: 0, recruiting: 0 };
  for (const row of result.rows) {
    const count = parseNumber(row.count, 0);
    summary.total += count;
    if (row.status === 'ACTIVE') summary.active = count;
    else if (row.status === 'INJURED') summary.injured = count;
    else if (row.status === 'RESERVE') summary.reserve = count;
    else if (row.status === 'KIA') summary.kia = count;
    else if (row.status === 'RECRUITING') summary.recruiting = count;
  }
  return summary;
}

export async function buildSnapshotV5(client: PoolClient, profileId: string, nowMs: number): Promise<GameSnapshotV5 | null> {
  const world = await lockV5World(client, profileId);
  if (!world) return null;
  const npcSummary = await getNpcSummary(client, profileId);
  const activeMission = await getLatestMission(client, profileId);
  const ceremony = await getCurrentCeremony(client, profileId);

  return {
    serverNowMs: nowMs,
    stateVersion: world.stateVersion,
    world: {
      currentDay: world.currentDay,
      gameTimeScale: world.gameTimeScale,
      sessionActiveUntilMs: world.sessionActiveUntilMs
    },
    player: {
      playerName: world.playerName,
      branch: world.branch,
      rankIndex: world.rankIndex,
      moneyCents: world.moneyCents,
      morale: world.morale,
      health: world.health,
      assignment: world.assignment,
      commandAuthority: world.commandAuthority
    },
    npcSummary,
    activeMission,
    pendingCeremony: ceremony?.status === 'PENDING' ? ceremony : null
  };
}

export async function listActiveWorldProfilesForTick(client: PoolClient, nowMs: number, limit: number): Promise<string[]> {
  const result = await client.query<{ profile_id: string }>(
    `
      SELECT profile_id
      FROM game_worlds
      WHERE session_active_until_ms IS NOT NULL
        AND session_active_until_ms > $1
        AND last_tick_ms <= $1
      ORDER BY session_active_until_ms DESC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    `,
    [nowMs, limit]
  );

  return result.rows.map((row) => row.profile_id);
}

function mapMailboxRow(row: Record<string, unknown>): MailboxMessage {
  return {
    messageId: parseString(row.message_id),
    senderType: parseString(row.sender_type, 'SYSTEM') as MailboxMessage['senderType'],
    senderNpcId: row.sender_npc_id == null ? null : parseString(row.sender_npc_id),
    subject: parseString(row.subject),
    body: parseString(row.body),
    category: parseString(row.category, 'GENERAL') as MailboxMessage['category'],
    relatedRef: row.related_ref == null ? null : parseString(row.related_ref),
    createdDay: parseNumber(row.created_day, 0),
    createdAt: parseTimestamp(row.created_at, new Date().toISOString()),
    readAt: row.read_at == null ? null : parseTimestamp(row.read_at, new Date().toISOString()),
    readDay: row.read_day == null ? null : parseNumber(row.read_day, 0)
  };
}

function mapTimelineRow(row: Record<string, unknown>): SocialTimelineEvent {
  return {
    id: parseNumber(row.id, 0),
    actorType: parseString(row.actor_type, 'PLAYER') === 'NPC' ? 'NPC' : 'PLAYER',
    actorNpcId: row.actor_npc_id == null ? null : parseString(row.actor_npc_id),
    eventType: parseString(row.event_type),
    title: parseString(row.title),
    detail: parseString(row.detail),
    eventDay: parseNumber(row.event_day, 0),
    createdAt: parseTimestamp(row.created_at, new Date().toISOString()),
    meta: parseJsonObject(row.meta)
  };
}

function mapRecruitmentPipelineRow(row: Record<string, unknown>): RecruitmentPipelineState {
  return {
    applicationId: parseString(row.application_id),
    holderType: parseString(row.holder_type, 'PLAYER') === 'NPC' ? 'NPC' : 'PLAYER',
    npcId: row.npc_id == null ? null : parseString(row.npc_id),
    holderName: parseString(row.holder_name),
    division: parseString(row.division),
    status: parseString(row.status, 'REGISTRATION') as RecruitmentPipelineState['status'],
    registeredDay: parseNumber(row.registered_day, 0),
    tryoutDay: row.tryout_day == null ? null : parseNumber(row.tryout_day, 0),
    selectionDay: row.selection_day == null ? null : parseNumber(row.selection_day, 0),
    announcementDay: row.announcement_day == null ? null : parseNumber(row.announcement_day, 0),
    tryoutScore: parseNumber(row.tryout_score, 0),
    finalScore: Number(parseNumber(row.final_score, 0).toFixed(2)),
    note: parseString(row.note)
  };
}

function mapDomSessionRow(row: Record<string, unknown>): DomOperationSession {
  return {
    sessionId: parseString(row.session_id),
    sessionNo: clamp(parseNumber(row.session_no, 1), 1, 3) as 1 | 2 | 3,
    participantMode: parseString(row.participant_mode, 'NPC_ONLY') as DomOperationSession['participantMode'],
    npcSlots: Math.max(1, Math.min(40, parseNumber(row.npc_slots, 8))),
    playerJoined: parseBoolean(row.player_joined, false),
    playerJoinDay: row.player_join_day == null ? null : parseNumber(row.player_join_day, 0),
    status: parseString(row.status, 'PLANNED') as DomOperationSession['status'],
    result: parseJsonObject(row.result)
  };
}

function mapCourtCaseRow(row: Record<string, unknown>): CourtCaseV2 {
  return {
    caseId: parseString(row.case_id),
    caseType: parseString(row.case_type, 'SANCTION') as CourtCaseV2['caseType'],
    targetType: parseString(row.target_type, 'PLAYER') as CourtCaseV2['targetType'],
    targetNpcId: row.target_npc_id == null ? null : parseString(row.target_npc_id),
    requestedDay: parseNumber(row.requested_day, 0),
    status: parseString(row.status, 'PENDING') as CourtCaseV2['status'],
    verdict: row.verdict == null ? null : (parseString(row.verdict) as CourtCaseV2['verdict']),
    decisionDay: row.decision_day == null ? null : parseNumber(row.decision_day, 0),
    details: parseJsonObject(row.details)
  };
}

function mapCouncilRow(row: Record<string, unknown>): CouncilState {
  return {
    councilId: parseString(row.council_id),
    councilType: parseString(row.council_type, 'MLC') as CouncilState['councilType'],
    agenda: parseString(row.agenda),
    status: parseString(row.status, 'OPEN') as CouncilState['status'],
    openedDay: parseNumber(row.opened_day, 0),
    closedDay: row.closed_day == null ? null : parseNumber(row.closed_day, 0),
    quorum: parseNumber(row.quorum, 3),
    votes: {
      approve: parseNumber(row.approve_votes, 0),
      reject: parseNumber(row.reject_votes, 0),
      abstain: parseNumber(row.abstain_votes, 0)
    }
  };
}

function mapCommandChainOrderRow(row: Record<string, unknown>): CommandChainOrder {
  return {
    orderId: parseString(row.order_id),
    issuedDay: parseNumber(row.issued_day, 0),
    issuerType: parseString(row.issuer_type, 'PLAYER') as CommandChainOrder['issuerType'],
    issuerNpcId: row.issuer_npc_id == null ? null : parseString(row.issuer_npc_id),
    targetNpcId: row.target_npc_id == null ? null : parseString(row.target_npc_id),
    targetDivision: row.target_division == null ? null : parseString(row.target_division),
    priority: parseString(row.priority, 'MEDIUM') as CommandChainOrder['priority'],
    status: parseString(row.status, 'PENDING') as CommandChainOrder['status'],
    ackDueDay: parseNumber(row.ack_due_day, 0),
    completedDay: row.completed_day == null ? null : parseNumber(row.completed_day, 0),
    penaltyApplied: parseBoolean(row.penalty_applied, false),
    commandPayload: parseJsonObject(row.command_payload)
  };
}

function mapCommandChainAckRow(row: Record<string, unknown>): CommandChainAck {
  return {
    id: parseNumber(row.id, 0),
    orderId: parseString(row.order_id),
    actorType: parseString(row.actor_type, 'PLAYER') as CommandChainAck['actorType'],
    actorNpcId: row.actor_npc_id == null ? null : parseString(row.actor_npc_id),
    hopNo: parseNumber(row.hop_no, 0),
    forwardedToNpcId: row.forwarded_to_npc_id == null ? null : parseString(row.forwarded_to_npc_id),
    ackDay: parseNumber(row.ack_day, 0),
    note: parseString(row.note),
    createdAt: parseTimestamp(row.created_at, new Date().toISOString())
  };
}

export async function listEducationTitles(client: PoolClient): Promise<EducationTitle[]> {
  const result = await client.query<{
    title_code: string;
    label: string;
    mode: 'PREFIX' | 'SUFFIX';
    source_track: string;
    min_tier: number | string;
    active: boolean;
  }>(
    `
      SELECT title_code, label, mode, source_track, min_tier, active
      FROM education_titles
      WHERE active = TRUE
      ORDER BY mode ASC, min_tier ASC, title_code ASC
    `
  );
  return result.rows.map((row) => ({
    titleCode: row.title_code,
    label: row.label,
    mode: row.mode,
    sourceTrack: row.source_track,
    minTier: clamp(parseNumber(row.min_tier, 1), 1, 3) as 1 | 2 | 3,
    active: row.active
  }));
}

export async function insertRankHistory(
  client: PoolClient,
  input: {
    profileId: string;
    actorType: 'PLAYER' | 'NPC';
    npcId: string | null;
    oldRankIndex: number;
    newRankIndex: number;
    reason: string;
    changedDay: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO personnel_rank_history (profile_id, actor_type, npc_id, old_rank_index, new_rank_index, reason, changed_day)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.profileId,
      input.actorType,
      input.npcId,
      Math.max(0, input.oldRankIndex),
      Math.max(0, input.newRankIndex),
      input.reason,
      Math.max(0, input.changedDay)
    ]
  );
}

export async function listRankHistory(
  client: PoolClient,
  profileId: string,
  options?: { actorType?: 'PLAYER' | 'NPC'; npcId?: string; limit?: number }
): Promise<
  Array<{
    id: number;
    actorType: 'PLAYER' | 'NPC';
    npcId: string | null;
    oldRankIndex: number;
    newRankIndex: number;
    reason: string;
    changedDay: number;
    createdAt: string;
  }>
> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.actorType) {
    values.push(options.actorType);
    clauses.push(`actor_type = $${values.length}`);
  }
  if (options?.npcId) {
    values.push(options.npcId);
    clauses.push(`npc_id = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 100, 200)));
  const limitPlaceholder = `$${values.length}`;

  const result = await client.query<{
    id: number;
    actor_type: 'PLAYER' | 'NPC';
    npc_id: string | null;
    old_rank_index: number | string;
    new_rank_index: number | string;
    reason: string;
    changed_day: number | string;
    created_at: string;
  }>(
    `
      SELECT id, actor_type, npc_id, old_rank_index, new_rank_index, reason, changed_day, created_at
      FROM personnel_rank_history
      WHERE ${clauses.join(' AND ')}
      ORDER BY changed_day DESC, id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    npcId: row.npc_id,
    oldRankIndex: parseNumber(row.old_rank_index, 0),
    newRankIndex: parseNumber(row.new_rank_index, 0),
    reason: row.reason,
    changedDay: parseNumber(row.changed_day, 0),
    createdAt: parseTimestamp(row.created_at, new Date().toISOString())
  }));
}

export async function insertAssignmentHistory(
  client: PoolClient,
  input: {
    profileId: string;
    actorType: 'PLAYER' | 'NPC';
    npcId: string | null;
    oldDivision: string;
    newDivision: string;
    oldPosition: string;
    newPosition: string;
    reason: string;
    changedDay: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO personnel_assignment_history (
        profile_id, actor_type, npc_id, old_division, new_division,
        old_position, new_position, reason, changed_day
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.profileId,
      input.actorType,
      input.npcId,
      input.oldDivision,
      input.newDivision,
      input.oldPosition,
      input.newPosition,
      input.reason,
      Math.max(0, input.changedDay)
    ]
  );
}

export async function listAssignmentHistory(
  client: PoolClient,
  profileId: string,
  options?: { actorType?: 'PLAYER' | 'NPC'; npcId?: string; limit?: number }
): Promise<
  Array<{
    id: number;
    actorType: 'PLAYER' | 'NPC';
    npcId: string | null;
    oldDivision: string;
    newDivision: string;
    oldPosition: string;
    newPosition: string;
    reason: string;
    changedDay: number;
    createdAt: string;
  }>
> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.actorType) {
    values.push(options.actorType);
    clauses.push(`actor_type = $${values.length}`);
  }
  if (options?.npcId) {
    values.push(options.npcId);
    clauses.push(`npc_id = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 100, 200)));
  const limitPlaceholder = `$${values.length}`;

  const result = await client.query<{
    id: number;
    actor_type: 'PLAYER' | 'NPC';
    npc_id: string | null;
    old_division: string;
    new_division: string;
    old_position: string;
    new_position: string;
    reason: string;
    changed_day: number | string;
    created_at: string;
  }>(
    `
      SELECT
        id, actor_type, npc_id, old_division, new_division, old_position, new_position,
        reason, changed_day, created_at
      FROM personnel_assignment_history
      WHERE ${clauses.join(' AND ')}
      ORDER BY changed_day DESC, id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    npcId: row.npc_id,
    oldDivision: row.old_division,
    newDivision: row.new_division,
    oldPosition: row.old_position,
    newPosition: row.new_position,
    reason: row.reason,
    changedDay: parseNumber(row.changed_day, 0),
    createdAt: parseTimestamp(row.created_at, new Date().toISOString())
  }));
}

export async function insertMailboxMessage(
  client: PoolClient,
  input: {
    messageId: string;
    profileId: string;
    senderType: MailboxMessage['senderType'];
    senderNpcId: string | null;
    subject: string;
    body: string;
    category: MailboxMessage['category'];
    relatedRef: string | null;
    createdDay: number;
  }
): Promise<MailboxMessage> {
  const result = await client.query(
    `
      INSERT INTO mailbox_messages (
        message_id, profile_id, sender_type, sender_npc_id, subject, body, category, related_ref, created_day
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        message_id, sender_type, sender_npc_id, subject, body, category, related_ref,
        created_day, created_at, read_at, read_day
    `,
    [
      input.messageId,
      input.profileId,
      input.senderType,
      input.senderNpcId,
      input.subject,
      input.body,
      input.category,
      input.relatedRef,
      Math.max(0, input.createdDay)
    ]
  );
  return mapMailboxRow(result.rows[0] as Record<string, unknown>);
}

export async function listMailboxMessages(
  client: PoolClient,
  profileId: string,
  options?: { unreadOnly?: boolean; limit?: number; cursorDay?: number }
): Promise<MailboxMessage[]> {
  const values: unknown[] = [profileId];
  const clauses: string[] = ['profile_id = $1'];
  if (options?.unreadOnly) {
    clauses.push('read_at IS NULL');
  }
  if (typeof options?.cursorDay === 'number') {
    values.push(options.cursorDay);
    clauses.push(`created_day <= $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 40, 200)));
  const limitPlaceholder = `$${values.length}`;

  const result = await client.query(
    `
      SELECT
        message_id, sender_type, sender_npc_id, subject, body, category, related_ref,
        created_day, created_at, read_at, read_day
      FROM mailbox_messages
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_day DESC, created_at DESC, message_id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapMailboxRow(row as Record<string, unknown>));
}

export async function getMailboxSummary(
  client: PoolClient,
  profileId: string
): Promise<{ unreadCount: number; latest: MailboxMessage | null }> {
  const unread = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM mailbox_messages WHERE profile_id = $1 AND read_at IS NULL`,
    [profileId]
  );
  const latest = await listMailboxMessages(client, profileId, { limit: 1 });
  return {
    unreadCount: parseNumber(unread.rows[0]?.count, 0),
    latest: latest[0] ?? null
  };
}

export async function markMailboxMessageRead(
  client: PoolClient,
  input: { profileId: string; messageId: string; readDay: number }
): Promise<MailboxMessage | null> {
  const result = await client.query(
    `
      UPDATE mailbox_messages
      SET read_at = COALESCE(read_at, now()), read_day = COALESCE(read_day, $3)
      WHERE profile_id = $1 AND message_id = $2
      RETURNING
        message_id, sender_type, sender_npc_id, subject, body, category, related_ref,
        created_day, created_at, read_at, read_day
    `,
    [input.profileId, input.messageId, Math.max(0, input.readDay)]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapMailboxRow(row) : null;
}

export async function insertSocialTimelineEvent(
  client: PoolClient,
  input: {
    profileId: string;
    actorType: 'PLAYER' | 'NPC';
    actorNpcId: string | null;
    eventType: string;
    title: string;
    detail: string;
    eventDay: number;
    meta?: Record<string, unknown>;
  }
): Promise<SocialTimelineEvent> {
  const result = await client.query(
    `
      INSERT INTO social_timeline_events (
        profile_id, actor_type, actor_npc_id, event_type, title, detail, event_day, meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING id, actor_type, actor_npc_id, event_type, title, detail, event_day, meta, created_at
    `,
    [
      input.profileId,
      input.actorType,
      input.actorNpcId,
      input.eventType,
      input.title,
      input.detail,
      Math.max(0, input.eventDay),
      toJsonb(input.meta ?? {})
    ]
  );
  return mapTimelineRow(result.rows[0] as Record<string, unknown>);
}

export async function listSocialTimelineEvents(
  client: PoolClient,
  profileId: string,
  options?: { actorType?: 'PLAYER' | 'NPC'; actorNpcId?: string; limit?: number }
): Promise<SocialTimelineEvent[]> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.actorType) {
    values.push(options.actorType);
    clauses.push(`actor_type = $${values.length}`);
  }
  if (options?.actorNpcId) {
    values.push(options.actorNpcId);
    clauses.push(`actor_npc_id = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 80, 250)));
  const limitPlaceholder = `$${values.length}`;
  const result = await client.query(
    `
      SELECT id, actor_type, actor_npc_id, event_type, title, detail, event_day, meta, created_at
      FROM social_timeline_events
      WHERE ${clauses.join(' AND ')}
      ORDER BY event_day DESC, id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapTimelineRow(row as Record<string, unknown>));
}

export async function getLatestSocialTimelineEventByType(
  client: PoolClient,
  profileId: string,
  eventType: string
): Promise<SocialTimelineEvent | null> {
  const result = await client.query(
    `
      SELECT id, actor_type, actor_npc_id, event_type, title, detail, event_day, meta, created_at
      FROM social_timeline_events
      WHERE profile_id = $1 AND event_type = $2
      ORDER BY event_day DESC, id DESC
      LIMIT 1
    `,
    [profileId, eventType]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapTimelineRow(row) : null;
}

export async function upsertRecruitmentPipelineApplication(
  client: PoolClient,
  input: RecruitmentPipelineState & { profileId: string }
): Promise<RecruitmentPipelineState> {
  const result = await client.query(
    `
      INSERT INTO recruitment_pipeline_applications (
        application_id, profile_id, holder_type, npc_id, holder_name, division, status,
        registered_day, tryout_day, selection_day, announcement_day, tryout_score, final_score, note
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (application_id) DO UPDATE
      SET
        holder_type = EXCLUDED.holder_type,
        npc_id = EXCLUDED.npc_id,
        holder_name = EXCLUDED.holder_name,
        division = EXCLUDED.division,
        status = EXCLUDED.status,
        registered_day = EXCLUDED.registered_day,
        tryout_day = EXCLUDED.tryout_day,
        selection_day = EXCLUDED.selection_day,
        announcement_day = EXCLUDED.announcement_day,
        tryout_score = EXCLUDED.tryout_score,
        final_score = EXCLUDED.final_score,
        note = EXCLUDED.note,
        updated_at = now()
      RETURNING
        application_id, holder_type, npc_id, holder_name, division, status,
        registered_day, tryout_day, selection_day, announcement_day, tryout_score, final_score, note
    `,
    [
      input.applicationId,
      input.profileId,
      input.holderType,
      input.npcId,
      input.holderName,
      input.division,
      input.status,
      Math.max(0, input.registeredDay),
      input.tryoutDay == null ? null : Math.max(0, input.tryoutDay),
      input.selectionDay == null ? null : Math.max(0, input.selectionDay),
      input.announcementDay == null ? null : Math.max(0, input.announcementDay),
      clamp(input.tryoutScore, 0, 100),
      Number(clamp(input.finalScore, 0, 100).toFixed(2)),
      input.note
    ]
  );
  return mapRecruitmentPipelineRow(result.rows[0] as Record<string, unknown>);
}

export async function getRecruitmentPipelineApplication(
  client: PoolClient,
  profileId: string,
  applicationId: string
): Promise<RecruitmentPipelineState | null> {
  const result = await client.query(
    `
      SELECT
        application_id, holder_type, npc_id, holder_name, division, status, registered_day,
        tryout_day, selection_day, announcement_day, tryout_score, final_score, note
      FROM recruitment_pipeline_applications
      WHERE profile_id = $1 AND application_id = $2
      LIMIT 1
    `,
    [profileId, applicationId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapRecruitmentPipelineRow(row) : null;
}

export async function listRecruitmentPipelineApplications(
  client: PoolClient,
  profileId: string,
  options?: { division?: string; holderType?: 'PLAYER' | 'NPC'; limit?: number }
): Promise<RecruitmentPipelineState[]> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.division) {
    values.push(options.division);
    clauses.push(`division = $${values.length}`);
  }
  if (options?.holderType) {
    values.push(options.holderType);
    clauses.push(`holder_type = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 80, 250)));
  const limitPlaceholder = `$${values.length}`;
  const result = await client.query(
    `
      SELECT
        application_id, holder_type, npc_id, holder_name, division, status, registered_day,
        tryout_day, selection_day, announcement_day, tryout_score, final_score, note
      FROM recruitment_pipeline_applications
      WHERE ${clauses.join(' AND ')}
      ORDER BY registered_day DESC, application_id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapRecruitmentPipelineRow(row as Record<string, unknown>));
}

export async function createDomOperationCycle(
  client: PoolClient,
  input: { cycleId: string; profileId: string; startDay: number; endDay: number; status?: 'ACTIVE' | 'COMPLETED' }
): Promise<void> {
  await client.query(
    `
      INSERT INTO dom_operation_cycles (cycle_id, profile_id, start_day, end_day, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (cycle_id) DO UPDATE
      SET start_day = EXCLUDED.start_day, end_day = EXCLUDED.end_day, status = EXCLUDED.status, updated_at = now()
    `,
    [input.cycleId, input.profileId, Math.max(0, input.startDay), Math.max(0, input.endDay), input.status ?? 'ACTIVE']
  );
}

export async function upsertDomOperationSession(
  client: PoolClient,
  input: {
    sessionId: string;
    cycleId: string;
    profileId: string;
    sessionNo: 1 | 2 | 3;
    participantMode: DomOperationSession['participantMode'];
    npcSlots: number;
    playerJoined: boolean;
    playerJoinDay: number | null;
    status: DomOperationSession['status'];
    result: Record<string, unknown>;
  }
): Promise<DomOperationSession> {
  const result = await client.query(
    `
      INSERT INTO dom_operation_sessions (
        session_id, cycle_id, profile_id, session_no, participant_mode, npc_slots,
        player_joined, player_join_day, status, result
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (session_id) DO UPDATE
      SET
        cycle_id = EXCLUDED.cycle_id,
        participant_mode = EXCLUDED.participant_mode,
        npc_slots = EXCLUDED.npc_slots,
        player_joined = EXCLUDED.player_joined,
        player_join_day = EXCLUDED.player_join_day,
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        updated_at = now()
      RETURNING
        session_id, session_no, participant_mode, npc_slots, player_joined, player_join_day, status, result
    `,
    [
      input.sessionId,
      input.cycleId,
      input.profileId,
      input.sessionNo,
      input.participantMode,
      clamp(input.npcSlots, 1, 40),
      input.playerJoined,
      input.playerJoinDay,
      input.status,
      toJsonb(input.result ?? {})
    ]
  );
  return mapDomSessionRow(result.rows[0] as Record<string, unknown>);
}

export async function getDomOperationSession(
  client: PoolClient,
  profileId: string,
  sessionId: string
): Promise<DomOperationSession | null> {
  const result = await client.query(
    `
      SELECT session_id, session_no, participant_mode, npc_slots, player_joined, player_join_day, status, result
      FROM dom_operation_sessions
      WHERE profile_id = $1 AND session_id = $2
      LIMIT 1
    `,
    [profileId, sessionId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapDomSessionRow(row) : null;
}

export async function listDomOperationSessionsByCycle(
  client: PoolClient,
  profileId: string,
  cycleId: string
): Promise<DomOperationSession[]> {
  const result = await client.query(
    `
      SELECT session_id, session_no, participant_mode, npc_slots, player_joined, player_join_day, status, result
      FROM dom_operation_sessions
      WHERE profile_id = $1 AND cycle_id = $2
      ORDER BY session_no ASC
    `,
    [profileId, cycleId]
  );
  return result.rows.map((row) => mapDomSessionRow(row as Record<string, unknown>));
}

export async function getCurrentDomOperationCycle(
  client: PoolClient,
  profileId: string
): Promise<DomOperationCycle | null> {
  const cycleResult = await client.query<{
    cycle_id: string;
    start_day: number | string;
    end_day: number | string;
    status: 'ACTIVE' | 'COMPLETED';
  }>(
    `
      SELECT cycle_id, start_day, end_day, status
      FROM dom_operation_cycles
      WHERE profile_id = $1
      ORDER BY start_day DESC, cycle_id DESC
      LIMIT 1
    `,
    [profileId]
  );
  const cycle = cycleResult.rows[0];
  if (!cycle) return null;
  const sessions = await listDomOperationSessionsByCycle(client, profileId, cycle.cycle_id);
  return {
    cycleId: cycle.cycle_id,
    startDay: parseNumber(cycle.start_day, 0),
    endDay: parseNumber(cycle.end_day, 0),
    status: cycle.status,
    sessions
  };
}

export async function updateDomOperationCycleStatus(
  client: PoolClient,
  input: { profileId: string; cycleId: string; status: 'ACTIVE' | 'COMPLETED' }
): Promise<void> {
  await client.query(
    `
      UPDATE dom_operation_cycles
      SET status = $3, updated_at = now()
      WHERE profile_id = $1 AND cycle_id = $2
    `,
    [input.profileId, input.cycleId, input.status]
  );
}

export async function upsertCourtCaseV2(
  client: PoolClient,
  input: CourtCaseV2 & { profileId: string }
): Promise<CourtCaseV2> {
  const result = await client.query(
    `
      INSERT INTO court_cases_v2 (
        case_id, profile_id, case_type, target_type, target_npc_id, requested_day,
        status, verdict, decision_day, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (case_id) DO UPDATE
      SET
        case_type = EXCLUDED.case_type,
        target_type = EXCLUDED.target_type,
        target_npc_id = EXCLUDED.target_npc_id,
        requested_day = EXCLUDED.requested_day,
        status = EXCLUDED.status,
        verdict = EXCLUDED.verdict,
        decision_day = EXCLUDED.decision_day,
        details = EXCLUDED.details,
        updated_at = now()
      RETURNING
        case_id, case_type, target_type, target_npc_id, requested_day, status, verdict, decision_day, details
    `,
    [
      input.caseId,
      input.profileId,
      input.caseType,
      input.targetType,
      input.targetNpcId,
      Math.max(0, input.requestedDay),
      input.status,
      input.verdict,
      input.decisionDay,
      toJsonb(input.details ?? {})
    ]
  );
  return mapCourtCaseRow(result.rows[0] as Record<string, unknown>);
}

export async function getCourtCaseV2(
  client: PoolClient,
  profileId: string,
  caseId: string
): Promise<CourtCaseV2 | null> {
  const result = await client.query(
    `
      SELECT case_id, case_type, target_type, target_npc_id, requested_day, status, verdict, decision_day, details
      FROM court_cases_v2
      WHERE profile_id = $1 AND case_id = $2
      LIMIT 1
    `,
    [profileId, caseId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapCourtCaseRow(row) : null;
}

export async function listCourtCasesV2(
  client: PoolClient,
  profileId: string,
  options?: { status?: CourtCaseV2['status']; limit?: number }
): Promise<CourtCaseV2[]> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.status) {
    values.push(options.status);
    clauses.push(`status = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 100, 250)));
  const limitPlaceholder = `$${values.length}`;
  const result = await client.query(
    `
      SELECT case_id, case_type, target_type, target_npc_id, requested_day, status, verdict, decision_day, details
      FROM court_cases_v2
      WHERE ${clauses.join(' AND ')}
      ORDER BY requested_day DESC, case_id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapCourtCaseRow(row as Record<string, unknown>));
}

export async function upsertCouncilState(
  client: PoolClient,
  input: CouncilState & { profileId: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await client.query(
    `
      INSERT INTO councils (
        council_id, profile_id, council_type, agenda, status, opened_day, closed_day, quorum, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (council_id) DO UPDATE
      SET
        council_type = EXCLUDED.council_type,
        agenda = EXCLUDED.agenda,
        status = EXCLUDED.status,
        opened_day = EXCLUDED.opened_day,
        closed_day = EXCLUDED.closed_day,
        quorum = EXCLUDED.quorum,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      input.councilId,
      input.profileId,
      input.councilType,
      input.agenda,
      input.status,
      Math.max(0, input.openedDay),
      input.closedDay,
      Math.max(1, Math.min(50, input.quorum)),
      toJsonb(input.metadata ?? {})
    ]
  );
}

export async function listCouncils(
  client: PoolClient,
  profileId: string,
  options?: { status?: CouncilState['status']; limit?: number }
): Promise<CouncilState[]> {
  const clauses: string[] = ['c.profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.status) {
    values.push(options.status);
    clauses.push(`c.status = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 80, 250)));
  const limitPlaceholder = `$${values.length}`;

  const result = await client.query(
    `
      SELECT
        c.council_id,
        c.council_type,
        c.agenda,
        c.status,
        c.opened_day,
        c.closed_day,
        c.quorum,
        COALESCE(SUM(CASE WHEN v.vote_choice = 'APPROVE' THEN 1 ELSE 0 END), 0)::int AS approve_votes,
        COALESCE(SUM(CASE WHEN v.vote_choice = 'REJECT' THEN 1 ELSE 0 END), 0)::int AS reject_votes,
        COALESCE(SUM(CASE WHEN v.vote_choice = 'ABSTAIN' THEN 1 ELSE 0 END), 0)::int AS abstain_votes
      FROM councils c
      LEFT JOIN council_votes v ON v.council_id = c.council_id
      WHERE ${clauses.join(' AND ')}
      GROUP BY c.council_id, c.council_type, c.agenda, c.status, c.opened_day, c.closed_day, c.quorum
      ORDER BY c.opened_day DESC, c.council_id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapCouncilRow(row as Record<string, unknown>));
}

export async function getCouncilState(
  client: PoolClient,
  profileId: string,
  councilId: string
): Promise<CouncilState | null> {
  const result = await client.query(
    `
      SELECT
        c.council_id,
        c.council_type,
        c.agenda,
        c.status,
        c.opened_day,
        c.closed_day,
        c.quorum,
        COALESCE(SUM(CASE WHEN v.vote_choice = 'APPROVE' THEN 1 ELSE 0 END), 0)::int AS approve_votes,
        COALESCE(SUM(CASE WHEN v.vote_choice = 'REJECT' THEN 1 ELSE 0 END), 0)::int AS reject_votes,
        COALESCE(SUM(CASE WHEN v.vote_choice = 'ABSTAIN' THEN 1 ELSE 0 END), 0)::int AS abstain_votes
      FROM councils c
      LEFT JOIN council_votes v ON v.council_id = c.council_id
      WHERE c.profile_id = $1 AND c.council_id = $2
      GROUP BY c.council_id, c.council_type, c.agenda, c.status, c.opened_day, c.closed_day, c.quorum
      LIMIT 1
    `,
    [profileId, councilId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapCouncilRow(row) : null;
}

export async function getCouncilVoteByActor(
  client: PoolClient,
  input: { profileId: string; councilId: string; voterType: 'PLAYER' | 'NPC'; voterNpcId: string | null }
): Promise<{ voteChoice: 'APPROVE' | 'REJECT' | 'ABSTAIN'; votedDay: number } | null> {
  const result = await client.query<{
    vote_choice: 'APPROVE' | 'REJECT' | 'ABSTAIN';
    voted_day: number | string;
  }>(
    `
      SELECT vote_choice, voted_day
      FROM council_votes
      WHERE profile_id = $1
        AND council_id = $2
        AND voter_type = $3
        AND (
          ($3 = 'PLAYER' AND voter_npc_id IS NULL)
          OR ($3 = 'NPC' AND voter_npc_id = $4)
        )
      ORDER BY id DESC
      LIMIT 1
    `,
    [input.profileId, input.councilId, input.voterType, input.voterNpcId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { voteChoice: row.vote_choice, votedDay: parseNumber(row.voted_day, 0) };
}

export async function insertCouncilVote(
  client: PoolClient,
  input: {
    councilId: string;
    profileId: string;
    voterType: 'PLAYER' | 'NPC';
    voterNpcId: string | null;
    voteChoice: 'APPROVE' | 'REJECT' | 'ABSTAIN';
    rationale: string;
    votedDay: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO council_votes (council_id, profile_id, voter_type, voter_npc_id, vote_choice, rationale, voted_day)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [input.councilId, input.profileId, input.voterType, input.voterNpcId, input.voteChoice, input.rationale, Math.max(0, input.votedDay)]
  );
}

export async function createCommandChainOrder(
  client: PoolClient,
  input: {
    orderId: string;
    profileId: string;
    issuedDay: number;
    issuerType: 'PLAYER' | 'NPC';
    issuerNpcId: string | null;
    targetNpcId: string | null;
    targetDivision: string | null;
    priority: CommandChainOrder['priority'];
    status?: CommandChainOrder['status'];
    ackDueDay: number;
    completedDay?: number | null;
    penaltyApplied?: boolean;
    commandPayload: Record<string, unknown>;
  }
): Promise<CommandChainOrder> {
  const result = await client.query(
    `
      INSERT INTO command_chain_orders (
        order_id, profile_id, issued_day, issuer_type, issuer_npc_id, target_npc_id,
        target_division, priority, status, ack_due_day, completed_day, penalty_applied, command_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      ON CONFLICT (order_id) DO UPDATE
      SET
        issued_day = EXCLUDED.issued_day,
        issuer_type = EXCLUDED.issuer_type,
        issuer_npc_id = EXCLUDED.issuer_npc_id,
        target_npc_id = EXCLUDED.target_npc_id,
        target_division = EXCLUDED.target_division,
        priority = EXCLUDED.priority,
        status = EXCLUDED.status,
        ack_due_day = EXCLUDED.ack_due_day,
        completed_day = EXCLUDED.completed_day,
        penalty_applied = EXCLUDED.penalty_applied,
        command_payload = EXCLUDED.command_payload,
        updated_at = now()
      RETURNING
        order_id, issued_day, issuer_type, issuer_npc_id, target_npc_id, target_division,
        priority, status, ack_due_day, completed_day, penalty_applied, command_payload
    `,
    [
      input.orderId,
      input.profileId,
      Math.max(0, input.issuedDay),
      input.issuerType,
      input.issuerNpcId,
      input.targetNpcId,
      input.targetDivision,
      input.priority,
      input.status ?? 'PENDING',
      Math.max(0, input.ackDueDay),
      input.completedDay ?? null,
      Boolean(input.penaltyApplied),
      toJsonb(input.commandPayload)
    ]
  );
  return mapCommandChainOrderRow(result.rows[0] as Record<string, unknown>);
}

export async function getCommandChainOrder(
  client: PoolClient,
  profileId: string,
  orderId: string
): Promise<CommandChainOrder | null> {
  const result = await client.query(
    `
      SELECT
        order_id, issued_day, issuer_type, issuer_npc_id, target_npc_id, target_division,
        priority, status, ack_due_day, completed_day, penalty_applied, command_payload
      FROM command_chain_orders
      WHERE profile_id = $1 AND order_id = $2
      LIMIT 1
    `,
    [profileId, orderId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapCommandChainOrderRow(row) : null;
}

export async function listCommandChainOrders(
  client: PoolClient,
  profileId: string,
  options?: { status?: CommandChainOrder['status']; limit?: number }
): Promise<CommandChainOrder[]> {
  const clauses: string[] = ['profile_id = $1'];
  const values: unknown[] = [profileId];
  if (options?.status) {
    values.push(options.status);
    clauses.push(`status = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(options?.limit ?? 80, 250)));
  const limitPlaceholder = `$${values.length}`;
  const result = await client.query(
    `
      SELECT
        order_id, issued_day, issuer_type, issuer_npc_id, target_npc_id, target_division,
        priority, status, ack_due_day, completed_day, penalty_applied, command_payload
      FROM command_chain_orders
      WHERE ${clauses.join(' AND ')}
      ORDER BY issued_day DESC, order_id DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows.map((row) => mapCommandChainOrderRow(row as Record<string, unknown>));
}

export async function listCommandChainAcks(
  client: PoolClient,
  profileId: string,
  orderId: string
): Promise<CommandChainAck[]> {
  const result = await client.query(
    `
      SELECT id, order_id, actor_type, actor_npc_id, hop_no, forwarded_to_npc_id, ack_day, note, created_at
      FROM command_chain_acks
      WHERE profile_id = $1 AND order_id = $2
      ORDER BY hop_no ASC, id ASC
    `,
    [profileId, orderId]
  );
  return result.rows.map((row) => mapCommandChainAckRow(row as Record<string, unknown>));
}

export async function appendCommandChainAck(
  client: PoolClient,
  input: {
    orderId: string;
    profileId: string;
    actorType: CommandChainAck['actorType'];
    actorNpcId: string | null;
    hopNo: number;
    forwardedToNpcId: string | null;
    ackDay: number;
    note: string;
  }
): Promise<CommandChainAck> {
  const result = await client.query(
    `
      INSERT INTO command_chain_acks (
        order_id, profile_id, actor_type, actor_npc_id, hop_no, forwarded_to_npc_id, ack_day, note
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, order_id, actor_type, actor_npc_id, hop_no, forwarded_to_npc_id, ack_day, note, created_at
    `,
    [
      input.orderId,
      input.profileId,
      input.actorType,
      input.actorNpcId,
      Math.max(0, Math.min(60, input.hopNo)),
      input.forwardedToNpcId,
      Math.max(0, input.ackDay),
      input.note
    ]
  );
  return mapCommandChainAckRow(result.rows[0] as Record<string, unknown>);
}

export async function updateCommandChainOrderStatus(
  client: PoolClient,
  input: {
    profileId: string;
    orderId: string;
    status: CommandChainOrder['status'];
    completedDay?: number | null;
    penaltyApplied?: boolean;
  }
): Promise<CommandChainOrder | null> {
  const result = await client.query(
    `
      UPDATE command_chain_orders
      SET
        status = $3,
        completed_day = COALESCE($4, completed_day),
        penalty_applied = COALESCE($5, penalty_applied),
        updated_at = now()
      WHERE profile_id = $1 AND order_id = $2
      RETURNING
        order_id, issued_day, issuer_type, issuer_npc_id, target_npc_id, target_division,
        priority, status, ack_due_day, completed_day, penalty_applied, command_payload
    `,
    [input.profileId, input.orderId, input.status, input.completedDay ?? null, input.penaltyApplied ?? null]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? mapCommandChainOrderRow(row) : null;
}

export async function listDueCommandChainOrdersForPenalty(
  client: PoolClient,
  profileId: string,
  currentDay: number,
  limit = 20
): Promise<CommandChainOrder[]> {
  const result = await client.query(
    `
      SELECT
        order_id, issued_day, issuer_type, issuer_npc_id, target_npc_id, target_division,
        priority, status, ack_due_day, completed_day, penalty_applied, command_payload
      FROM command_chain_orders
      WHERE profile_id = $1
        AND status IN ('PENDING', 'FORWARDED')
        AND ack_due_day < $2
      ORDER BY ack_due_day ASC, issued_day ASC
      LIMIT $3
      FOR UPDATE
    `,
    [profileId, Math.max(0, currentDay), Math.max(1, Math.min(200, limit))]
  );
  return result.rows.map((row) => mapCommandChainOrderRow(row as Record<string, unknown>));
}

