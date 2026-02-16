import type { PoolClient } from 'pg';
import type { BranchCode, CountryCode, PauseReason } from '@mls/shared/constants';
import type { AcademyCertificate, ActiveMissionState, CeremonyRecipient, MilitaryLawEntry, MissionParticipantStats, RaiderCasualty } from '@mls/shared/game-types';

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
  game_time_scale: 1 | 3;
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
  player_division: string;
  npc_award_history: Record<string, { medals: string[]; ribbons: string[] }>;
  raider_last_attack_day: number;
  raider_casualties: RaiderCasualty[];
  national_stability: number;
  military_stability: number;
  military_fund_cents: number;
  fund_secretary_npc: string | null;
  corruption_risk: number;
  court_pending_cases: Array<{ id: string; day: number; title: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; status: 'PENDING' | 'IN_REVIEW' | 'CLOSED'; requestedBy: string }>;
  military_law_current: MilitaryLawEntry | null;
  military_law_logs: MilitaryLawEntry[];
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
  mission_call_issued_day: number;
  active_mission: ActiveMissionState | null;
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


function parseNpcAwardHistory(value: unknown): Record<string, { medals: string[]; ribbons: string[] }> {
  const source = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      })()
    : value;

  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const entries = Object.entries(source as Record<string, unknown>);
  return entries.reduce<Record<string, { medals: string[]; ribbons: string[] }>>((acc, [name, payload]) => {
    const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    acc[name] = {
      medals: Array.isArray(row.medals) ? row.medals.filter((x): x is string => typeof x === 'string') : [],
      ribbons: Array.isArray(row.ribbons) ? row.ribbons.filter((x): x is string => typeof x === 'string') : []
    };
    return acc;
  }, {});
}


function parseCourtCases(value: unknown): Array<{ id: string; day: number; title: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; status: 'PENDING' | 'IN_REVIEW' | 'CLOSED'; requestedBy: string }> {
  const raw = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      })()
    : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { id: string; day: number; title: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; status: 'PENDING' | 'IN_REVIEW' | 'CLOSED'; requestedBy: string } => {
      return Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { day?: unknown }).day === 'number');
    })
    .slice(-60);
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



function parseMilitaryLawEntry(value: unknown): MilitaryLawEntry | null {
  if (!value) return null;
  const source = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })()
    : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const candidate = source as Partial<MilitaryLawEntry>;
  if (typeof candidate.version !== 'number' || typeof candidate.presetId !== 'string' || typeof candidate.title !== 'string') return null;
  if (!candidate.rules || typeof candidate.rules !== 'object') return null;
  return candidate as MilitaryLawEntry;
}

