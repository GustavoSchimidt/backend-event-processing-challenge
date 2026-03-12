import { Pool } from 'pg';

export function createPgPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 20,
  });
}
