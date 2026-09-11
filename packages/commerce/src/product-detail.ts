import { randomUUID } from 'node:crypto';
import type { CatalogItem, StockStatus } from '@shopai/contracts';
import {
  type ProductDetailRequest,
  type ProductDetailResponse,
  productDetailRequestSchema,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import { type SearchProducts, stockStatus } from './index.js';

export type ProductDetailRepositoryContext = { merchantIds?: string[] };

export type ProductDetailSnapshot = {
  product: {
    id: string;
    title: string;
    description: string;
    category: string;
    imageUrl: string | null;
    imageAlt: string | null;
  };
  merchant: {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    logoUrl: string | null;
  };
  attributes: Record<string, string[]>;
  variants: Array<{
    id: string;
    size: string;
    color: string;
  }>;
  offers: Array<{
    id: string;
    variantId: string;
    priceMinor: number;
    currency: 'TRY';
    available: boolean | null;
    offerObservedAt: string;
    stockObservedAt: string | null;
    checkoutUrl: string;
  }>;
};

export interface ProductDetailRepository {
  findProductDetail(
    productId: string,
    context?: ProductDetailRepositoryContext,
  ): Promise<ProductDetailSnapshot | null>;
}

export function aggregateAvailability(statuses: readonly StockStatus[]): StockStatus {
  if (statuses.includes('in_stock')) return 'in_stock';
  if (statuses.length > 0 && statuses.every((status) => status === 'out_of_stock'))
    return 'out_of_stock';
  if (statuses.includes('stale')) return 'stale';
  return 'unknown';
}

function uniqueSimilarProducts(items: readonly CatalogItem[], productId: string) {
  const seen = new Set<string>();
  const similar: CatalogItem[] = [];
  for (const item of items) {
    if (item.productId === productId || seen.has(item.productId)) continue;
    seen.add(item.productId);
    similar.push(item);
    if (similar.length === 4) break;
  }
  return similar;
}

export class ProductDetails {
  constructor(
    private readonly repository: ProductDetailRepository,
    private readonly search: SearchProducts,
  ) {}

  async execute(
    input: unknown,
    context: ProductDetailRepositoryContext = {},
  ): Promise<ProductDetailResponse> {
    const request: ProductDetailRequest = productDetailRequestSchema.parse(input);
    const snapshot = await this.repository.findProductDetail(
      request.productId,
      context,
    );
    if (!snapshot)
      throw Object.assign(new Error('Ürün bulunamadı.'), {
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND',
      });

    const offers = snapshot.offers.map((offer) => {
      const availability = stockStatus(offer.available, offer.stockObservedAt);
      const checkoutAvailable = availability === 'in_stock';
      return {
        id: offer.id,
        variantId: offer.variantId,
        priceMinor: offer.priceMinor,
        currency: offer.currency,
        available: offer.available,
        availability,
        checkoutAvailable,
        checkoutUrl: checkoutAvailable ? offer.checkoutUrl : null,
        observedAt: offer.stockObservedAt ?? offer.offerObservedAt,
      };
    });
    const offerByVariant = new Map<string, typeof offers>();
    for (const offer of offers) {
      const current = offerByVariant.get(offer.variantId) ?? [];
      current.push(offer);
      offerByVariant.set(offer.variantId, current);
    }
    const variants = snapshot.variants.map((variant) => {
      const variantOffers = offerByVariant.get(variant.id) ?? [];
      const availability = aggregateAvailability(
        variantOffers.map((offer) => offer.availability),
      );
      return {
        ...variant,
        availability,
        selectable: variantOffers.some((offer) => offer.checkoutAvailable),
        offerIds: variantOffers.map((offer) => offer.id),
      };
    });

    const similarResult = await this.search.execute({
      merchantIds: [snapshot.merchant.id],
      filters: {
        category: snapshot.product.category,
        inStockOnly: false,
      },
      limit: 12,
    });

    return productDetailResponseSchema.parse({
      searchId: request.searchId ?? randomUUID(),
      product: {
        id: snapshot.product.id,
        title: snapshot.product.title,
        category: snapshot.product.category,
      },
      // Brand is intentionally nullable until a source connector provides it.
      brand: null,
      images: snapshot.product.imageUrl
        ? [
            {
              url: snapshot.product.imageUrl,
              alt: snapshot.product.imageAlt ?? snapshot.product.title,
            },
          ]
        : [],
      description: snapshot.product.description,
      variants,
      offers,
      availability: aggregateAvailability(
        variants.map((variant) => variant.availability),
      ),
      attributes: snapshot.attributes,
      merchant: snapshot.merchant,
      checkoutAvailable: offers.some((offer) => offer.checkoutAvailable),
      similarProducts: uniqueSimilarProducts(
        similarResult.items,
        snapshot.product.id,
      ),
    });
  }
}
