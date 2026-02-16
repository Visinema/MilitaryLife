import type { PoolClient } from 'pg';
import type { BranchCode, CountryCode } from '@mls/shared/constants';
import { generateUuid } from '../../utils/crypto.js';

export async function findProfileByUserId(client: PoolClient, userId: string): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(`SELECT id FROM profiles WHERE user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}

export async function createProfileAndGameState(
  client: PoolClient,
  input: {
    userId: string;
    name: string;
    startAge: number;
    country: CountryCode;
    branch: BranchCode;
    sessionId: string;
    nowMs: number;
  }
): Promise<{ profileId: string }> {
  const profileId = generateUuid();
  const created = await client.query<{ id: string }>(
    `
      INSERT INTO profiles (id, user_id, name, start_age, country, branch)
      VALUES ($1, $2, $3, $4, $5::country_code, $6::branch_code)
      RETURNING id
    `,
    [profileId, input.userId, input.name, input.startAge, input.country, input.branch]
  );

  const insertedProfileId = created.rows[0].id;

  await client.query(
    `
      INSERT INTO game_states (
        profile_id,
        active_session_id,
        server_reference_time_ms,
        current_day,
        rank_index,
        money_cents,
        morale,
        health,
        promotion_points,
        days_in_rank,
        next_event_day,
        player_position,
        player_division
      ) VALUES ($1, $2, $3, 0, 0, 0, 70, 80, 0, 0, 3, 'No Position', 'Nondivisi')
    `,
    [insertedProfileId, input.sessionId, input.nowMs]
  );

  return { profileId: insertedProfileId };
}
