import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export type ConnectorDnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export type ConnectorResolvedTarget = {
  address: string;
  family: 4 | 6;
};

export type ConnectorPinnedRequester = (
  url: URL,
  target: ConnectorResolvedTarget,
  init?: RequestInit,
) => Promise<Response>;

const defaultLookup: ConnectorDnsLookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function resolvePublicConnectorTarget(
  value: string | URL,
  lookup: ConnectorDnsLookup = defaultLookup,
): Promise<ConnectorResolvedTarget> {
  const url = typeof value === 'string' ? new URL(value) : value;
  if (url.protocol !== 'https:')
    throw new Error('Connector hedefi HTTPS olmalıdır.');
  if (url.username || url.password)
    throw new Error('Connector hedefi URL kimlik bilgisi içeremez.');

  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
    throw new Error('Connector hedefi public bir adres olmalıdır.');

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicIp(address))
  )
    throw new Error('Connector hedefi public bir adres olmalıdır.');

  const selected = addresses[0];
  if (!selected)
    throw new Error('Connector hedefi public bir adres olmalıdır.');
  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

export async function assertPublicConnectorTarget(
  value: string,
  lookup: ConnectorDnsLookup = defaultLookup,
) {
  await resolvePublicConnectorTarget(value, lookup);
}

export function createPublicConnectorFetch(
  lookup: ConnectorDnsLookup = defaultLookup,
  requester: ConnectorPinnedRequester = requestPinnedHttps,
): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input
        : input instanceof Request
          ? new URL(input.url)
          : new URL(String(input));
    const target = await resolvePublicConnectorTarget(url, lookup);
    return requester(url, target, init);
  }) as typeof fetch;
}

export function buildPinnedHttpsRequestOptions(
  url: URL,
  target: ConnectorResolvedTarget,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  if (!headers.has('host')) headers.set('host', url.host);
  return {
    protocol: 'https:' as const,
    hostname: target.address,
    port: url.port ? Number(url.port) : 443,
    path: `${url.pathname}${url.search}`,
    method: init?.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    servername: isIP(url.hostname.replace(/^\[|\]$/gu, ''))
      ? undefined
      : url.hostname,
  };
}

async function requestPinnedHttps(
  url: URL,
  target: ConnectorResolvedTarget,
  init?: RequestInit,
): Promise<Response> {
  if (init?.redirect && init.redirect !== 'manual')
    throw new Error('Connector yönlendirmeleri takip edilemez.');
  if (init?.body)
    throw new Error('Connector HTTP istemcisi yalnız gövdesiz istekleri destekler.');

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      buildPinnedHttpsRequestOptions(url, target, init),
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, String(value));
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
              statusText: response.statusMessage,
              headers,
            }),
          );
        });
      },
    );

    const abort = () => {
      request.destroy(new Error('Connector isteği iptal edildi.'));
    };
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener('abort', abort, { once: true });
    request.once('close', () =>
      init?.signal?.removeEventListener('abort', abort),
    );
    request.once('error', reject);
    request.end();
  });
}

function isPublicIp(address: string) {
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  if (normalized.includes(':')) {
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('ff')
    );
  }
  return isPublicIpv4(normalized);
}

function isPublicIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 255,
    )
  )
    return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
