export const ACCEPTED_EVENT_TYPES = [
  'order.created',
  'order.updated',
  'order.cancelled',
  'payment.approved',
  'payment.refused',
  'customer.registered',
  'customer.updated',
] as const;

export type EventType = (typeof ACCEPTED_EVENT_TYPES)[number];

export type EventStatus = 'pending' | 'processing' | 'retry' | 'processed';

export type IdempotencyState = 'pending' | 'processed' | 'dlq';

export type IntegrationService = 'billing' | 'crm' | 'notifications';

export interface IncomingEvent {
  event_id: string;
  tenant_id: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface QueuedEvent {
  id: string;
  eventId: string;
  tenantId: string;
  type: EventType;
  payload: Record<string, unknown>;
  status: EventStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  leaseUntil: Date | null;
  createdAt: Date;
}

export interface DlqEvent {
  id: string;
  tenantId: string;
  eventId: string;
  type: EventType;
  payload: Record<string, unknown>;
  attemptCount: number;
  failureReason: string;
  movedAt: Date;
}

const EVENT_INTEGRATION_MAP: Record<EventType, IntegrationService[]> = {
  'order.created': ['billing', 'crm'],
  'order.updated': ['billing', 'crm'],
  'order.cancelled': ['billing', 'crm'],
  'payment.approved': ['billing'],
  'payment.refused': ['billing'],
  'customer.registered': ['crm', 'notifications'],
  'customer.updated': ['crm', 'notifications'],
};

const UUID_V4_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function resolveIntegrationTargets(eventType: EventType): IntegrationService[] {
  return EVENT_INTEGRATION_MAP[eventType];
}

export function validateIncomingEvent(input: IncomingEvent): string | null {
  if (!UUID_V4_PATTERN.test(input.event_id)) {
    return 'event_id must be a valid UUID v4';
  }

  if (input.tenant_id.trim().length === 0) {
    return 'tenant_id must be a non-empty string';
  }

  if (!ACCEPTED_EVENT_TYPES.includes(input.type)) {
    return 'type must be one of the accepted event types';
  }

  if (input.payload === null || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    return 'payload must be an object';
  }

  return null;
}
