import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextAttemptAt } from '../../src/domain/retry-policy';

test('computeNextAttemptAt applies exponential backoff', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const nextAttemptAt = computeNextAttemptAt({
    attemptCount: 3,
    now,
    jitterMs: 0,
  });

  assert.equal(nextAttemptAt.toISOString(), '2026-01-01T00:00:04.000Z');
});

test('computeNextAttemptAt respects Retry-After when larger than backoff', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const nextAttemptAt = computeNextAttemptAt({
    attemptCount: 1,
    now,
    retryAfterSeconds: 5,
    jitterMs: 0,
  });

  assert.equal(nextAttemptAt.toISOString(), '2026-01-01T00:00:05.000Z');
});
