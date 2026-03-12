import { EventMetrics, EventRepository } from '../ports/event-repository';

export class GetMetricsUseCase {
  constructor(private readonly repository: EventRepository) {}

  async execute(): Promise<EventMetrics> {
    return this.repository.getMetrics();
  }
}
