import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../env.js';

export const ANONYMOUS_USER_COOKIE = 'shopai_anonymous_user_id';
export const ANONYMOUS_USER_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function cookieValue(request: FastifyRequest, name: string) {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function attributes(request: FastifyRequest, env?: ApiEnv) {
  const secure =
    env?.DEPLOY_ENV === 'staging' ||
    env?.DEPLOY_ENV === 'production' ||
    request.protocol === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function ensureAnonymousUserId(
  request: FastifyRequest,
  reply: FastifyReply,
  env?: ApiEnv,
) {
  const existing = cookieValue(request, ANONYMOUS_USER_COOKIE);
  if (existing && uuid.test(existing)) return existing;
  const anonymousUserId = randomUUID();
  reply.header(
    'Set-Cookie',
    `${ANONYMOUS_USER_COOKIE}=${anonymousUserId}; ${attributes(request, env)}; Max-Age=${ANONYMOUS_USER_MAX_AGE_SECONDS}`,
  );
  return anonymousUserId;
}
