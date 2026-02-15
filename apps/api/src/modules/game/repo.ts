import type { PoolClient } from 'pg';
import type { BranchCode, CountryCode, PauseReason } from '@mls/shared/constants';
import type { AcademyCertificate, CeremonyRecipient, RaiderCasualty } from '@mls/shared/game-types';

export interface DbGameStateRow {
  profile_id: string;
  start_age: number;
  player_name: string;
  country: CountryCode;
  branch: BranchCode;
  active_session_id: string | null;
  server_reference_time_ms: number;
  current_day: number;
  paused_at_ms: number | null;
  pause_reason: PauseReason | null;
  pause_token: string | null;
  pause_expires_at_ms: number | null;
  rank_index: number;
  money_cents: number;
  morale: number;
  health: number;
  promotion_points: number;
  days_in_rank: number;
  next_event_day: number;
  last_mission_day: number;
  academy_tier: number;
  last_travel_place: string | null;
  certificate_inventory: AcademyCertificate[];
  division_freedom_score: number;
  preferred_division: string | null;
  pending_event_id: number | null;
  ceremony_completed_day: number;
  ceremony_recent_awards: CeremonyRecipient[];
  player_medals: string[];
  player_ribbons: string[];
  player_position: string;
  raider_last_attack_day: number;
  raider_casualties: RaiderCasualty[];
  pending_event_payload: {
    title: string;
    description: string;
    chancePercent?: number;
    conditionLabel?: string;
    options: Array<{
      id: string;
      label: string;
      impactScope?: 'SELF' | 'ORGANIZATION';
      effectPreview?: string;
    }>;
  } | null;
  version: number;
}

export interface DbEventOption {
  id: string;
  label: string;
  effects?: {
    money?: number;
    morale?: number;
    health?: number;
    promotionPoints?: number;
  };
}

export interface DbCandidateEvent {
  id: number;
  code: string;
  base_weight: number;
  cooldown_days: number;
  title: string;
  description: string;
  options: DbEventOption[];
  last_seen_day: number;
}



function parseJsonbStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseRaiderCasualties(value: unknown): RaiderCasualty[] {
  if (Array.isArray(value)) return value as RaiderCasualty[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as RaiderCasualty[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseCeremonyRecipients(value: unknown): CeremonyRecipient[] {
  if (Array.isArray(value)) return value as CeremonyRecipient[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as CeremonyRecipient[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonbArray(value: unknown): AcademyCertificate[] {
  if (Array.isArray(value)) {
    return value as AcademyCertificate[];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as AcademyCertificate[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toJsonbParam(value: unknown, fallback: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(fallback);
  }

  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(fallback);
    }
  }

  return JSON.stringify(value);
}

export async function getProfileIdByUserId(client: PoolClient, userId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(`SELECT id FROM profiles WHERE user_id = $1`, [userId]);
  return result.rows[0]?.id ?? null;
}

export async function lockGameStateByProfileId(client: PoolClient, profileId: string): Promise<DbGameStateRow | null> {
  const result = await client.query<DbGameStateRow>(
    `
      SELECT
        p.id AS profile_id,
        p.start_age,
        p.name AS player_name,
        p.country::text AS country,
        p.branch::text AS branch,
        gs.active_session_id,
        gs.server_reference_time_ms,
        gs.current_day,
        gs.paused_at_ms,
        gs.pause_reason::text AS pause_reason,
        gs.pause_token::text AS pause_token,
        gs.pause_expires_at_ms,
        gs.rank_index,
        gs.money_cents,
        gs.morale,
        gs.health,
        gs.promotion_points,
        gs.days_in_rank,
        gs.next_event_day,
        gs.last_mission_day,
        gs.academy_tier,
        gs.last_travel_place,
        gs.certificate_inventory,
        gs.division_freedom_score,
        gs.preferred_division,
        gs.pending_event_id,
        gs.ceremony_completed_day,
        gs.ceremony_recent_awards,
        gs.player_medals,
        gs.player_ribbons,
        gs.player_position,
        gs.raider_last_attack_day,
        gs.raider_casualties,
        gs.pending_event_payload,
        gs.version
      FROM profiles p
      JOIN game_states gs ON gs.profile_id = p.id
      WHERE p.id = $1
      FOR UPDATE
    `,
    [profileId]
  );

  const row = result.rows[0] ?? null;
  if (!row) return null;

  row.certificate_inventory = parseJsonbArray(row.certificate_inventory);
  row.ceremony_recent_awards = parseCeremonyRecipients(row.ceremony_recent_awards);
  row.player_medals = parseJsonbStringArray(row.player_medals);
  row.player_ribbons = parseJsonbStringArray(row.player_ribbons);
  row.raider_casualties = parseRaiderCasualties(row.raider_casualties);
  return row;
}

export async function ensureSingleActiveSession(
  client: PoolClient,
  profileId: string,
  incomingSessionId: string
): Promise<'ok' | 'conflict'> {
  const row = await client.query<{ active_session_id: string | null }>(
    `SELECT active_session_id FROM game_states WHERE profile_id = $1 FOR UPDATE`,
    [profileId]
  );

  const activeSessionId = row.rows[0]?.active_session_id ?? null;
  if (!activeSessionId) {
    await client.query(`UPDATE game_states SET active_session_id = $2 WHERE profile_id = $1`, [profileId, incomingSessionId]);
    return 'ok';
  }

  if (activeSessionId === incomingSessionId) {
    return 'ok';
  }

  const stillValid = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM sessions WHERE id = $1) AS exists`,
    [activeSessionId]
  );

  if (stillValid.rows[0]?.exists) {
    await client.query(`UPDATE game_states SET active_session_id = $2 WHERE profile_id = $1`, [profileId, incomingSessionId]);
    return 'ok';
  }

  await client.query(`UPDATE game_states SET active_session_id = $2 WHERE profile_id = $1`, [profileId, incomingSessionId]);
  return 'ok';
}

export async function updateGameState(client: PoolClient, state: DbGameStateRow): Promise<void> {
  await client.query(
    `
      UPDATE game_states
      SET
        active_session_id = $2,
        server_reference_time_ms = $3,
        current_day = $4,
        paused_at_ms = $5,
        pause_reason = $6::pause_reason,
        pause_token = $7::uuid,
        pause_expires_at_ms = $8,
        rank_index = $9,
        money_cents = $10,
        morale = $11,
        health = $12,
        promotion_points = $13,
        days_in_rank = $14,
        next_event_day = $15,
        last_mission_day = $16,
        academy_tier = $17,
        last_travel_place = $18,
        certificate_inventory = $19::jsonb,
        division_freedom_score = $20,
        preferred_division = $21,
        pending_event_id = $22,
        ceremony_completed_day = $23,
        ceremony_recent_awards = $24::jsonb,
        player_medals = $25::jsonb,
        player_ribbons = $26::jsonb,
        player_position = $27,
        raider_last_attack_day = $28,
        raider_casualties = $29::jsonb,
        pending_event_payload = $30::jsonb,
        version = version + 1,
        updated_at = now()
      WHERE profile_id = $1
    `,
    [
      state.profile_id,
      state.active_session_id,
      state.server_reference_time_ms,
      state.current_day,
      state.paused_at_ms,
      state.pause_reason,
      state.pause_token,
      state.pause_expires_at_ms,
      state.rank_index,
      state.money_cents,
      state.morale,
      state.health,
      state.promotion_points,
      state.days_in_rank,
      state.next_event_day,
      state.last_mission_day,
      state.academy_tier,
      state.last_travel_place,
      toJsonbParam(parseJsonbArray(state.certificate_inventory), []),
      state.division_freedom_score,
      state.preferred_division,
      state.pending_event_id,
      state.ceremony_completed_day,
      toJsonbParam(state.ceremony_recent_awards, []),
      toJsonbParam(state.player_medals, []),
      toJsonbParam(state.player_ribbons, []),
      state.player_position,
      state.raider_last_attack_day,
      toJsonbParam(state.raider_casualties, []),
      toJsonbParam(state.pending_event_payload, null)
    ]
  );
}

export async function fetchCandidateEvents(
  client: PoolClient,
  profileId: string,
  country: CountryCode,
  branch: BranchCode,
  rankIndex: number
): Promise<DbCandidateEvent[]> {
  const result = await client.query<DbCandidateEvent>(
    `
      SELECT
        e.id,
        e.code,
        e.base_weight,
        e.cooldown_days,
        e.title,
        e.description,
        e.options,
        COALESCE((
          SELECT MAX(d.game_day)
          FROM decision_logs d
          WHERE d.profile_id = $1 AND d.event_id = e.id
        ), -1000000) AS last_seen_day
      FROM events e
      WHERE
        e.country = $2::country_code
        AND e.branch = $3::branch_code
        AND e.is_active = true
        AND $4 BETWEEN e.rank_min AND e.rank_max
    `,
    [profileId, country, branch, rankIndex]
  );

  return result.rows;
}

export async function getEventById(client: PoolClient, eventId: number) {
  const result = await client.query<{
    id: number;
    title: string;
    description: string;
    options: DbEventOption[];
  }>(`SELECT id, title, description, options FROM events WHERE id = $1`, [eventId]);

  const row = result.rows[0] ?? null;
  if (!row) return null;

  return row;
}

export async function insertDecisionLog(
  client: PoolClient,
  input: {
    profileId: string;
    eventId: number;
    gameDay: number;
    selectedOption: string;
    consequences: unknown;
    stateBefore: unknown;
    stateAfter: unknown;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO decision_logs (
        profile_id,
        event_id,
        game_day,
        selected_option,
        consequences,
        state_before,
        state_after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.profileId,
      input.eventId,
      input.gameDay,
      input.selectedOption,
      input.consequences,
      input.stateBefore,
      input.stateAfter
    ]
  );
}

export async function listDecisionLogs(
  client: PoolClient,
  profileId: string,
  cursor: number | undefined,
  limit: number
): Promise<
  Array<{
    id: number;
    event_id: number;
    game_day: number;
    selected_option: string;
    consequences: unknown;
    created_at: string;
  }>
> {
  const result = await client.query<{
    id: number;
    event_id: number;
    game_day: number;
    selected_option: string;
    consequences: unknown;
    created_at: string;
  }>(
    `
      SELECT id, event_id, game_day, selected_option, consequences, created_at::text
      FROM decision_logs
      WHERE profile_id = $1
      AND ($2::bigint IS NULL OR id < $2)
      ORDER BY id DESC
      LIMIT $3
    `,
    [profileId, cursor ?? null, limit]
  );

  return result.rows;
}
