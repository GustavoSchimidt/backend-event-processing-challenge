import { FastifyBaseLogger } from 'fastify';
import { ProcessEventBatchUseCase } from '../use-cases/process-event-batch';

export interface EventWorkerConfig {
  pollIntervalMs: number;
}

export class EventWorker {
  private running = false;

  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly useCase: ProcessEventBatchUseCase,
    private readonly logger: FastifyBaseLogger,
    private readonly config: EventWorkerConfig,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.loopPromise = this.runLoop();

    this.logger.info(
      { poll_interval_ms: this.config.pollIntervalMs },
      'Background worker started',
    );
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    await this.loopPromise;

    this.logger.info('Background worker stopped');
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.useCase.execute();
      } catch (error) {
        this.logger.error(
          { err: error, log_event: 'worker_cycle_failed' },
          'Worker cycle failed',
        );
      }

      if (!this.running) {
        break;
      }

      await sleep(this.config.pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
