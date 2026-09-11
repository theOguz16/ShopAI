export type ProductDetailHrefInput = {
  productId: string;
  searchId?: string | null;
  discoverySessionId?: string | null;
};

export function buildProductDetailHref({
  productId,
  searchId,
  discoverySessionId,
}: ProductDetailHrefInput) {
  const params = new URLSearchParams();
  if (searchId) params.set('searchId', searchId);
  if (discoverySessionId) params.set('discoverySessionId', discoverySessionId);

  const pathname = `/products/${encodeURIComponent(productId)}`;
  return params.size ? `${pathname}?${params.toString()}` : pathname;
}
