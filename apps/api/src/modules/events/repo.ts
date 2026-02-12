import type { PoolClient } from 'pg';

export async function listActiveEventsForProfile(client: PoolClient, profileId: string, limit: number) {
  const result = await client.query<{
    id: number;
    code: string;
    title: string;
    country: string;
    branch: string;
    rank_min: number;
    rank_max: number;
    base_weight: number;
  }>(
    `
      SELECT e.id, e.code, e.title, e.country::text, e.branch::text, e.rank_min, e.rank_max, e.base_weight
      FROM events e
      JOIN profiles p ON p.country = e.country AND p.branch = e.branch
      WHERE p.id = $1 AND e.is_active = true
      ORDER BY e.base_weight DESC, e.id ASC
      LIMIT $2
    `,
    [profileId, limit]
  );

  return result.rows;
}

export async function findProfileId(client: PoolClient, userId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>('SELECT id FROM profiles WHERE user_id = $1', [userId]);
  return result.rows[0]?.id ?? null;
}
