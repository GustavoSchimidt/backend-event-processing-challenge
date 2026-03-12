import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { resetDatabase, getTestDatabaseUrl } from './test-db';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === '1';

if (!runIntegration) {
  test('integration tests are disabled (set RUN_INTEGRATION_TESTS=1)', { skip: true }, () => {
    assert.ok(true);
  });
} else {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  process.env.WORKER_ENABLED = 'false';

  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app.services.dbPool);
  });

  test('POST /events stores a new event and returns accepted', async () => {
    const payload = {
      event_id: '550e8400-e29b-41d4-a716-446655440001',
      tenant_id: 'tenant_a',
      type: 'order.created',
      payload: { orderId: 'ORD-001' },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), { accepted: true, duplicate: false });

    const eventsResult = await app.services.dbPool.query('SELECT COUNT(*)::text AS count FROM events');
    const keysResult = await app.services.dbPool.query(
      'SELECT COUNT(*)::text AS count FROM idempotency_keys',
    );

    assert.equal(eventsResult.rows[0].count, '1');
    assert.equal(keysResult.rows[0].count, '1');
  });

  test('POST /events returns duplicate=true and does not enqueue again', async () => {
    const payload = {
      event_id: '550e8400-e29b-41d4-a716-446655440002',
      tenant_id: 'tenant_a',
      type: 'payment.approved',
      payload: {},
    };

    await app.inject({ method: 'POST', url: '/events', payload });
    const secondResponse = await app.inject({ method: 'POST', url: '/events', payload });

    assert.equal(secondResponse.statusCode, 202);
    assert.deepEqual(secondResponse.json(), { accepted: true, duplicate: true });

    const eventsResult = await app.services.dbPool.query('SELECT COUNT(*)::text AS count FROM events');
    assert.equal(eventsResult.rows[0].count, '1');
  });

  test('GET /metrics exposes counters', async () => {
    await app.services.dbPool.query(
      `
        INSERT INTO idempotency_keys (tenant_id, event_id, state)
        VALUES
          ('tenant_a', '550e8400-e29b-41d4-a716-446655440010', 'processed'),
          ('tenant_a', '550e8400-e29b-41d4-a716-446655440011', 'pending')
      `,
    );

    await app.services.dbPool.query(
      `
        INSERT INTO events (tenant_id, event_id, type, payload, status, next_attempt_at)
        VALUES
          ('tenant_a', '550e8400-e29b-41d4-a716-446655440011', 'order.created', '{}'::jsonb, 'retry', NOW()),
          ('tenant_a', '550e8400-e29b-41d4-a716-446655440012', 'order.updated', '{}'::jsonb, 'pending', NOW())
      `,
    );

    await app.services.dbPool.query(
      `
        INSERT INTO dlq_events (tenant_id, event_id, type, payload, attempt_count, failure_reason)
        VALUES ('tenant_a', '550e8400-e29b-41d4-a716-446655440013', 'payment.refused', '{}'::jsonb, 6, 'failure')
      `,
    );

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      processed: 1,
      failed: 1,
      dlq: 1,
      pending: 2,
    });
  });

  test('GET /dlq returns paginated dlq entries', async () => {
    await app.services.dbPool.query(
      `
        INSERT INTO dlq_events (tenant_id, event_id, type, payload, attempt_count, failure_reason)
        VALUES
          ('tenant_a', '550e8400-e29b-41d4-a716-446655440020', 'order.created', '{}'::jsonb, 6, 'error 1'),
          ('tenant_a', '550e8400-e29b-41d4-a716-446655440021', 'order.updated', '{}'::jsonb, 6, 'error 2')
      `,
    );

    const response = await app.inject({ method: 'GET', url: '/dlq?limit=1&offset=0' });

    assert.equal(response.statusCode, 200);

    const body = response.json() as {
      items: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
    };

    assert.equal(body.total, 2);
    assert.equal(body.limit, 1);
    assert.equal(body.offset, 0);
    assert.equal(body.items.length, 1);
  });
}
