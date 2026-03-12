import { Pool } from 'pg';

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE events, idempotency_keys, dlq_events RESTART IDENTITY');
}

export function getTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/events_db'
  );
}
