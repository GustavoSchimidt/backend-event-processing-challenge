import { FastifyBaseLogger } from 'fastify';
import { IntegrationRequestError } from '../../domain/errors';
import { IncomingEvent, QueuedEvent, resolveIntegrationTargets } from '../../domain/events';
import { computeNextAttemptAt } from '../../domain/retry-policy';
import { IntegrationClient } from '../ports/integration-client';
import { EventRepository } from '../ports/event-repository';

export interface ProcessBatchConfig {
  batchSize: number;
  concurrency: number;
  leaseMs: number;
  maxRetries: number;
}

export class ProcessEventBatchUseCase {
  constructor(
    private readonly repository: EventRepository,
    private readonly integrationClient: IntegrationClient,
    private readonly logger: FastifyBaseLogger,
    private readonly config: ProcessBatchConfig,
  ) {}

  async execute(): Promise<number> {
    const queuedEvents = await this.repository.claimBatch(this.config.batchSize, this.config.leaseMs);

    if (queuedEvents.length === 0) {
      return 0;
    }

    await runWithConcurrency(queuedEvents, this.config.concurrency, async (queuedEvent) => {
      await this.processEvent(queuedEvent);
    });

    return queuedEvents.length;
  }

  private async processEvent(queuedEvent: QueuedEvent): Promise<void> {
    this.logger.info(
      {
        log_event: 'processing_started',
        event_id: queuedEvent.eventId,
        tenant_id: queuedEvent.tenantId,
        attempt_count: queuedEvent.attemptCount,
      },
      'Event processing started',
    );

    try {
      const incomingEvent = toIncomingEvent(queuedEvent);
      const targets = resolveIntegrationTargets(incomingEvent.type);

      for (const target of targets) {
        await this.integrationClient.send(target, incomingEvent);
      }

      await this.repository.markProcessed(queuedEvent.id, queuedEvent.tenantId, queuedEvent.eventId);

      this.logger.info(
        {
          log_event: 'processing_succeeded',
          event_id: queuedEvent.eventId,
          tenant_id: queuedEvent.tenantId,
        },
        'Event processing succeeded',
      );
    } catch (error) {
      const nextAttemptCount = queuedEvent.attemptCount + 1;
      const retryAfterSeconds =
        error instanceof IntegrationRequestError ? error.retryAfterSeconds : undefined;
      const failureReason = formatProcessingError(error);

      if (nextAttemptCount >= this.config.maxRetries) {
        await this.repository.moveToDlq(queuedEvent, nextAttemptCount, failureReason);

        this.logger.error(
          {
            log_event: 'sent_to_dlq',
            event_id: queuedEvent.eventId,
            tenant_id: queuedEvent.tenantId,
            attempt_count: nextAttemptCount,
            error: failureReason,
          },
          'Event moved to DLQ',
        );
        return;
      }

      const nextAttemptAt = computeNextAttemptAt({
        attemptCount: nextAttemptCount,
        now: new Date(),
        retryAfterSeconds,
      });

      await this.repository.scheduleRetry(queuedEvent.id, nextAttemptAt, failureReason);

      this.logger.warn(
        {
          log_event: 'retry_scheduled',
          event_id: queuedEvent.eventId,
          tenant_id: queuedEvent.tenantId,
          attempt_count: nextAttemptCount,
          next_attempt_at: nextAttemptAt.toISOString(),
          error: failureReason,
        },
        'Retry scheduled for event processing',
      );
    }
  }
}

function toIncomingEvent(queuedEvent: QueuedEvent): IncomingEvent {
  return {
    event_id: queuedEvent.eventId,
    tenant_id: queuedEvent.tenantId,
    type: queuedEvent.type,
    payload: queuedEvent.payload,
  };
}

function formatProcessingError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown processing error';
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  const queue = [...values];
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();

      if (next === undefined) {
        return;
      }

      await worker(next);
    }
  });

  await Promise.all(workers);
}
