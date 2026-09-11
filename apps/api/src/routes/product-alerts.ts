import type {
  CreateProductAlertRequest,
  ProductAlert,
} from '@shopai/contracts/product-alerts';
import {
  cancelProductAlertResponseSchema,
  createProductAlertRequestSchema,
  productAlertIdParamsSchema,
  productAlertResponseSchema,
  productAlertsResponseSchema,
} from '@shopai/contracts/product-alerts';
import {
  PostgresProductAlertRepository,
  type ShopperIdentity,
} from '@shopai/db';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireSameOrigin } from '../plugins/auth.js';
import { resolveShopperIdentity } from './saved-products.js';
import type { Services } from '../services.js';

export interface ProductAlertsApi {
  create(
    identity: ShopperIdentity,
    input: CreateProductAlertRequest,
  ): Promise<ProductAlert>;
  list(identity: ShopperIdentity): Promise<ProductAlert[]>;
  cancel(
    identity: ShopperIdentity,
    alertId: string,
  ): Promise<{ cancelled: boolean }>;
}

class MemoryProductAlertsApi implements ProductAlertsApi {
  private readonly rows = new Map<string, ProductAlert & { owner: string }>();

  constructor(private readonly services: Services) {}

  async create(identity: ShopperIdentity, input: CreateProductAlertRequest) {
    const detail = await this.services.productDetails.execute({
      productId: input.productId,
    });
    if (
      input.variantId &&
      !detail.variants.some((variant) => variant.id === input.variantId)
    )
      throw Object.assign(new Error('Varyant ürüne ait değil.'), {
        statusCode: 400,
      });
    const owner = this.owner(identity);
    const existing = [...this.rows.values()].find(
      (row) =>
        row.owner === owner &&
        row.status === 'ACTIVE' &&
        row.productId === input.productId &&
        row.variantId === (input.variantId ?? null) &&
        row.conditionType === input.conditionType &&
        row.targetValue ===
          (input.conditionType === 'PRICE_BELOW'
            ? (input.targetValue ?? null)
            : null),
    );
    if (existing) return existing;
    const alert: ProductAlert & { owner: string } = {
      id: crypto.randomUUID(),
      owner,
      productId: input.productId,
      variantId: input.variantId ?? null,
      conditionType: input.conditionType,
      targetValue:
        input.conditionType === 'PRICE_BELOW' ? (input.targetValue ?? null) : null,
      status: 'ACTIVE',
      channel: 'email',
      email: input.email.toLowerCase(),
      createdAt: new Date().toISOString(),
      triggeredAt: null,
    };
    this.rows.set(alert.id, alert);
    return alert;
  }

  async list(identity: ShopperIdentity) {
    const owner = this.owner(identity);
    return [...this.rows.values()].filter((row) => row.owner === owner);
  }

  async cancel(identity: ShopperIdentity, alertId: string) {
    const row = this.rows.get(alertId);
    if (!row || row.owner !== this.owner(identity) || row.status !== 'ACTIVE')
      return { cancelled: false };
    row.status = 'CANCELLED';
    return { cancelled: true };
  }

  private owner(identity: ShopperIdentity) {
    return identity.kind === 'user'
      ? `user:${identity.userId}`
      : `anonymous:${identity.anonymousUserId}`;
  }
}

export async function registerProductAlertRoutes(
  app: FastifyInstance,
  services: Services,
  env: ApiEnv,
) {
  const productAlertsApi: ProductAlertsApi = app.authApi.db
    ? new PostgresProductAlertRepository(app.authApi.db)
    : new MemoryProductAlertsApi(services);
  app.decorate('productAlertsApi', productAlertsApi);

  app.get('/v1/product-alerts', async (request, reply) => {
    const identity = await resolveShopperIdentity(
      request,
      reply,
      services,
      env,
    );
    return productAlertsResponseSchema.parse({
      alerts: await productAlertsApi.list(identity),
    });
  });

  app.post(
    '/v1/product-alerts',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const parsed = createProductAlertRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', requestId: request.id });
      const identity = await resolveShopperIdentity(
        request,
        reply,
        services,
        env,
      );
      const alert = await productAlertsApi.create(identity, parsed.data);
      return reply
        .code(201)
        .send(productAlertResponseSchema.parse({ alert }));
    },
  );

  app.delete(
    '/v1/product-alerts/:alertId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const parsed = productAlertIdParamsSchema.safeParse(request.params);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', requestId: request.id });
      const identity = await resolveShopperIdentity(
        request,
        reply,
        services,
        env,
      );
      const result = await productAlertsApi.cancel(
        identity,
        parsed.data.alertId,
      );
      if (!result.cancelled)
        return reply
          .code(404)
          .send({ code: 'PRODUCT_ALERT_NOT_FOUND', requestId: request.id });
      return reply.send(cancelProductAlertResponseSchema.parse(result));
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    productAlertsApi: ProductAlertsApi;
  }
}
