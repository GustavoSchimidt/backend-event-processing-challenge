import { IncomingEvent, IntegrationService } from '../../domain/events';

export interface IntegrationClient {
  send(service: IntegrationService, event: IncomingEvent): Promise<void>;
}