function parseMilitaryLawLogs(value: unknown): MilitaryLawEntry[] {
  if (Array.isArray(value)) return value.map((item) => parseMilitaryLawEntry(item)).filter((item): item is MilitaryLawEntry => Boolean(item)).slice(-40);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => parseMilitaryLawEntry(item)).filter((item): item is MilitaryLawEntry => Boolean(item)).slice(-40) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseActiveMission(value: unknown): ActiveMissionState | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parseActiveMission(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const mission = value as Partial<ActiveMissionState>;
  if (typeof mission.missionId !== 'string' || typeof mission.issuedDay !== 'number') return null;
  const rawPlan = mission.plan;
  const normalizedPlan =
    rawPlan && typeof rawPlan === 'object' && !Array.isArray(rawPlan)
      ? {
          strategy: typeof (rawPlan as { strategy?: unknown }).strategy === 'string' ? (rawPlan as { strategy: string }).strategy : 'layered',
          objective: typeof (rawPlan as { objective?: unknown }).objective === 'string' ? (rawPlan as { objective: string }).objective : '',
          prepChecklist: Array.isArray((rawPlan as { prepChecklist?: unknown }).prepChecklist)
            ? (rawPlan as { prepChecklist: unknown[] }).prepChecklist.filter((item): item is string => typeof item === 'string').slice(0, 4)
            : [],
          plannedBy: typeof (rawPlan as { plannedBy?: unknown }).plannedBy === 'string' ? (rawPlan as { plannedBy: string }).plannedBy : '',
          plannedAtDay: typeof (rawPlan as { plannedAtDay?: unknown }).plannedAtDay === 'number' ? (rawPlan as { plannedAtDay: number }).plannedAtDay : 0
        }
      : null;

  return {
    missionId: mission.missionId,
    issuedDay: mission.issuedDay,
    missionType: mission.missionType === 'BLACK_OPS' || mission.missionType === 'COUNTER_RAID' || mission.missionType === 'TRIBUNAL_SECURITY' ? mission.missionType : 'RECON',
    dangerTier: mission.dangerTier === 'EXTREME' || mission.dangerTier === 'HIGH' || mission.dangerTier === 'LOW' ? mission.dangerTier : 'MEDIUM',
    playerParticipates: Boolean(mission.playerParticipates),
    status: mission.status === 'RESOLVED' ? 'RESOLVED' : 'ACTIVE',
    participants: Array.isArray(mission.participants)
      ? mission.participants
          .filter((item): item is { name: string; role: 'PLAYER' | 'NPC' } => Boolean(item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'))
          .map((item) => ({ name: item.name, role: item.role === 'PLAYER' ? 'PLAYER' : 'NPC' }))
      : [],
    participantStats: Array.isArray((mission as { participantStats?: unknown }).participantStats)
      ? ((mission as { participantStats: unknown[] }).participantStats
          .filter(isMissionParticipantStatsRow)
          .map((item) => ({
            name: item.name,
            role: (item.role === 'PLAYER' ? 'PLAYER' : 'NPC') as 'PLAYER' | 'NPC',
            tactical: Number(item.tactical) || 0,
            support: Number(item.support) || 0,
            leadership: Number(item.leadership) || 0,
            resilience: Number(item.resilience) || 0,
            total: Number(item.total) || 0
          }))
          .slice(0, 16))
      : [],
    plan: normalizedPlan,
    archivedUntilCeremonyDay: typeof mission.archivedUntilCeremonyDay === 'number' ? mission.archivedUntilCeremonyDay : null
  };
}

function isMissionParticipantStatsRow(value: unknown): value is MissionParticipantStats {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<MissionParticipantStats>;
  return (
    typeof row.name === 'string' &&
    (row.role === 'PLAYER' || row.role === 'NPC') &&
    typeof row.tactical === 'number' &&
    typeof row.support === 'number' &&
    typeof row.leadership === 'number' &&
    typeof row.resilience === 'number' &&
    typeof row.total === 'number'
  );
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
        gs.game_time_scale,
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
        gs.player_division,
        gs.npc_award_history,
        gs.raider_last_attack_day,
        gs.raider_casualties,
        gs.national_stability,
        gs.military_stability,
        gs.military_fund_cents,
        gs.fund_secretary_npc,
        gs.corruption_risk,
        gs.court_pending_cases,
        gs.military_law_current,
        gs.military_law_logs,
        gs.pending_event_payload,
        gs.mission_call_issued_day,
        gs.active_mission,
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

  row.game_time_scale = row.game_time_scale === 3 ? 3 : 1;
  row.certificate_inventory = parseJsonbArray(row.certificate_inventory);
  row.ceremony_recent_awards = parseCeremonyRecipients(row.ceremony_recent_awards);
  row.player_medals = parseJsonbStringArray(row.player_medals);
  row.player_ribbons = parseJsonbStringArray(row.player_ribbons);
  row.npc_award_history = parseNpcAwardHistory(row.npc_award_history);
  row.raider_casualties = parseRaiderCasualties(row.raider_casualties);
  row.court_pending_cases = parseCourtCases(row.court_pending_cases);
  row.military_law_current = parseMilitaryLawEntry(row.military_law_current);
  row.military_law_logs = parseMilitaryLawLogs(row.military_law_logs);
  row.active_mission = parseActiveMission(row.active_mission);
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
        game_time_scale = $9,
        rank_index = $10,
        money_cents = $11,
        morale = $12,
        health = $13,
        promotion_points = $14,
        days_in_rank = $15,
        next_event_day = $16,
        last_mission_day = $17,
        academy_tier = $18,
        last_travel_place = $19,
        certificate_inventory = $20::jsonb,
        division_freedom_score = $21,
        preferred_division = $22,
        pending_event_id = $23,
        ceremony_completed_day = $24,
        ceremony_recent_awards = $25::jsonb,
        player_medals = $26::jsonb,
        player_ribbons = $27::jsonb,
        player_position = $28,
        player_division = $29,
        npc_award_history = $30::jsonb,
        raider_last_attack_day = $31,
        raider_casualties = $32::jsonb,
        national_stability = $33,
        military_stability = $34,
        military_fund_cents = $35,
        fund_secretary_npc = $36,
        corruption_risk = $37,
        court_pending_cases = $38::jsonb,
        military_law_current = $39::jsonb,
        military_law_logs = $40::jsonb,
        pending_event_payload = $41::jsonb,
        mission_call_issued_day = $42,
        active_mission = $43::jsonb,
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
      state.game_time_scale,
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
      state.player_division,
      toJsonbParam(state.npc_award_history, {}),
      state.raider_last_attack_day,
      toJsonbParam(state.raider_casualties, []),
      state.national_stability,
      state.military_stability,
      state.military_fund_cents,
      state.fund_secretary_npc,
      state.corruption_risk,
      toJsonbParam(state.court_pending_cases, []),
      toJsonbParam(state.military_law_current, null),
      toJsonbParam(state.military_law_logs, []),
      toJsonbParam(state.pending_event_payload, null),
      state.mission_call_issued_day,
      toJsonbParam(state.active_mission, null)
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
