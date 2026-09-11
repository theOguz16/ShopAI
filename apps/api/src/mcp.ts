import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CHATGPT_ATTRIBUTION } from '@shopai/contracts';
import {
  cancelProductAlertResponseSchema,
  createProductAlertRequestSchema,
  productAlertIdParamsSchema,
  productAlertResponseSchema,
  productAlertsResponseSchema,
} from '@shopai/contracts/product-alerts';
import {
  productDetailRequestSchema,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import {
  savedProductResponseSchema,
  savedProductsResponseSchema,
  saveProductRequestSchema,
  unsaveProductRequestSchema,
  unsaveProductResponseSchema,
} from '@shopai/contracts/saved-products';
import {
  searchProductsRequestSchema,
  searchProductsResponseSchema,
} from '@shopai/contracts/search-products';
import type { ShopperIdentity } from '@shopai/db';
import type { ProductAlertsApi } from './routes/product-alerts.js';
import type { SavedProductsApi } from './routes/saved-products.js';
import type { Services } from './services.js';

export const SHOPAI_WIDGET_URI = 'ui://widget/shopai-shopping-v2.html';
export const SHOPAI_WIDGET_ASSET_VERSION = '2';

export type WidgetConfig = {
  origin: string;
  resourceDomains: string[];
  redirectOrigin: string;
};

export type McpShopperContext = {
  savedProducts: SavedProductsApi;
  productAlerts: ProductAlertsApi;
  identity: ShopperIdentity;
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
    redirectOrigin: 'http://127.0.0.1:4000',
  },
  shopper?: McpShopperContext,
) {
  const server = new McpServer(
    { name: 'shopai', version: '0.5.0' },
    {
      instructions:
        'Ürün keşfi isteklerinde search_products kullanın. category, price, size ve color gibi desteklenen filtreleri canonical alanlara taşıyın; attributes içinde yalnız size/sizes ve color/colors kullanın. Fit/oversized/sleeve gibi henüz structured public-search filtresi olmayan nitelikleri query metninde koruyun, unsupported attribute üretmeyin. Uyumlu ChatGPT yüzeyinde structuredContent CATEGORY_SELECT → PRODUCT_GRID → PRODUCT_DETAIL visual-shopping widget akışında gösterilir; widget yoksa tool metnindeki yayımlanmış katalog bilgisini kullanıcıya sunun. Kullanıcı bir ürünü daha sonra bulmak için kaydetmek isterse save_product, kaydettiklerini görmek isterse list_saved_products, kayıttan çıkarmak isterse unsave_product kullanın. Kullanıcı fiyat düşünce veya seçili varyant tekrar stokta olduğunda e-posta ile haber verilmesini isterse create_product_alert kullanın. Bildirim teslimatı ShopAI worker/email kanalıyla yapılır; ChatGPT notification mekanizmasına bağlı değildir.',
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
              'ShopAI visual shopping: kategori seçimi, ürün görsel kartları, hızlı renk/beden/fiyat chip filtreleri, kaydetme, fiyat/stok e-posta alertleri ve varyant/stok kontrollü ürün detayı.',
            'openai/widgetPrefersBorder': true,
            'openai/widgetDomain': widget.origin,
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: resourceDomains,
              redirect_domains: [widget.redirectOrigin],
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

  if (shopper) {
    server.registerTool(
      'save_product',
      {
        title: 'Ürünü kaydet',
        description:
          'Kullanıcının daha sonra bulmak istediği ShopAI ürününü, varsa seçili varyantıyla birlikte kendi alışveriş profiline kaydeder. Aynı ürün/varyant tekrar kaydedilirse duplicate oluşturmaz.',
        inputSchema: saveProductRequestSchema.shape,
        outputSchema: savedProductResponseSchema.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: SHOPAI_WIDGET_URI, visibility: ['model', 'app'] },
          'openai/outputTemplate': SHOPAI_WIDGET_URI,
          'openai/widgetAccessible': true,
          'openai/toolInvocation/invoking': 'Ürün kaydediliyor…',
          'openai/toolInvocation/invoked': 'Ürün kaydedildi',
          'shopai/dtoVersion': 1,
        },
      },
      async (input) => {
        const item = await shopper.savedProducts.save(shopper.identity, input);
        const structuredContent = savedProductResponseSchema.parse({ item });
        return {
          content: [
            {
              type: 'text' as const,
              text: `${item.product?.title ?? item.productId} kaydedildi.`,
            },
          ],
          structuredContent,
        };
      },
    );

    server.registerTool(
      'unsave_product',
      {
        title: 'Ürünü kayıttan çıkar',
        description:
          'Kullanıcının kendi alışveriş profilindeki savedId ile eşleşen kaydı kaldırır. Aynı kayıt zaten kaldırılmışsa güvenli biçimde removed=false döndürür.',
        inputSchema: unsaveProductRequestSchema.shape,
        outputSchema: unsaveProductResponseSchema.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: SHOPAI_WIDGET_URI, visibility: ['model', 'app'] },
          'openai/outputTemplate': SHOPAI_WIDGET_URI,
          'openai/widgetAccessible': true,
          'openai/toolInvocation/invoking': 'Ürün kayıttan çıkarılıyor…',
          'openai/toolInvocation/invoked': 'Ürün kayıttan çıkarıldı',
          'shopai/dtoVersion': 1,
        },
      },
      async (input) => {
        const saved = (await shopper.savedProducts.list(shopper.identity)).find(
          (item) => item.id === input.savedId,
        );
        const result = saved
          ? await shopper.savedProducts.remove(shopper.identity, {
              productId: saved.productId,
              ...(saved.variantId ? { variantId: saved.variantId } : {}),
            })
          : { removed: false };
        const structuredContent = unsaveProductResponseSchema.parse(result);
        return {
          content: [
            {
              type: 'text' as const,
              text: result.removed
                ? 'Ürün kayıttan çıkarıldı.'
                : 'Ürün zaten kayıtlı değildi.',
            },
          ],
          structuredContent,
        };
      },
    );

    server.registerTool(
      'list_saved_products',
      {
        title: 'Kaydedilen ürünler',
        description:
          'Kullanıcının daha önce kaydettiği ShopAI ürünlerini listeler. Artık yayında olmayan ürünlerin kayıt geçmişini de korur ve available=false olarak döndürür.',
        inputSchema: {},
        outputSchema: savedProductsResponseSchema.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: SHOPAI_WIDGET_URI, visibility: ['model', 'app'] },
          'openai/outputTemplate': SHOPAI_WIDGET_URI,
          'openai/widgetAccessible': true,
          'openai/toolInvocation/invoking': 'Kaydedilenler yükleniyor…',
          'openai/toolInvocation/invoked': 'Kaydedilenler hazır',
          'shopai/dtoVersion': 1,
        },
      },
      async () => {
        const items = await shopper.savedProducts.list(shopper.identity);
        const structuredContent = savedProductsResponseSchema.parse({ items });
        return {
          content: [
            {
              type: 'text' as const,
              text: items.length
                ? items
                    .map(
                      (item) =>
                        `- ${item.product?.title ?? item.productId}${item.available ? '' : ' (artık kullanılamıyor)'}`,
                    )
                    .join('\n')
                : 'Henüz kaydedilmiş ürün yok.',
            },
          ],
          structuredContent,
        };
      },
    );

    server.registerTool(
      'create_product_alert',
      {
        title: 'Fiyat / stok alarmı oluştur',
        description:
          'Bir ürünün fiyatı belirlenen kuruş değerinin altına düştüğünde veya seçili varyant yeniden stokta olduğunda ShopAI tarafından e-posta ile tek seferlik haber verilmesi için alert oluşturur. PRICE_BELOW için targetValue, BACK_IN_STOCK için variantId gerekir.',
        inputSchema: createProductAlertRequestSchema.shape,
        outputSchema: productAlertResponseSchema.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: SHOPAI_WIDGET_URI, visibility: ['model', 'app'] },
          'openai/outputTemplate': SHOPAI_WIDGET_URI,
          'openai/widgetAccessible': true,
          'openai/toolInvocation/invoking': 'Alert oluşturuluyor…',
          'openai/toolInvocation/invoked': 'Alert oluşturuldu',
          'shopai/dtoVersion': 1,
        },
      },
      async (input) => {
        const alert = await shopper.productAlerts.create(
          shopper.identity,
          input,
        );
        const structuredContent = productAlertResponseSchema.parse({ alert });
        return {
          content: [
            {
              type: 'text' as const,
              text:
                alert.conditionType === 'PRICE_BELOW'
                  ? `Fiyat ${(alert.targetValue ?? 0) / 100} TL altına düştüğünde ${alert.email} adresine haber verilecek.`
                  : `Seçili varyant tekrar stokta olduğunda ${alert.email} adresine haber verilecek.`,
            },
          ],
          structuredContent,
        };
      },
    );

    server.registerTool(
      'list_product_alerts',
      {
        title: 'Ürün alarmlarını listele',
        description:
          'Kullanıcının fiyat ve stok alarmlarını ACTIVE, TRIGGERED ve CANCELLED durumlarıyla listeler.',
        inputSchema: {},
        outputSchema: productAlertsResponseSchema.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async () => {
        const alerts = await shopper.productAlerts.list(shopper.identity);
        const structuredContent = productAlertsResponseSchema.parse({ alerts });
        return {
          content: [
            {
              type: 'text' as const,
              text: alerts.length
                ? alerts
                    .map(
                      (alert) =>
                        `- ${alert.conditionType} / ${alert.status} / ${alert.productId}`,
                    )
                    .join('\n')
                : 'Aktif veya geçmiş ürün alarmı yok.',
            },
          ],
          structuredContent,
        };
      },
    );

    server.registerTool(
      'cancel_product_alert',
      {
        title: 'Ürün alarmını kapat',
        description: 'Kullanıcının kendi ACTIVE ürün alarmını iptal eder.',
        inputSchema: productAlertIdParamsSchema.shape,
        outputSchema: cancelProductAlertResponseSchema.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        const result = await shopper.productAlerts.cancel(
          shopper.identity,
          input.alertId,
        );
        const structuredContent = cancelProductAlertResponseSchema.parse(result);
        return {
          content: [
            {
              type: 'text' as const,
              text: result.cancelled
                ? 'Ürün alarmı kapatıldı.'
                : 'Aktif alarm bulunamadı.',
            },
          ],
          structuredContent,
        };
      },
    );
  }

  return server;
}
