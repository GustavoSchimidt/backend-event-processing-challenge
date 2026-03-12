import { IntegrationRequestError } from '../../domain/errors';
import { IncomingEvent, IntegrationService } from '../../domain/events';
import { IntegrationClient } from '../../application/ports/integration-client';

interface IntegrationClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

export class HttpIntegrationClient implements IntegrationClient {
  constructor(private readonly config: IntegrationClientConfig) {}

  async send(service: IntegrationService, event: IncomingEvent): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/${service}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: controller.signal,
      });

      if (response.ok) {
        return;
      }

      const responseText = await response.text();
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = parseRetryAfter(retryAfterHeader);
      const details = responseText.length > 0 ? `: ${responseText}` : '';

      throw new IntegrationRequestError(
        `Integration ${service} failed with status ${response.status}${details}`,
        response.status,
        retryAfterSeconds,
      );
    } catch (error) {
      if (error instanceof IntegrationRequestError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new IntegrationRequestError(
          `Integration ${service} timed out after ${this.config.timeoutMs}ms`,
        );
      }

      if (error instanceof Error) {
        throw new IntegrationRequestError(`Integration ${service} failed: ${error.message}`);
      }

      throw new IntegrationRequestError(`Integration ${service} failed with an unknown error`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}
