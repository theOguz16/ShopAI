import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../apps/api/src/env.js';
import { parseWorkerEnv } from '../apps/worker/src/env.js';

describe('startup environment validation', () => {
  it('defaults the API to credential-free demo mode', () => {
    expect(parseApiEnv({}).CATALOG_MODE).toBe('demo');
  });

  it('forbids demo mode outside a local environment', () => {
    expect(() =>
      parseApiEnv({
        DEPLOY_ENV: 'staging',
        RELEASE_VERSION: 'abcdef123',
        CATALOG_MODE: 'demo',
      }),
    ).toThrow(/demo modu yalnız/);
  });

  it('forbids the local pilot credential outside local', () => {
    expect(() =>
      parseApiEnv({
        DEPLOY_ENV: 'staging',
        RELEASE_VERSION: 'abcdef123',
        CATALOG_MODE: 'demo',
      }),
    ).toThrow(/AUTH_PILOT_CREDENTIALS|kimlik secretı/);
  });

  it('rejects malformed email-bound pilot credentials without echoing them', () => {
    expect(() =>
      parseApiEnv({ AUTH_PILOT_CREDENTIALS: '{not-json-secret}' }),
    ).toThrow(/eşlemesi geçersiz/);
  });

  it('requires an immutable worker release outside local', () => {
    expect(() =>
      parseWorkerEnv({
        DEPLOY_ENV: 'staging',
        DATABASE_URL: 'postgresql://shopai:test@db.example/shopai',
        REDIS_URL: 'rediss://redis.example',
      }),
    ).toThrow(/immutable sürüm kimliği/);
  });

  it('explains that DATABASE_URL is required in postgres mode', () => {
    expect(() => parseApiEnv({ CATALOG_MODE: 'postgres' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires database and Redis URLs for the worker', () => {
    expect(() => parseWorkerEnv({})).toThrow(/DATABASE_URL.*REDIS_URL/);
  });

  it('requires a key and explicit token rates for model mode', () => {
    expect(() => parseApiEnv({ AI_PROVIDER: 'openai' })).toThrow(
      /OPENAI_API_KEY.*AI_INPUT_USD_PER_MILLION.*AI_OUTPUT_USD_PER_MILLION/,
    );
  });

  it('requires TLS origins for postgres-hosted MCP Apps', () => {
    expect(() =>
      parseApiEnv({
        CATALOG_MODE: 'postgres',
        DATABASE_URL: 'postgresql://shopai:local@127.0.0.1:5432/shopai',
      }),
    ).toThrow(/MCP_PUBLIC_ORIGIN.*WIDGET_ORIGIN/);
  });

  it('treats an empty optional conversion secret as disabled', () => {
    expect(
      parseApiEnv({ CONVERSION_CALLBACK_SECRET: '   ' })
        .CONVERSION_CALLBACK_SECRET,
    ).toBeUndefined();
  });

  it('rejects a non-empty conversion secret shorter than 32 characters', () => {
    expect(() =>
      parseApiEnv({ CONVERSION_CALLBACK_SECRET: 'configured-but-too-short' }),
    ).toThrow(/CONVERSION_CALLBACK_SECRET/);
  });
});
