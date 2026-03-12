import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIntegrationTargets, validateIncomingEvent } from '../../src/domain/events';

test('validateIncomingEvent accepts a valid event', () => {
  const error = validateIncomingEvent({
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    tenant_id: 'tenant_a',
    type: 'order.created',
    payload: {},
  });

  assert.equal(error, null);
});

test('validateIncomingEvent rejects invalid UUID v4', () => {
  const error = validateIncomingEvent({
    event_id: '550e8400-e29b-11d4-a716-446655440000',
    tenant_id: 'tenant_a',
    type: 'order.created',
    payload: {},
  });

  assert.equal(error, 'event_id must be a valid UUID v4');
});

test('resolveIntegrationTargets maps order events to billing and crm', () => {
  const targets = resolveIntegrationTargets('order.updated');
  assert.deepEqual(targets, ['billing', 'crm']);
});

test('resolveIntegrationTargets maps customer events to crm and notifications', () => {
  const targets = resolveIntegrationTargets('customer.updated');
  assert.deepEqual(targets, ['crm', 'notifications']);
});
