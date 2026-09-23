const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/** Attach the server-issued, session-bound CSRF token only to our own API.
 * Legacy pilot sessions have no CSRF token; their existing behavior is retained
 * until the explicit operator-controlled cutover. */
export async function authenticatedFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    return fetch(input, init);
  const target = new URL(String(input));
  if (target.origin !== new URL(api).origin)
    throw new Error('AUTHENTICATED_FETCH_ORIGIN_MISMATCH');
  const session = await fetch(`${api}/v1/auth/session`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!session.ok) throw new Error('SESSION_EXPIRED');
  const data = (await session.json()) as { csrfToken?: unknown };
  const headers = new Headers(init.headers);
  if (typeof data.csrfToken === 'string' && data.csrfToken)
    headers.set('x-shopai-csrf', data.csrfToken);
  return fetch(target, { ...init, credentials: 'include', headers });
}
