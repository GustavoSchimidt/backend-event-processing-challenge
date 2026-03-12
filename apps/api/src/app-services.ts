import { Pool } from 'pg';
import { EventWorker } from './application/workers/event-worker';
import { GetMetricsUseCase } from './application/use-cases/get-metrics';
import { IngestEventUseCase } from './application/use-cases/ingest-event';
import { ListDlqEventsUseCase } from './application/use-cases/list-dlq-events';

export interface AppServices {
  ingestEvent: IngestEventUseCase;
  getMetrics: GetMetricsUseCase;
  listDlqEvents: ListDlqEventsUseCase;
  worker: EventWorker;
  dbPool: Pool;
}
