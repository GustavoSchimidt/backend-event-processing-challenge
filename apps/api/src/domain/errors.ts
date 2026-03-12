export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventError';
  }
}

export class IntegrationRequestError extends Error {
  public readonly statusCode?: number;

  public readonly retryAfterSeconds?: number;

  constructor(message: string, statusCode?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'IntegrationRequestError';
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
