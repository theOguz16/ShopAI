import type { LiveCatalogConnector, LiveCatalogProvider } from './live.js';
import {
  parseTrendyolCredentials,
  TrendyolConnector,
} from './providers/trendyol.js';
import {
  type WooCommerceCredentials,
  WooCommerceConnector,
} from './providers/woocommerce.js';

type ProviderFactory = (credentials: unknown) => LiveCatalogConnector;

const liveCatalogConnectorFactories: Record<
  LiveCatalogProvider,
  ProviderFactory
> = {
  woocommerce: (credentials) =>
    new WooCommerceConnector(parseWooCommerceCredentials(credentials)),
  trendyol: (credentials) =>
    new TrendyolConnector(parseTrendyolCredentials(credentials)),
};

export function createLiveCatalogConnector(
  provider: string,
  credentials: unknown,
): LiveCatalogConnector {
  if (!Object.hasOwn(liveCatalogConnectorFactories, provider))
    throw new Error(`Desteklenmeyen canlı connector: ${provider}`);
  return liveCatalogConnectorFactories[provider as LiveCatalogProvider](
    credentials,
  );
}

export function isLiveCatalogProvider(
  provider: string,
): provider is LiveCatalogProvider {
  return Object.hasOwn(liveCatalogConnectorFactories, provider);
}

function parseWooCommerceCredentials(input: unknown): WooCommerceCredentials {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('WooCommerce credential payload geçersiz.');
  const value = input as Record<string, unknown>;
  const storeUrl =
    typeof value.storeUrl === 'string' ? value.storeUrl.trim() : '';
  const consumerKey =
    typeof value.consumerKey === 'string' ? value.consumerKey.trim() : '';
  const consumerSecret =
    typeof value.consumerSecret === 'string' ? value.consumerSecret.trim() : '';
  if (!storeUrl || !consumerKey || !consumerSecret)
    throw new Error('WooCommerce bağlantı bilgileri eksik.');
  return { storeUrl, consumerKey, consumerSecret };
}
