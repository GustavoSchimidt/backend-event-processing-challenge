export interface RetryBackoffInput {
  attemptCount: number;
  now: Date;
  retryAfterSeconds?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

export function computeNextAttemptAt(input: RetryBackoffInput): Date {
  const baseDelayMs = input.baseDelayMs ?? 1_000;
  const maxDelayMs = input.maxDelayMs ?? 60_000;
  const randomJitterMs = input.jitterMs ?? Math.floor(Math.random() * 250);

  const exponent = Math.max(0, input.attemptCount - 1);
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const backoffWithJitter = exponentialDelay + randomJitterMs;

  const retryAfterMs =
    input.retryAfterSeconds !== undefined && Number.isFinite(input.retryAfterSeconds)
      ? Math.max(0, input.retryAfterSeconds) * 1_000
      : 0;

  const delayMs = Math.max(backoffWithJitter, retryAfterMs);
  return new Date(input.now.getTime() + delayMs);
}
