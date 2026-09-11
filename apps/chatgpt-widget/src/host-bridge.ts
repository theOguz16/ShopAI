import {
  type CreateProductAlertRequest,
  type ProductAlert,
  createProductAlertRequestSchema,
  productAlertResponseSchema,
} from '@shopai/contracts/product-alerts';
import {
  type ProductDetailRequest,
  type ProductDetailResponse,
  productDetailRequestSchema,
  productDetailResponseSchema,
} from '@shopai/contracts/product-detail';
import {
  type SavedProduct,
  type SaveProductRequest,
  savedProductResponseSchema,
  saveProductRequestSchema,
} from '@shopai/contracts/saved-products';
import {
  type SearchProductsRequest,
  type SearchProductsResponse,
  searchProductsRequestSchema,
  searchProductsResponseSchema,
} from '@shopai/contracts/search-products';

const UI_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 10_000;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export type WidgetSearchInput = SearchProductsRequest;
type WidgetToolInput =
  | WidgetSearchInput
  | ProductDetailRequest
  | SaveProductRequest
  | CreateProductAlertRequest;

type OpenAiHost = {
  toolInput?: WidgetSearchInput;
  toolOutput?: unknown;
  callTool?: (
    name: string,
    args: WidgetToolInput,
  ) => Promise<{ structuredContent?: unknown }>;
  openExternal?: (input: {
    href: string;
    redirectUrl: false;
  }) => Promise<unknown> | unknown;
};

declare global {
  interface Window {
    openai?: OpenAiHost;
  }
}

export type HostWindow = {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  openai?: OpenAiHost;
  location?: { hostname: string };
  open?: (
    url?: string | URL,
    target?: string,
    features?: string,
  ) => Window | null;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<JsonRpcMessage>) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<JsonRpcMessage>) => void,
  ): void;
};

type BridgeOptions = {
  hostWindow?: HostWindow;
  timeoutMs?: number;
};

export type HostSnapshot = {
  input?: WidgetSearchInput;
  output?: unknown;
};

export type HostBridge = {
  available: boolean;
  snapshot(): HostSnapshot;
  subscribe(listener: (snapshot: HostSnapshot) => void): () => void;
  callSearch(input: WidgetSearchInput): Promise<SearchProductsResponse>;
  callProductDetail(
    input: ProductDetailRequest,
  ): Promise<ProductDetailResponse>;
  callSaveProduct(input: SaveProductRequest): Promise<SavedProduct>;
  callCreateProductAlert(input: CreateProductAlertRequest): Promise<ProductAlert>;
  openCheckout(href: string): Promise<void>;
  destroy(): void;
};

export function createHostBridge(options: BridgeOptions = {}): HostBridge {
  const hostWindow: HostWindow =
    options.hostWindow ?? (window as unknown as HostWindow);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const framed = (hostWindow.parent as unknown) !== (hostWindow as unknown);
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const listeners = new Set<(snapshot: HostSnapshot) => void>();
  let nextId = 1;
  let destroyed = false;
  let current: HostSnapshot = {
    input: hostWindow.openai?.toolInput,
    output: hostWindow.openai?.toolOutput,
  };

  const emit = () => {
    for (const listener of listeners) listener(current);
  };
  const onMessage = (event: MessageEvent<JsonRpcMessage>) => {
    if (destroyed || event.source !== hostWindow.parent) return;
    const message = event.data;
    if (message?.jsonrpc !== '2.0') return;
    if (message.id !== undefined && pending.has(message.id)) {
      const pendingRequest = pending.get(message.id);
      pending.delete(message.id);
      if (pendingRequest) clearTimeout(pendingRequest.timeout);
      if (message.error)
        pendingRequest?.reject(
          new Error(message.error.message ?? 'Host tool hatası'),
        );
      else pendingRequest?.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-input') {
      if (!record(message.params) || !('arguments' in message.params)) return;
      const arguments_ = searchProductsRequestSchema.safeParse(
        message.params.arguments,
      );
      if (!arguments_.success) return;
      current = { ...current, input: arguments_.data };
      emit();
    }
    if (message.method === 'ui/notifications/tool-result') {
      if (!record(message.params) || !('structuredContent' in message.params))
        return;
      current = { ...current, output: message.params.structuredContent };
      emit();
    }
  };
  hostWindow.addEventListener('message', onMessage, { passive: true });

  const notify = (method: string, params?: unknown) => {
    if (destroyed) return;
    hostWindow.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
  };
  const request = (method: string, params: unknown) => {
    if (destroyed) return Promise.reject(new Error('Host köprüsü kapatıldı.'));
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Host isteği zaman aşımına uğradı: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      hostWindow.parent.postMessage(
        { jsonrpc: '2.0', id, method, params },
        '*',
      );
    });
  };

  const initialized = framed
    ? request('ui/initialize', {
        protocolVersion: UI_PROTOCOL_VERSION,
        appInfo: { name: 'shopai-widget', version: '1.0.0' },
        appCapabilities: {},
      }).then(() => notify('ui/notifications/initialized'))
    : Promise.resolve();
  void initialized.catch(() => undefined);

  async function callTool(name: string, args: WidgetToolInput) {
    const result = framed
      ? ((await initialized.then(() =>
          request('tools/call', {
            name,
            arguments: args,
          }),
        )) as { structuredContent?: unknown })
      : await hostWindow.openai?.callTool?.(name, args);
    if (!result) throw new Error('Uyumlu MCP Apps host köprüsü bulunamadı.');
    return result.structuredContent;
  }

  return {
    available: framed || Boolean(hostWindow.openai?.callTool),
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    async callSearch(input) {
      if (destroyed) throw new Error('Host köprüsü kapatıldı.');
      const arguments_ = searchProductsRequestSchema.parse(input);
      return searchProductsResponseSchema.parse(
        await callTool('search_products', arguments_),
      );
    },
    async callProductDetail(input) {
      if (destroyed) throw new Error('Host köprüsü kapatıldı.');
      const arguments_ = productDetailRequestSchema.parse(input);
      return productDetailResponseSchema.parse(
        await callTool('get_product_detail', arguments_),
      );
    },
    async callSaveProduct(input) {
      if (destroyed) throw new Error('Host köprüsü kapatıldı.');
      const arguments_ = saveProductRequestSchema.parse(input);
      return savedProductResponseSchema.parse(
        await callTool('save_product', arguments_),
      ).item;
    },
    async callCreateProductAlert(input) {
      if (destroyed) throw new Error('Host köprüsü kapatıldı.');
      const arguments_ = createProductAlertRequestSchema.parse(input);
      return productAlertResponseSchema.parse(
        await callTool('create_product_alert', arguments_),
      ).alert;
    },
    async openCheckout(href) {
      if (destroyed) throw new Error('Host köprüsü kapatıldı.');
      if (hostWindow.openai?.openExternal) {
        await hostWindow.openai.openExternal({ href, redirectUrl: false });
        return;
      }
      if (
        hostWindow.location &&
        ['127.0.0.1', 'localhost'].includes(hostWindow.location.hostname) &&
        hostWindow.open
      ) {
        hostWindow.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      throw new Error('ChatGPT external navigation kullanılamıyor.');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hostWindow.removeEventListener('message', onMessage);
      listeners.clear();
      for (const pendingRequest of pending.values()) {
        clearTimeout(pendingRequest.timeout);
        pendingRequest.reject(new Error('Host köprüsü kapatıldı.'));
      }
      pending.clear();
    },
  };
}
