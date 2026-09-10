import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type ConnectorDnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: ConnectorDnsLookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function assertPublicConnectorTarget(
  value: string,
  lookup: ConnectorDnsLookup = defaultLookup,
) {
  const url = new URL(value);
  if (url.protocol !== 'https:')
    throw new Error('Connector hedefi HTTPS olmalıdır.');
  const hostname = url.hostname.toLowerCase();
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
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address)))
    throw new Error('Connector hedefi public bir adres olmalıdır.');
}

function isPublicIp(address: string) {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
    return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
