
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  CeremonyCycleV5,
  CertificationRecordV5,
  GameSnapshotV5,
  MissionInstanceV5,
  NpcLifecycleEvent,
  NpcRuntimeState,
  NpcRuntimeStatus,
  WorldDelta
} from '@mls/shared/game-types';
import { buildNpcRegistry } from '@mls/shared/npc-registry';
import type { BranchCode } from '@mls/shared/constants';

export const V5_MAX_NPCS = 80;

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

function parseNpcStatus(value: unknown): NpcRuntimeStatus {
  const candidate = parseString(value, 'ACTIVE');
  if (candidate === 'INJURED' || candidate === 'KIA' || candidate === 'RESERVE' || candidate === 'RECRUITING') return candidate;
  return 'ACTIVE';
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
    fatigue: parseNumber(row.fatigue, 0),
    trauma: parseNumber(row.trauma, 0),
    xp: parseNumber(row.xp, 0),
    promotionPoints: parseNumber(row.promotion_points, 0),
    relationToPlayer: parseNumber(row.relation_to_player, 50),
    lastTask: row.last_task == null ? null : parseString(row.last_task),
    updatedAtMs: parseNumber(row.updated_at_ms, Date.now())
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

export async function clearV5World(client: PoolClient, profileId: string): Promise<void> {
  const tables = [
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

  for (const table of tables) {
    await client.query(`DELETE FROM ${table} WHERE profile_id = $1`, [profileId]);
  }
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
      VALUES ($1, 0, 70, 82, 0, 'Field Command', 40, 0)
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
        identity?.division ?? 'General Command',
        identity?.unit ?? 'Unit',
        identity?.position ?? 'Operations Officer'
      ]
    );

    await client.query(
      `
        INSERT INTO npc_stats (profile_id, npc_id, tactical, support, leadership, resilience, fatigue, trauma, xp, promotion_points, relation_to_player, last_tick_day, last_task)
        VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, $7, 0, NULL)
      `,
      [
        profile.profileId,
        npcId,
        42 + ((slotNo * 7 + seedBase) % 38),
        40 + ((slotNo * 11 + seedBase) % 40),
        36 + ((slotNo * 13 + seedBase) % 45),
        45 + ((slotNo * 5 + seedBase) % 35),
        40 + ((slotNo * 3 + seedBase) % 32)
      ]
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
        s.fatigue,
        s.trauma,
        s.xp,
        s.promotion_points,
        s.relation_to_player,
        s.last_task,
        EXTRACT(EPOCH FROM GREATEST(e.updated_at, s.updated_at))::bigint * 1000 AS updated_at_ms
      FROM npc_entities e
      JOIN npc_stats s ON s.profile_id = e.profile_id AND s.npc_id = e.npc_id
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
        s.fatigue,
        s.trauma,
        s.xp,
        s.promotion_points,
        s.relation_to_player,
        s.last_task,
        EXTRACT(EPOCH FROM GREATEST(e.updated_at, s.updated_at))::bigint * 1000 AS updated_at_ms
      FROM npc_entities e
      JOIN npc_stats s ON s.profile_id = e.profile_id AND s.npc_id = e.npc_id
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
        s.fatigue,
        s.trauma,
        s.xp,
        s.promotion_points,
        s.relation_to_player,
        s.last_task,
        EXTRACT(EPOCH FROM GREATEST(e.updated_at, s.updated_at))::bigint * 1000 AS updated_at_ms
      FROM npc_entities e
      JOIN npc_stats s ON s.profile_id = e.profile_id AND s.npc_id = e.npc_id
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
        fatigue = $7,
        trauma = $8,
        xp = $9,
        promotion_points = $10,
        relation_to_player = $11,
        last_tick_day = $12,
        last_task = $13,
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
      npc.fatigue,
      npc.trauma,
      npc.xp,
      npc.promotionPoints,
      npc.relationToPlayer,
      lastTickDay,
      npc.lastTask
    ]
  );
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
  await client.query(`UPDATE npc_entities SET is_current = FALSE, updated_at = now() WHERE profile_id = $1 AND slot_no = $2 AND is_current = TRUE`, [input.profileId, input.slotNo]);
  await client.query(
    `
      INSERT INTO npc_entities (profile_id, npc_id, slot_no, generation, name, division, unit, position, status, joined_day, death_day, is_current)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, NULL, TRUE)
    `,
    [input.profileId, input.npcId, input.slotNo, input.generationNext, input.name, input.division, input.unit, input.position, input.joinedDay]
  );
  await client.query(
    `
      INSERT INTO npc_stats (profile_id, npc_id, tactical, support, leadership, resilience, fatigue, trauma, xp, promotion_points, relation_to_player, last_tick_day, last_task)
      VALUES ($1, $2, 52, 52, 50, 55, 0, 0, 0, 0, 50, $3, 'recruitment')
    `,
    [input.profileId, input.npcId, input.joinedDay]
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

