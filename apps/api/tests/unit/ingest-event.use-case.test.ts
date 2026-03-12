import test from 'node:test';
import assert from 'node:assert/strict';
import { IngestEventUseCase } from '../../src/application/use-cases/ingest-event';
import { EventRepository } from '../../src/application/ports/event-repository';
import { IncomingEvent, QueuedEvent } from '../../src/domain/events';
import { InvalidEventError } from '../../src/domain/errors';

class InMemoryEventRepository implements EventRepository {
  private readonly seenKeys = new Set<string>();

  async enqueue(event: IncomingEvent): Promise<{ duplicate: boolean }> {
    const key = `${event.tenant_id}:${event.event_id}`;
    const duplicate = this.seenKeys.has(key);
    this.seenKeys.add(key);
    return { duplicate };
  }

  async claimBatch(_limit: number, _leaseMs: number): Promise<never[]> {
    return [];
  }

  async markProcessed(_eventId: string, _tenantId: string, _externalEventId: string): Promise<void> {}

  async scheduleRetry(_eventId: string, _nextAttemptAt: Date, _lastError: string): Promise<void> {}

  async moveToDlq(
    _event: QueuedEvent,
    _finalAttemptCount: number,
    _failureReason: string,
  ): Promise<void> {}

  async getMetrics(): Promise<{ processed: number; failed: number; dlq: number; pending: number }> {
    return { processed: 0, failed: 0, dlq: 0, pending: 0 };
  }

  async listDlq(_limit: number, _offset: number): Promise<{ items: never[]; total: number }> {
    return { items: [], total: 0 };
  }
}

test('IngestEventUseCase returns duplicate=false for first event', async () => {
  const repository = new InMemoryEventRepository();
  const useCase = new IngestEventUseCase(repository);

  const result = await useCase.execute({
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    tenant_id: 'tenant_a',
    type: 'payment.approved',
    payload: {},
  });

  assert.equal(result.duplicate, false);
});

test('IngestEventUseCase throws InvalidEventError for invalid payload', async () => {
  const repository = new InMemoryEventRepository();
  const useCase = new IngestEventUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        event_id: 'invalid-uuid',
        tenant_id: 'tenant_a',
        type: 'payment.approved',
        payload: {},
      } as IncomingEvent),
    InvalidEventError,
  );
});
