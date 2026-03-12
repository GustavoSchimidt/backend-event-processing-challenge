import { InvalidEventError } from '../../domain/errors';
import { IncomingEvent, validateIncomingEvent } from '../../domain/events';
import { EnqueueResult, EventRepository } from '../ports/event-repository';

export class IngestEventUseCase {
  constructor(private readonly repository: EventRepository) {}

  async execute(event: IncomingEvent): Promise<EnqueueResult> {
    const validationError = validateIncomingEvent(event);

    if (validationError !== null) {
      throw new InvalidEventError(validationError);
    }

    return this.repository.enqueue(event);
  }
}
