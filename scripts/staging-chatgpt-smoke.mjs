const apiOrigin = requiredOrigin('STAGING_API_ORIGIN');
const widgetOrigin = requiredOrigin('STAGING_WIDGET_ORIGIN');
const expectedRelease = process.env.RELEASE_VERSION;
const mcpUrl = `${apiOrigin}/mcp`;
const chatgptOrigin = 'https://chatgpt.com';
let rpcId = 0;

function requiredOrigin(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} gerekli`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value)
    throw new Error(`${name} origin-only HTTPS URL olmalıdır`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rpc(method, params) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      origin: chatgptOrigin,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  assert(response.ok, `${method} HTTP ${response.status}`);
  assert(
    response.headers.get('access-control-allow-origin') === chatgptOrigin,
    `${method} ChatGPT CORS allowlist doğrulaması başarısız`,
  );
  const body = await response.json();
  if (body.error)
    throw new Error(`${method} MCP error: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function fetchAsset(path, expectedType) {
  const response = await fetch(`${widgetOrigin}${path}`);
  assert(response.ok, `${path} HTTP ${response.status}`);
  assert(
    response.headers.get('content-type')?.startsWith(expectedType),
    `${path} content-type yanlış`,
  );
  assert(
    response.headers.get('access-control-allow-origin') === '*',
    `${path} cross-origin widget asset olarak servis edilmiyor`,
  );
  assert(
    response.headers.get('cross-origin-resource-policy') === 'cross-origin',
    `${path} CORP header eksik`,
  );
  const body = await response.text();
  assert(body.length > 0, `${path} boş`);
}

const readiness = await fetch(`${apiOrigin}/health/ready`);
assert(readiness.ok, `API readiness HTTP ${readiness.status}`);
const readinessBody = await readiness.json();
assert(readinessBody.status === 'ok', 'API readiness status ok değil');
if (expectedRelease)
  assert(
    readinessBody.release === expectedRelease,
    `release mismatch: ${readinessBody.release} != ${expectedRelease}`,
  );

const preflight = await fetch(mcpUrl, {
  method: 'OPTIONS',
  headers: {
    origin: chatgptOrigin,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  },
});
assert(preflight.ok, `MCP CORS preflight HTTP ${preflight.status}`);
assert(
  preflight.headers.get('access-control-allow-origin') === chatgptOrigin,
  'ChatGPT origin MCP CORS allowlist içinde değil',
);

const tools = await rpc('tools/list');
const searchTool = tools.tools?.find((tool) => tool.name === 'search_products');
const detailTool = tools.tools?.find(
  (tool) => tool.name === 'get_product_detail',
);
assert(searchTool, 'search_products tool bulunamadı');
assert(detailTool, 'get_product_detail tool bulunamadı');

const resourceUri = searchTool._meta?.ui?.resourceUri;
assert(
  typeof resourceUri === 'string',
  'search_products UI resource URI eksik',
);
assert(
  detailTool._meta?.ui?.resourceUri === resourceUri,
  'search/detail aynı widget resource sürümünü kullanmıyor',
);

const resourceResult = await rpc('resources/read', { uri: resourceUri });
const resource = resourceResult.contents?.[0];
assert(
  resource?.mimeType === 'text/html;profile=mcp-app',
  'widget MIME type yanlış',
);
assert(
  resource._meta?.['openai/widgetDomain'] === widgetOrigin,
  'widgetDomain staging widget origin ile eşleşmiyor',
);
const csp = resource._meta?.['openai/widgetCSP'];
assert(
  csp?.resource_domains?.includes(widgetOrigin),
  'widget origin CSP resource_domains içinde değil',
);
assert(
  csp?.redirect_domains?.includes(apiOrigin),
  'ShopAI API origin CSP redirect_domains içinde değil',
);
assert(
  resource.text?.includes(`${widgetOrigin}/assets/widget-v3.js`),
  'hosted widget JS URL resource HTML içinde yok',
);
assert(
  resource.text?.includes(`${widgetOrigin}/assets/widget-v3.css`),
  'hosted widget CSS URL resource HTML içinde yok',
);

await Promise.all([
  fetchAsset('/assets/widget-v3.js', 'application/javascript'),
  fetchAsset('/assets/widget-v3.css', 'text/css'),
]);

const searchResult = await rpc('tools/call', {
  name: 'search_products',
  arguments: { limit: 1 },
});
const search = searchResult.structuredContent;
assert(typeof search?.searchId === 'string', 'searchId dönmedi');
assert(
  search?.products?.length > 0,
  'staging katalogda kabul testi için yayımlanmış ürün yok',
);
const product = search.products[0];

const detailResult = await rpc('tools/call', {
  name: 'get_product_detail',
  arguments: { productId: product.productId, searchId: search.searchId },
});
const detail = detailResult.structuredContent;
assert(
  detail?.product?.id === product.productId,
  'product detail yanlış ürünü döndürdü',
);
assert(Array.isArray(detail?.variants), 'product detail variants eksik');

const checkoutUrl = detail?.offers?.find(
  (offer) => offer.checkoutAvailable && typeof offer.checkoutUrl === 'string',
)?.checkoutUrl;
assert(checkoutUrl, 'staging kabul testi için satın alınabilir teklif yok');
assert(
  checkoutUrl.startsWith(`${apiOrigin}/r/`),
  'checkout URL signed ShopAI /r/... origininden gelmiyor',
);

const checkout = await fetch(checkoutUrl, {
  redirect: 'manual',
  headers: { 'user-agent': 'ShopAI-staging-smoke/1.0' },
});
assert(
  [301, 302, 303, 307, 308].includes(checkout.status),
  `signed checkout redirect HTTP ${checkout.status}`,
);
const location = checkout.headers.get('location');
assert(location, 'signed checkout redirect Location header dönmedi');
assert(
  ['http:', 'https:'].includes(new URL(location).protocol),
  'checkout hedefi HTTP(S) değil',
);

console.log(
  JSON.stringify(
    {
      status: 'ok',
      release: readinessBody.release,
      mcpUrl,
      resourceUri,
      productId: product.productId,
      searchTool: true,
      widgetAssets: true,
      productDetail: true,
      signedExternalCheckout: true,
    },
    null,
    2,
  ),
);
