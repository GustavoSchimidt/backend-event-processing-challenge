import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { FastifyBaseLogger } from 'fastify';
import { PostgresEventRepository } from '../../src/infra/repositories/postgres-event-repository';
import { ProcessEventBatchUseCase } from '../../src/application/use-cases/process-event-batch';
import { IntegrationClient } from '../../src/application/ports/integration-client';
import { IncomingEvent, IntegrationService } from '../../src/domain/events';
import { IntegrationRequestError } from '../../src/domain/errors';
import { getTestDatabaseUrl, resetDatabase } from './test-db';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === '1';

class StubIntegrationClient implements IntegrationClient {
  private readonly outcomes: Array<'ok' | '500' | '429'>;

  constructor(outcomes: Array<'ok' | '500' | '429'>) {
    this.outcomes = [...outcomes];
  }

  async send(_service: IntegrationService, _event: IncomingEvent): Promise<void> {
    const next = this.outcomes.shift() ?? 'ok';

    if (next === 'ok') {
      return;
    }

    if (next === '429') {
      throw new IntegrationRequestError('rate limited', 429, 5);
    }

    throw new IntegrationRequestError('server error', 500);
  }
}

const noopLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
} as unknown as FastifyBaseLogger;

if (!runIntegration) {
  test('integration tests are disabled (set RUN_INTEGRATION_TESTS=1)', { skip: true }, () => {
    assert.ok(true);
  });
} else {
  process.env.DATABASE_URL = getTestDatabaseUrl();

  const pool = new Pool({ connectionString: getTestDatabaseUrl() });
  const repository = new PostgresEventRepository(pool);

  before(async () => {
    await pool.query('SELECT 1');
  });

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  test('worker marks event as processed on success', async () => {
    await repository.enqueue({
      event_id: '550e8400-e29b-41d4-a716-446655440030',
      tenant_id: 'tenant_a',
      type: 'payment.approved',
      payload: {},
    });

    const useCase = buildUseCase(repository, new StubIntegrationClient(['ok']));
    const processed = await useCase.execute();

    assert.equal(processed, 1);

    const stateResult = await pool.query(
      `SELECT state FROM idempotency_keys WHERE tenant_id = 'tenant_a' AND event_id = '550e8400-e29b-41d4-a716-446655440030'`,
    );

    assert.equal(stateResult.rows[0].state, 'processed');
  });

  test('worker schedules retry on integration failure', async () => {
    await repository.enqueue({
      event_id: '550e8400-e29b-41d4-a716-446655440031',
      tenant_id: 'tenant_a',
      type: 'payment.approved',
      payload: {},
    });

    const useCase = buildUseCase(repository, new StubIntegrationClient(['500']));
    await useCase.execute();

    const eventResult = await pool.query(
      `SELECT status, attempt_count FROM events WHERE tenant_id = 'tenant_a' AND event_id = '550e8400-e29b-41d4-a716-446655440031'`,
    );

    assert.equal(eventResult.rows[0].status, 'retry');
    assert.equal(eventResult.rows[0].attempt_count, 1);
  });

  test('worker uses Retry-After header as minimum backoff for 429', async () => {
    await repository.enqueue({
      event_id: '550e8400-e29b-41d4-a716-446655440032',
      tenant_id: 'tenant_a',
      type: 'payment.approved',
      payload: {},
    });

    const startedAt = Date.now();
    const useCase = buildUseCase(repository, new StubIntegrationClient(['429']));
    await useCase.execute();

    const eventResult = await pool.query(
      `
        SELECT EXTRACT(EPOCH FROM (next_attempt_at - NOW())) AS seconds_ahead
        FROM events
        WHERE tenant_id = 'tenant_a' AND event_id = '550e8400-e29b-41d4-a716-446655440032'
      `,
    );

    const secondsAhead = Number(eventResult.rows[0].seconds_ahead);
    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    assert.ok(secondsAhead >= 5 - elapsedSeconds - 0.3);
  });

  test('worker moves event to dlq after max attempts and blocks duplicate reingest', async () => {
    const event: IncomingEvent = {
      event_id: '550e8400-e29b-41d4-a716-446655440033',
      tenant_id: 'tenant_a',
      type: 'payment.approved',
      payload: {},
    };

    await repository.enqueue(event);

    const useCase = new ProcessEventBatchUseCase(repository, new StubIntegrationClient(['500', '500']), noopLogger, {
      batchSize: 10,
      concurrency: 1,
      leaseMs: 1_000,
      maxRetries: 2,
    });

    await useCase.execute();
    await pool.query(`UPDATE events SET next_attempt_at = NOW() WHERE tenant_id = 'tenant_a' AND event_id = $1`, [
      event.event_id,
    ]);
    await useCase.execute();

    const queueCountResult = await pool.query(
      `SELECT COUNT(*)::text AS count FROM events WHERE tenant_id = 'tenant_a' AND event_id = $1`,
      [event.event_id],
    );

    const dlqCountResult = await pool.query(
      `SELECT COUNT(*)::text AS count FROM dlq_events WHERE tenant_id = 'tenant_a' AND event_id = $1`,
      [event.event_id],
    );

    const keyStateResult = await pool.query(
      `SELECT state FROM idempotency_keys WHERE tenant_id = 'tenant_a' AND event_id = $1`,
      [event.event_id],
    );

    assert.equal(queueCountResult.rows[0].count, '0');
    assert.equal(dlqCountResult.rows[0].count, '1');
    assert.equal(keyStateResult.rows[0].state, 'dlq');

    const duplicateResult = await repository.enqueue(event);
    assert.equal(duplicateResult.duplicate, true);
  });
}

function buildUseCase(
  repository: PostgresEventRepository,
  integrationClient: IntegrationClient,
): ProcessEventBatchUseCase {
  return new ProcessEventBatchUseCase(repository, integrationClient, noopLogger, {
    batchSize: 10,
    concurrency: 1,
    leaseMs: 5_000,
    maxRetries: 6,
  });
}
