import { DlqEvent, IncomingEvent, QueuedEvent } from '../../domain/events';

export interface EventMetrics {
  processed: number;
  failed: number;
  dlq: number;
  pending: number;
}

export interface DlqPage {
  items: DlqEvent[];
  total: number;
}

export interface EnqueueResult {
  duplicate: boolean;
}

export interface EventRepository {
  enqueue(event: IncomingEvent): Promise<EnqueueResult>;
  claimBatch(limit: number, leaseMs: number): Promise<QueuedEvent[]>;
  markProcessed(eventId: string, tenantId: string, externalEventId: string): Promise<void>;
  scheduleRetry(eventId: string, nextAttemptAt: Date, lastError: string): Promise<void>;
  moveToDlq(event: QueuedEvent, finalAttemptCount: number, failureReason: string): Promise<void>;
  getMetrics(): Promise<EventMetrics>;
  listDlq(limit: number, offset: number): Promise<DlqPage>;
}
