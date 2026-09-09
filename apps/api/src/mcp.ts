import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  searchFiltersSchema,
  searchRequestSchema,
  searchResponseSchema,
} from '@shopai/contracts';
import type { Services } from './services.js';

export const SHOPAI_WIDGET_URI = 'ui://widget/shopai-products-v1.html';
export const SHOPAI_WIDGET_ASSET_VERSION = '1';

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
    <title>ShopAI ürün sonuçları</title>
  </head>
  <body>
    <div id="root" data-dto-version="1"></div>
    <script type="module" src="${assetUrl}"></script>
  </body>
</html>`;
}

function textResult(
  result: Awaited<ReturnType<Services['search']['execute']>>,
) {
  if (!result.items.length)
    return `ShopAI araması (${result.searchId}): Sonuç bulunamadı. Filtreler otomatik olarak gevşetilmedi.`;
  const products = result.items
    .map(
      (item) =>
        `- ${item.title} — ${item.size} beden, ${item.color}, ${(item.priceMinor / 100).toFixed(2)} ${item.currency}; ${item.stockStatus}; ${item.checkoutUrl}`,
    )
    .join('\n');
  return `ShopAI araması (${result.searchId}) ${result.items.length} yayımlanmış sonuç döndürdü:\n${products}`;
}

export function createMcpServer(
  services: Services,
  widget: WidgetConfig = {
    origin: 'http://127.0.0.1:3001',
    resourceDomains: ['https://example.com'],
  },
) {
  const server = new McpServer(
    { name: 'shopai', version: '0.2.0' },
    {
      instructions:
        'Yalnız yayımlanmış public katalog verisini arayın. Widget kullanılamasa bile tool metnindeki ürün bilgilerini kullanıcıya sunun.',
    },
  );
  const resourceDomains = [
    ...new Set([widget.origin, ...widget.resourceDomains]),
  ];
  server.registerResource(
    'shopai-products-widget',
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
              'ShopAI yayımlanmış ürün sonuçlarını görsel kartlarla ve beden filtresiyle gösterir.',
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
        'Yayımlanmış katalogda ürün adı/açıklaması ile fiyat, kategori, beden, renk ve güncel stok filtrelerini birlikte uygular.',
      inputSchema: {
        ...searchRequestSchema.partial().shape,
        filters: searchFiltersSchema.partial().optional(),
      },
      outputSchema: searchResponseSchema.shape,
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
        'openai/toolInvocation/invoked': 'Ürünler hazır',
        'shopai/dtoVersion': 1,
      },
    },
    async (input) => {
      const result = await services.executeSearch(input, {}, 'mcp');
      const linkedResult = {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          checkoutUrl: services.redirects.createLink({
            offerId: item.offerId,
            searchId: result.searchId,
            channel: 'chatgpt',
          }),
        })),
      };
      return {
        content: [{ type: 'text' as const, text: textResult(linkedResult) }],
        structuredContent: linkedResult,
      };
    },
  );
  return server;
}
