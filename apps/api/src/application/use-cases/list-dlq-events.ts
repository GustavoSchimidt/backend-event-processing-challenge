import { DlqPage, EventRepository } from '../ports/event-repository';

export interface ListDlqInput {
  limit: number;
  offset: number;
}

export class ListDlqEventsUseCase {
  constructor(private readonly repository: EventRepository) {}

  async execute(input: ListDlqInput): Promise<DlqPage> {
    return this.repository.listDlq(input.limit, input.offset);
  }
}
