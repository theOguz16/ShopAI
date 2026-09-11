import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CHATGPT_ATTRIBUTION } from '@shopai/contracts';
import {
  productDetailRequestSchema,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import {
  searchProductsRequestSchema,
  searchProductsResponseSchema,
} from '@shopai/contracts/search-products';
import type { Services } from './services.js';

export const SHOPAI_WIDGET_URI = 'ui://widget/shopai-shopping-v2.html';
export const SHOPAI_WIDGET_ASSET_VERSION = '2';

export type WidgetConfig = {
  origin: string;
  resourceDomains: string[];
};

function widgetDocument(origin: string) {
  const assetUrl = new URL(
    `/assets/widget-v${SHOPAI_WIDGET_ASSET_VERSION}.js`,
    origin,
  ).toString();
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ShopAI visual shopping</title>
  </head>
  <body>
    <div id="root" data-dto-version="1"></div>
    <script type="module" src="${assetUrl}"></script>
  </body>
</html>`;
}

function searchTextResult(
  result: Awaited<ReturnType<Services['executePublicSearch']>>,
) {
  if (!result.products.length)
    return `ShopAI araması (${result.searchId}): Sonuç bulunamadı. Filtreler otomatik olarak gevşetilmedi.`;
  const products = result.products
    .map(
      (item) =>
        `- ${item.title} — ${item.size} beden, ${item.color}, ${(item.priceMinor / 100).toFixed(2)} ${item.currency}; ${item.stockStatus}; ${item.checkoutUrl}`,
    )
    .join('\n');
  return `ShopAI araması (${result.searchId}) ${result.products.length} yayımlanmış sonuç döndürdü:\n${products}`;
}

function detailTextResult(
  result: Awaited<ReturnType<Services['executeProductDetail']>>,
) {
  const variants = result.variants
    .map(
      (variant) =>
        `${variant.color}/${variant.size}: ${variant.availability}${variant.selectable ? ' (seçilebilir)' : ''}`,
    )
    .join(', ');
  return `${result.product.title} — ${result.merchant.displayName}. Varyantlar: ${variants}. Satın alma ${result.checkoutAvailable ? 'uygun' : 'uygun değil'}.`;
}

export function createMcpServer(
  services: Services,
  widget: WidgetConfig = {
    origin: 'http://127.0.0.1:3001',
    resourceDomains: ['https://example.com'],
  },
) {
  const server = new McpServer(
    { name: 'shopai', version: '0.3.0' },
    {
      instructions:
        'Ürün keşfi isteklerinde search_products kullanın. category, price, size ve color gibi desteklenen filtreleri canonical alanlara taşıyın; attributes içinde yalnız size/sizes ve color/colors kullanın. Fit/oversized/sleeve gibi henüz structured public-search filtresi olmayan nitelikleri query metninde koruyun, unsupported attribute üretmeyin. Uyumlu ChatGPT yüzeyinde structuredContent CATEGORY_SELECT → PRODUCT_GRID → PRODUCT_DETAIL visual-shopping widget akışında gösterilir; widget yoksa tool metnindeki yayımlanmış katalog bilgisini kullanıcıya sunun.',
    },
  );
  const resourceDomains = [
    ...new Set([widget.origin, ...widget.resourceDomains]),
  ];
  server.registerResource(
    'shopai-shopping-widget',
    SHOPAI_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: SHOPAI_WIDGET_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: widgetDocument(widget.origin),
          _meta: {
            ui: {
              prefersBorder: true,
              domain: widget.origin,
              csp: { connectDomains: [], resourceDomains },
            },
            'openai/widgetDescription':
              'ShopAI visual shopping: kategori seçimi, ürün görsel kartları, hızlı renk/beden/fiyat chip filtreleri ve varyant/stok kontrollü ürün detayı. Filtre chipleri yeni search_products çağrısı yapabilir.',
            'openai/widgetPrefersBorder': true,
            'openai/widgetDomain': widget.origin,
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: resourceDomains,
            },
            'shopai/assetVersion': SHOPAI_WIDGET_ASSET_VERSION,
            'shopai/dtoVersion': 1,
          },
        },
      ],
    }),
  );
  server.registerTool(
    'search_products',
    {
      title: 'ShopAI ürün arama',
      description:
        'Yayımlanmış katalogda visual-shopping araması yapar ve ChatGPT widget için kart/facet verisi döndürür. category ve price alanlarını doğrudan kullanın; attributes şu anda yalnız size/sizes ve color/colors anahtarlarını destekler. Oversized/fit/sleeve gibi diğer ürün niteliklerini attributes içine koymayın, query metninde koruyun. Widget içindeki facet değişiklikleri aynı canonical request ile bu tool’u yeniden çağırır.',
      inputSchema: searchProductsRequestSchema.shape,
      outputSchema: searchProductsResponseSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: SHOPAI_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/outputTemplate': SHOPAI_WIDGET_URI,
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': 'Ürünler aranıyor…',
        'openai/toolInvocation/invoked': 'Alışveriş sonuçları hazır',
        'shopai/dtoVersion': 1,
      },
    },
    async (input) => {
      const result = await services.executePublicSearch(
        input,
        {},
        CHATGPT_ATTRIBUTION,
      );
      const linkedResult = {
        ...result,
        products: result.products.map((item) => ({
          ...item,
          checkoutUrl: services.redirects.createLink({
            offerId: item.offerId,
            searchId: result.searchId,
            ...CHATGPT_ATTRIBUTION,
          }),
        })),
      };
      return {
        content: [
          { type: 'text' as const, text: searchTextResult(linkedResult) },
        ],
        structuredContent: linkedResult,
      };
    },
  );
  server.registerTool(
    'get_product_detail',
    {
      title: 'ShopAI ürün detayı',
      description:
        'Visual-shopping widget içinde seçilen yayımlanmış ürünün varyantlarını, tekliflerini, güncel stok durumunu, niteliklerini ve benzer ürünlerini döndürür.',
      inputSchema: productDetailRequestSchema.shape,
      outputSchema: productDetailResponseSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: SHOPAI_WIDGET_URI, visibility: ['model', 'app'] },
        'openai/outputTemplate': SHOPAI_WIDGET_URI,
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': 'Ürün detayı yükleniyor…',
        'openai/toolInvocation/invoked': 'Ürün detayı hazır',
        'shopai/dtoVersion': 1,
      },
    },
    async (input) => {
      const result = await services.executeProductDetail(
        input,
        {},
        CHATGPT_ATTRIBUTION,
      );
      const linkedResult = {
        ...result,
        offers: result.offers.map((offer) => ({
          ...offer,
          checkoutUrl: offer.checkoutUrl
            ? services.redirects.createLink({
                offerId: offer.id,
                searchId: result.searchId,
                ...CHATGPT_ATTRIBUTION,
              })
            : null,
        })),
        similarProducts: result.similarProducts.map((item) => ({
          ...item,
          checkoutUrl: services.redirects.createLink({
            offerId: item.offerId,
            searchId: result.searchId,
            ...CHATGPT_ATTRIBUTION,
          }),
        })),
      };
      return {
        content: [
          { type: 'text' as const, text: detailTextResult(linkedResult) },
        ],
        structuredContent: linkedResult,
      };
    },
  );
  return server;
}
