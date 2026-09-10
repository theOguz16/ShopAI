import { describe, expect, it, vi } from 'vitest';
import {
  createHostBridge,
  type HostWindow,
} from '../apps/chatgpt-widget/src/host-bridge.js';
import { DemoQueryParser } from '../packages/ai/src/index.js';
import {
  demoRecords,
  MemoryCatalogRepository,
  SearchProducts,
} from '../packages/commerce/src/index.js';
import {
  parseSearchProductsRequest,
  toInternalSearchInput,
  toSearchProductsResponse,
} from '../packages/commerce/src/public-search.js';

type Rpc = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
};

type FakeHost = HostWindow & {
  sent: Rpc[];
  listeners: Set<(event: MessageEvent<Rpc>) => void>;
  receive(message: Rpc): void;
};

function fakeHost(onPost: (message: Rpc, host: FakeHost) => void): FakeHost {
  const listeners = new Set<(event: MessageEvent<Rpc>) => void>();
  const sent: Rpc[] = [];
  const parent = {
    postMessage(message: Rpc) {
      sent.push(message);
      onPost(message, host);
    },
  };
  const host: FakeHost = {
    parent,
    sent,
    listeners,
    addEventListener(
      _type: 'message',
      listener: (event: MessageEvent<Rpc>) => void,
    ) {
      listeners.add(listener);
    },
    removeEventListener(
      _type: 'message',
      listener: (event: MessageEvent<Rpc>) => void,
    ) {
      listeners.delete(listener);
    },
    receive(message: Rpc) {
      for (const listener of listeners)
        listener({ source: parent, data: message } as MessageEvent<Rpc>);
    },
  };
  return host;
}

const search = new SearchProducts(
  new MemoryCatalogRepository(demoRecords),
  new DemoQueryParser(),
  'demo',
);

async function publicSearch(input: unknown) {
  const request = parseSearchProductsRequest(input);
  return toSearchProductsResponse(
    await search.execute(toInternalSearchInput(request)),
  );
}

describe('ChatGPT widget host bridge', () => {
  it('completes UI lifecycle before tools/call and uses canonical arguments', async () => {
    const host = fakeHost((message, current) => {
      if (message.method === 'ui/initialize')
        queueMicrotask(() =>
          current.receive({ jsonrpc: '2.0', id: message.id, result: {} }),
        );
      if (message.method === 'tools/call')
        queueMicrotask(async () => {
          const params = message.params as { arguments: unknown };
          current.receive({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              structuredContent: await publicSearch(params.arguments),
            },
          });
        });
    });
    const bridge = createHostBridge({ hostWindow: host, timeoutMs: 1000 });

    await expect(
      bridge.callSearch({ attributes: { size: ['M'] } }),
    ).resolves.toMatchObject({ products: expect.any(Array) });
    expect(host.sent.map((message) => message.method)).toEqual([
      'ui/initialize',
      'ui/notifications/initialized',
      'tools/call',
    ]);
    expect(host.sent[2]?.params).toMatchObject({
      name: 'search_products',
      arguments: { attributes: { size: ['M'] } },
    });
    bridge.destroy();
  });

  it('accepts only a validated canonical arguments envelope for tool input', () => {
    const host = fakeHost(() => undefined);
    const bridge = createHostBridge({ hostWindow: host, timeoutMs: 1000 });
    const snapshots = vi.fn();
    bridge.subscribe(snapshots);

    host.receive({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: { filters: { sizes: ['S'] } },
    });
    expect(bridge.snapshot().input).toBeUndefined();
    host.receive({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: { arguments: { attributes: { size: ['L'] } } },
    });
    expect(bridge.snapshot().input).toEqual({
      attributes: { size: ['L'] },
    });
    expect(snapshots).toHaveBeenCalledTimes(2);
    bridge.destroy();
  });

  it('times out pending requests and removes listeners on destroy', async () => {
    vi.useFakeTimers();
    try {
      const host = fakeHost(() => undefined);
      const bridge = createHostBridge({ hostWindow: host, timeoutMs: 50 });
      const call = bridge.callSearch({ query: 'ceket' });
      const timedOut = expect(call).rejects.toThrow('ui/initialize');
      await vi.advanceTimersByTimeAsync(51);
      await timedOut;
      bridge.destroy();
      expect(host.listeners.size).toBe(0);
      await expect(bridge.callSearch({})).rejects.toThrow('kapatıldı');
    } finally {
      vi.useRealTimers();
    }
  });
});
