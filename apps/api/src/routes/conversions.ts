import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  MerchantConversions,
  verifyMerchantConversionRequestSignature,
} from '@shopai/commerce/merchant-conversions';
import {
  MERCHANT_CONVERSION_HEADERS,
  merchantConversionRequestSchema,
} from '@shopai/contracts/merchant-conversions';
import {
  connections,
  conversionOrders,
  PostgresMerchantConversionRepository,
  searchEvents,
  setTenantContext,
} from '@shopai/db';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiEnv } from '../env.js';

const eventSchema = z
  .object({
    orderId: z.string().min(1).max(200),
    status: z.enum(['paid', 'cancelled', 'refunded']),
    grossMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    refundedMinor: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    currency: z.literal('TRY'),
    searchId: z.string().uuid().nullable().optional(),
    offerId: z.string().uuid().nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .refine((event) => event.refundedMinor <= event.grossMinor, {
    message: 'İade tutarı brüt tutarı aşamaz.',
    path: ['refundedMinor'],
  });

const merchantIdSchema = z.string().uuid();

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function registerConversionRoutes(
  app: FastifyInstance,
  env: ApiEnv,
) {
  const merchantConversions = app.authApi.db
    ? new MerchantConversions(
        new PostgresMerchantConversionRepository(app.authApi.db),
      )
    : null;

  app.post('/merchant/conversions', async (request, reply) => {
    if (!env.CONVERSION_CALLBACK_SECRET || !merchantConversions)
      return reply.code(404).send({ code: 'CONVERSION_NOT_CONFIGURED' });
    const parsed = merchantConversionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_EVENT' });

    const merchantId = headerValue(
      request.headers[MERCHANT_CONVERSION_HEADERS.merchantId],
    );
    const timestamp = headerValue(
      request.headers[MERCHANT_CONVERSION_HEADERS.timestamp],
    );
    const signature = headerValue(
      request.headers[MERCHANT_CONVERSION_HEADERS.signature],
    );
    if (
      !merchantId ||
      !merchantIdSchema.safeParse(merchantId).success ||
      !timestamp ||
      !signature
    )
      return reply.code(401).send({ code: 'INVALID_SIGNATURE' });

    const verification = verifyMerchantConversionRequestSignature({
      rootSecret: env.CONVERSION_CALLBACK_SECRET,
      merchantId,
      timestamp,
      signature,
      payload: parsed.data,
    });
    if (!verification.valid)
      return reply.code(401).send({ code: verification.code });

    const result = await merchantConversions.confirmPaidOrder(
      merchantId,
      parsed.data,
    );
    if (result.status === 'click_not_found')
      return reply.code(404).send({ code: 'CLICK_NOT_FOUND' });
    if (result.status === 'tracking_not_configured')
      return reply.code(404).send({ code: 'CONVERSION_NOT_CONFIGURED' });
    if (result.status === 'order_conflict')
      return reply.code(409).send({ code: 'ORDER_ID_CONFLICT' });

    return reply.code(result.status === 'created' ? 201 : 200).send({
      accepted: true,
      conversionId: result.conversionId,
      duplicate: result.status === 'duplicate',
      clickId: result.clickId,
      searchId: result.searchId,
      discoverySessionId: result.discoverySessionId,
      surface: result.surface,
    });
  });

  // Legacy connector callback kept for refund/cancellation compatibility.
  app.post(
    '/v1/conversions/:merchantId/:connectionId',
    async (request, reply) => {
      if (!env.CONVERSION_CALLBACK_SECRET || !app.authApi.db)
        return reply.code(404).send({ code: 'CONVERSION_NOT_CONFIGURED' });
      const timestamp = request.headers['x-shopai-timestamp'];
      const signature = request.headers['x-shopai-signature'];
      if (typeof timestamp !== 'string' || typeof signature !== 'string')
        return reply.code(401).send({ code: 'INVALID_SIGNATURE' });
      const timestampMs = Number(timestamp) * 1000;
      if (
        !Number.isFinite(timestampMs) ||
        Math.abs(Date.now() - timestampMs) > 5 * 60_000
      )
        return reply.code(401).send({ code: 'STALE_SIGNATURE' });
      const raw = JSON.stringify(request.body);
      // Each merchant receives only its derived callback key. Possession of one
      // merchant's key cannot be used to forge another merchant's events.
      const { merchantId, connectionId } = request.params as {
        merchantId: string;
        connectionId: string;
      };
      const merchantSecret = createHmac(
        'sha256',
        env.CONVERSION_CALLBACK_SECRET,
      )
        .update(merchantId)
        .digest();
      const expected = createHmac('sha256', merchantSecret)
        .update(`${timestamp}.${raw}`)
        .digest('hex');
      const received = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      if (
        received.length !== expectedBuffer.length ||
        !timingSafeEqual(received, expectedBuffer)
      )
        return reply.code(401).send({ code: 'INVALID_SIGNATURE' });
      const parsed = eventSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ code: 'INVALID_EVENT' });
      const event = parsed.data;
      const result = await app.authApi.db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const [connection] = await tx
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(
              eq(connections.id, connectionId),
              eq(connections.merchantId, merchantId),
              eq(connections.active, true),
              eq(connections.conversionTrackingEnabled, true),
            ),
          );
        if (!connection) return null;
        let attribution: { transport: string; surface: string } | undefined;
        if (event.searchId) {
          const [row] = await tx
            .select({
              transport: searchEvents.transport,
              surface: searchEvents.surface,
            })
            .from(searchEvents)
            .where(
              and(
                eq(searchEvents.merchantId, merchantId),
                eq(searchEvents.searchId, event.searchId),
              ),
            )
            .limit(1);
          attribution = row;
        }
        const values = {
          merchantId,
          connectionId,
          externalOrderId: event.orderId,
          status: event.status,
          currency: event.currency,
          grossMinor: event.grossMinor,
          refundedMinor:
            event.status === 'cancelled'
              ? event.grossMinor
              : event.refundedMinor,
          searchId: event.searchId ?? null,
          offerId: event.offerId ?? null,
          transport: attribution?.transport ?? null,
          surface: attribution?.surface ?? null,
          occurredAt: new Date(event.occurredAt),
        };
        const [order] = await tx
          .insert(conversionOrders)
          .values(values)
          .onConflictDoUpdate({
            target: [
              conversionOrders.merchantId,
              conversionOrders.externalOrderId,
            ],
            set: {
              ...values,
              searchId: sql`coalesce(${values.searchId}, ${conversionOrders.searchId})`,
              offerId: sql`coalesce(${values.offerId}, ${conversionOrders.offerId})`,
              transport: sql`coalesce(${values.transport}, ${conversionOrders.transport})`,
              surface: sql`coalesce(${values.surface}, ${conversionOrders.surface})`,
            },
            setWhere: lte(conversionOrders.occurredAt, values.occurredAt),
          })
          .returning({ id: conversionOrders.id });
        return order ?? { id: null };
      });
      return result
        ? reply.code(202).send({ accepted: true })
        : reply.code(404).send({ code: 'CONNECTION_NOT_CONFIGURED' });
    },
  );
}
