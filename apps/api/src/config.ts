export interface AppConfig {
  apiPort: number;
  databaseUrl: string;
  mockIntegrationsUrl: string;
  workerEnabled: boolean;
  workerPollMs: number;
  workerBatchSize: number;
  workerConcurrency: number;
  workerLeaseMs: number;
  maxRetries: number;
  httpTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  return {
    apiPort: readIntEnv('API_PORT', 3000),
    databaseUrl: readRequiredEnv('DATABASE_URL'),
    mockIntegrationsUrl: process.env.MOCK_INTEGRATIONS_URL ?? 'http://localhost:4000',
    workerEnabled: readBooleanEnv('WORKER_ENABLED', true),
    workerPollMs: readIntEnv('WORKER_POLL_MS', 500),
    workerBatchSize: readIntEnv('WORKER_BATCH_SIZE', 50),
    workerConcurrency: readIntEnv('WORKER_CONCURRENCY', 10),
    workerLeaseMs: readIntEnv('WORKER_LEASE_MS', 30_000),
    maxRetries: readIntEnv('MAX_RETRIES', 6),
    httpTimeoutMs: readIntEnv('HTTP_TIMEOUT_MS', 5_000),
  };
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function readIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];

  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];

  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}
