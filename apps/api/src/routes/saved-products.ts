import type {
  SavedProduct,
  SaveProductRequest,
} from '@shopai/contracts/saved-products';
import {
  savedProductResponseSchema,
  savedProductsResponseSchema,
  saveProductRequestSchema,
} from '@shopai/contracts/saved-products';
import {
  PostgresSavedProductRepository,
  type ShopperIdentity,
} from '@shopai/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../env.js';
import { ensureAnonymousUserId } from '../plugins/anonymous-user.js';
import { requireSameOrigin } from '../plugins/auth.js';
import type { Services } from '../services.js';

export interface SavedProductsApi {
  save(
    identity: ShopperIdentity,
    input: SaveProductRequest,
  ): Promise<SavedProduct>;
  list(identity: ShopperIdentity): Promise<SavedProduct[]>;
}

class MemorySavedProductsApi implements SavedProductsApi {
  private readonly rows = new Map<string, SavedProduct>();

  constructor(private readonly services: Services) {}

  async save(identity: ShopperIdentity, input: SaveProductRequest) {
    const key = this.key(identity, input);
    const existing = this.rows.get(key);
    if (existing) return existing;

    const detail = await this.services.productDetails.execute({
      productId: input.productId,
    });
    const variant = input.variantId
      ? detail.variants.find((candidate) => candidate.id === input.variantId)
      : undefined;
    if (input.variantId && !variant)
      throw Object.assign(new Error('Varyant ürüne ait değil.'), {
        statusCode: 400,
        code: 'VARIANT_PRODUCT_MISMATCH',
      });

    const item: SavedProduct = {
      id: crypto.randomUUID(),
      productId: detail.product.id,
      variantId: input.variantId ?? null,
      createdAt: new Date().toISOString(),
      available: true,
      product: {
        title: detail.product.title,
        imageUrl: detail.images[0]?.url ?? null,
        imageAlt: detail.images[0]?.alt ?? null,
        merchantName: detail.merchant.displayName,
        merchantSlug: detail.merchant.slug,
      },
      variant: variant ? { size: variant.size, color: variant.color } : null,
    };
    this.rows.set(key, item);
    return item;
  }

  async list(identity: ShopperIdentity) {
    const prefix = `${this.identityKey(identity)}:`;
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, row]) => row)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private key(identity: ShopperIdentity, input: SaveProductRequest) {
    return `${this.identityKey(identity)}:${input.productId}:${input.variantId ?? '-'}`;
  }

  private identityKey(identity: ShopperIdentity) {
    return 'userId' in identity
      ? `user:${identity.userId}`
      : `anonymous:${identity.anonymousUserId}`;
  }
}

export async function resolveShopperIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  services: Services,
  env: ApiEnv,
): Promise<ShopperIdentity> {
  if (request.auth) return { userId: request.auth.userId };
  const anonymousUserId = ensureAnonymousUserId(request, reply, env);
  await services.shoppingProfiles.getOrCreate(anonymousUserId);
  return { anonymousUserId };
}

export async function registerSavedProductRoutes(
  app: FastifyInstance,
  services: Services,
  env: ApiEnv,
) {
  const savedProductsApi: SavedProductsApi = app.authApi.db
    ? new PostgresSavedProductRepository(app.authApi.db)
    : new MemorySavedProductsApi(services);
  app.decorate('savedProductsApi', savedProductsApi);

  app.get('/v1/saved-products', async (request, reply) => {
    const identity = await resolveShopperIdentity(
      request,
      reply,
      services,
      env,
    );
    return savedProductsResponseSchema.parse({
      items: await savedProductsApi.list(identity),
    });
  });

  app.post(
    '/v1/saved-products',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const parsed = saveProductRequestSchema.safeParse(request.body);
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
      const item = await savedProductsApi.save(identity, parsed.data);
      return reply
        .code(201)
        .send(savedProductResponseSchema.parse({ item }));
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    savedProductsApi: SavedProductsApi;
  }
}
