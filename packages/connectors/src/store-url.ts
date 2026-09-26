/**
 * Canonical form used to identify a connector store. Equivalent URLs
 * (hostname case, default port, trailing slash, empty query) must normalize
 * to the same value so duplicate connections and ownership conflicts are
 * detected reliably. userinfo/fragment and non-HTTPS URLs are rejected —
 * they never describe a connectable WooCommerce store.
 */
export function normalizeConnectorStoreUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  const port = url.port === '443' ? '' : url.port;
  const path = url.pathname.replace(/\/+$/u, '');
  return `https://${host}${port ? `:${port}` : ''}${path}`;
}
