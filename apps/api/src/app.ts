import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loadConfig } from './config';
import { createPgPool } from './infra/db/pool';
import { PostgresEventRepository } from './infra/repositories/postgres-event-repository';
import { HttpIntegrationClient } from './infra/integrations/http-integration-client';
import { IngestEventUseCase } from './application/use-cases/ingest-event';
import { GetMetricsUseCase } from './application/use-cases/get-metrics';
import { ListDlqEventsUseCase } from './application/use-cases/list-dlq-events';
import { ProcessEventBatchUseCase } from './application/use-cases/process-event-batch';
import { EventWorker } from './application/workers/event-worker';
import { healthRoutes } from './routes/health';
import { eventRoutes } from './interface/http/routes/events';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  const config = loadConfig();

  const dbPool = createPgPool(config.databaseUrl);
  const repository = new PostgresEventRepository(dbPool);
  const integrationClient = new HttpIntegrationClient({
    baseUrl: config.mockIntegrationsUrl,
    timeoutMs: config.httpTimeoutMs,
  });

  const ingestEvent = new IngestEventUseCase(repository);
  const getMetrics = new GetMetricsUseCase(repository);
  const listDlqEvents = new ListDlqEventsUseCase(repository);

  const processEventBatch = new ProcessEventBatchUseCase(
    repository,
    integrationClient,
    app.log,
    {
      batchSize: config.workerBatchSize,
      concurrency: config.workerConcurrency,
      leaseMs: config.workerLeaseMs,
      maxRetries: config.maxRetries,
    },
  );

  const worker = new EventWorker(processEventBatch, app.log, {
    pollIntervalMs: config.workerPollMs,
  });

  app.decorate('services', {
    ingestEvent,
    getMetrics,
    listDlqEvents,
    worker,
    dbPool,
  });

  await app.register(sensible);

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(eventRoutes);

  app.addHook('onClose', async (): Promise<void> => {
    await app.services.worker.stop();
    await app.services.dbPool.end();
  });

  return app;
}
