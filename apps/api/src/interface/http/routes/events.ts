import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvalidEventError } from '../../../domain/errors';
import { ACCEPTED_EVENT_TYPES, IncomingEvent } from '../../../domain/events';

interface DlqQuery {
  limit?: number;
  offset?: number;
}

interface EventBody {
  event_id: string;
  tenant_id: string;
  type: IncomingEvent['type'];
  payload: Record<string, unknown>;
}

const EVENT_ID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: EventBody }>(
    '/events',
    {
      schema: {
        body: {
          type: 'object',
          required: ['event_id', 'tenant_id', 'type', 'payload'],
          additionalProperties: false,
          properties: {
            event_id: { type: 'string', pattern: EVENT_ID_PATTERN },
            tenant_id: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: [...ACCEPTED_EVENT_TYPES] },
            payload: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: EventBody }>, reply: FastifyReply): Promise<void> => {
      try {
        request.log.info(
          {
            log_event: 'event_received',
            event_id: request.body.event_id,
            tenant_id: request.body.tenant_id,
            type: request.body.type,
          },
          'Event received',
        );

        const result = await app.services.ingestEvent.execute(request.body);
        await reply.code(202).send({ accepted: true, duplicate: result.duplicate });
      } catch (error) {
        if (error instanceof InvalidEventError) {
          await reply.code(400).send({ error: error.message });
          return;
        }

        throw error;
      }
    },
  );

  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const metrics = await app.services.getMetrics.execute();
    await reply.send(metrics);
  });

  app.get<{ Querystring: DlqQuery }>(
    '/dlq',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: DlqQuery }>, reply: FastifyReply): Promise<void> => {
      const limit = request.query.limit ?? 50;
      const offset = request.query.offset ?? 0;

      const page = await app.services.listDlqEvents.execute({
        limit,
        offset,
      });

      await reply.send({
        items: page.items.map((item) => ({
          ...item,
          movedAt: item.movedAt.toISOString(),
        })),
        total: page.total,
        limit,
        offset,
      });
    },
  );
}
