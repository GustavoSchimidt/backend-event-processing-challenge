import { Pool, PoolClient } from 'pg';
import { DlqEvent, EventStatus, IncomingEvent, QueuedEvent } from '../../domain/events';
import { DlqPage, EnqueueResult, EventMetrics, EventRepository } from '../../application/ports/event-repository';

interface QueueRow {
  id: string;
  event_id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  attempt_count: number;
  next_attempt_at: Date | string;
  lease_until: Date | string | null;
  created_at: Date | string;
}

interface DlqRow {
  id: string;
  tenant_id: string;
  event_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  failure_reason: string;
  moved_at: Date | string;
}

interface CountRow {
  count: string;
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(event: IncomingEvent): Promise<EnqueueResult> {
    return withTransaction(this.pool, async (client) => {
      const idempotencyInsertResult = await client.query(
        `
          INSERT INTO idempotency_keys (tenant_id, event_id, state)
          VALUES ($1, $2, 'pending')
          ON CONFLICT (tenant_id, event_id) DO NOTHING
          RETURNING tenant_id
        `,
        [event.tenant_id, event.event_id],
      );

      if (idempotencyInsertResult.rowCount === 0) {
        return { duplicate: true };
      }

      await client.query(
        `
          INSERT INTO events (
            tenant_id,
            event_id,
            type,
            payload,
            status,
            attempt_count,
            next_attempt_at,
            lease_until,
            last_error
          )
          VALUES ($1, $2, $3, $4, 'pending', 0, NOW(), NULL, NULL)
        `,
        [event.tenant_id, event.event_id, event.type, JSON.stringify(event.payload)],
      );

      return { duplicate: false };
    });
  }

  async claimBatch(limit: number, leaseMs: number): Promise<QueuedEvent[]> {
    const result = await this.pool.query<QueueRow>(
      `
        WITH candidates AS (
          SELECT id
          FROM events
          WHERE status IN ('pending', 'retry', 'processing')
            AND tenant_id IS NOT NULL
            AND event_id IS NOT NULL
            AND next_attempt_at <= NOW()
            AND (lease_until IS NULL OR lease_until < NOW())
          ORDER BY next_attempt_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE events e
        SET
          status = 'processing',
          lease_until = NOW() + ($2::int * INTERVAL '1 millisecond'),
          updated_at = NOW()
        FROM candidates c
        WHERE e.id = c.id
        RETURNING
          e.id,
          e.event_id,
          e.tenant_id,
          e.type,
          e.payload,
          e.status,
          e.attempt_count,
          e.next_attempt_at,
          e.lease_until,
          e.created_at
      `,
      [limit, leaseMs],
    );

    return result.rows.map(mapQueueRow);
  }

  async markProcessed(eventId: string, tenantId: string, externalEventId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          UPDATE events
          SET
            status = 'processed',
            lease_until = NULL,
            processed_at = NOW(),
            updated_at = NOW(),
            last_error = NULL
          WHERE id = $1
        `,
        [eventId],
      );

      await client.query(
        `
          UPDATE idempotency_keys
          SET state = 'processed', updated_at = NOW()
          WHERE tenant_id = $1 AND event_id = $2
        `,
        [tenantId, externalEventId],
      );
    });
  }

  async scheduleRetry(eventId: string, nextAttemptAt: Date, lastError: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE events
        SET
          status = 'retry',
          attempt_count = attempt_count + 1,
          next_attempt_at = $2,
          lease_until = NULL,
          last_error = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [eventId, nextAttemptAt, lastError],
    );
  }

  async moveToDlq(event: QueuedEvent, finalAttemptCount: number, failureReason: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO dlq_events (
            tenant_id,
            event_id,
            type,
            payload,
            attempt_count,
            failure_reason
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          event.tenantId,
          event.eventId,
          event.type,
          JSON.stringify(event.payload),
          finalAttemptCount,
          failureReason,
        ],
      );

      await client.query(`DELETE FROM events WHERE id = $1`, [event.id]);

      await client.query(
        `
          UPDATE idempotency_keys
          SET state = 'dlq', updated_at = NOW()
          WHERE tenant_id = $1 AND event_id = $2
        `,
        [event.tenantId, event.eventId],
      );
    });
  }

  async getMetrics(): Promise<EventMetrics> {
    const [processedResult, failedResult, dlqResult, pendingResult] = await Promise.all([
      this.pool.query<CountRow>(
        `SELECT COUNT(*)::text AS count FROM idempotency_keys WHERE state = 'processed'`,
      ),
      this.pool.query<CountRow>(`SELECT COUNT(*)::text AS count FROM events WHERE status = 'retry'`),
      this.pool.query<CountRow>(`SELECT COUNT(*)::text AS count FROM dlq_events`),
      this.pool.query<CountRow>(
        `SELECT COUNT(*)::text AS count FROM events WHERE status IN ('pending', 'processing', 'retry')`,
      ),
    ]);

    return {
      processed: Number.parseInt(processedResult.rows[0]?.count ?? '0', 10),
      failed: Number.parseInt(failedResult.rows[0]?.count ?? '0', 10),
      dlq: Number.parseInt(dlqResult.rows[0]?.count ?? '0', 10),
      pending: Number.parseInt(pendingResult.rows[0]?.count ?? '0', 10),
    };
  }

  async listDlq(limit: number, offset: number): Promise<DlqPage> {
    const [itemsResult, countResult] = await Promise.all([
      this.pool.query<DlqRow>(
        `
          SELECT
            id,
            tenant_id,
            event_id,
            type,
            payload,
            attempt_count,
            failure_reason,
            moved_at
          FROM dlq_events
          ORDER BY moved_at DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset],
      ),
      this.pool.query<CountRow>(`SELECT COUNT(*)::text AS count FROM dlq_events`),
    ]);

    return {
      items: itemsResult.rows.map(mapDlqRow),
      total: Number.parseInt(countResult.rows[0]?.count ?? '0', 10),
    };
  }
}

function mapQueueRow(row: QueueRow): QueuedEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    tenantId: row.tenant_id,
    type: row.type as QueuedEvent['type'],
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: new Date(row.next_attempt_at),
    leaseUntil: row.lease_until !== null ? new Date(row.lease_until) : null,
    createdAt: new Date(row.created_at),
  };
}

function mapDlqRow(row: DlqRow): DlqEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    type: row.type as DlqEvent['type'],
    payload: row.payload,
    attemptCount: row.attempt_count,
    failureReason: row.failure_reason,
    movedAt: new Date(row.moved_at),
  };
}

async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
