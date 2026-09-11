import { ProductViews } from '@shopai/commerce/product-views';
import { productDetailRequestSchema } from '@shopai/contracts/product-detail';
import { PostgresProductViewEventRepository } from '@shopai/db';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.js';

type Params = { productId: string };
type Query = { searchId?: string; discoverySessionId?: string };

export async function registerProductDetailRoutes(
  app: FastifyInstance,
  services: Services,
) {
  app.get('/v1/products/:productId/detail', async (request, reply) => {
    const { productId } = request.params as Params;
    const query = request.query as Query;
    const parsed = productDetailRequestSchema.safeParse({
      productId,
      ...(query.searchId ? { searchId: query.searchId } : {}),
      ...(query.discoverySessionId
        ? { discoverySessionId: query.discoverySessionId }
        : {}),
    });
    if (!parsed.success)
      return reply
        .code(400)
        .send({ code: 'INVALID_INPUT', requestId: request.id });

    const attribution = await services.resolveRestAttribution(parsed.data);
    const result = await services.executeProductDetail(
      parsed.data,
      {},
      attribution,
    );
    const db = app.authApi.db;
    if (db) {
      await new ProductViews(new PostgresProductViewEventRepository(db)).record(
        {
          merchantId: result.merchant.id,
          productId: result.product.id,
          searchId: result.searchId,
          ...(parsed.data.discoverySessionId
            ? { discoverySessionId: parsed.data.discoverySessionId }
            : {}),
          ...attribution,
        },
      );
    }
    return {
      ...result,
      offers: result.offers.map((offer) => ({
        ...offer,
        checkoutUrl: offer.checkoutUrl
          ? services.redirects.createLink({
              offerId: offer.id,
              searchId: result.searchId,
              ...attribution,
            })
          : null,
      })),
      similarProducts: result.similarProducts.map((item) => ({
        ...item,
        checkoutUrl: services.redirects.createLink({
          offerId: item.offerId,
          searchId: result.searchId,
          ...attribution,
        }),
      })),
    };
  });
}
