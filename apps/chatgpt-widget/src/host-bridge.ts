import {
  type SearchRequest,
  type SearchResponse,
  searchFiltersSchema,
  searchRequestSchema,
  searchResponseSchema,
} from '@shopai/contracts';

const UI_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 10_000;

const widgetSearchInputSchema = searchRequestSchema
  .omit({ filters: true })
  .partial()
  .extend({ filters: searchFiltersSchema.partial().optional() })
  .strict();
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

export type WidgetSearchInput = Omit<Partial<SearchRequest>, 'filters'> & {
  filters?: Partial<SearchRequest['filters']>;
};

type OpenAiHost = {
  toolInput?: WidgetSearchInput;
  toolOutput?: unknown;
  callTool?: (
    name: string,
    args: WidgetSearchInput,
  ) => Promise<{ structuredContent?: unknown }>;
};

declare global {
  interface Window {
    openai?: OpenAiHost;
  }
}

export type HostWindow = {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  openai?: OpenAiHost;
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
  callSearch(input: WidgetSearchInput): Promise<SearchResponse>;
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
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (request) clearTimeout(request.timeout);
      if (message.error)
        request?.reject(new Error(message.error.message ?? 'Host tool hatası'));
      else request?.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-input') {
      if (!record(message.params) || !('arguments' in message.params)) return;
      const arguments_ = widgetSearchInputSchema.safeParse(
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
  // The widget may render an error state without ever issuing a tool call.
  // Keep the rejection observable to callSearch while preventing a global
  // unhandled rejection in that no-call path.
  void initialized.catch(() => undefined);

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
      const arguments_ = widgetSearchInputSchema.parse(input);
      const result = framed
        ? ((await initialized.then(() =>
            request('tools/call', {
              name: 'search_products',
              arguments: arguments_,
            }),
          )) as { structuredContent?: unknown })
        : await hostWindow.openai?.callTool?.('search_products', arguments_);
      if (!result) throw new Error('Uyumlu MCP Apps host köprüsü bulunamadı.');
      return searchResponseSchema.parse(result.structuredContent);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hostWindow.removeEventListener('message', onMessage);
      listeners.clear();
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('Host köprüsü kapatıldı.'));
      }
      pending.clear();
    },
  };
}
