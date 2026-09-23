import { describe, expect, it } from 'vitest';
import { parseApiEnv } from '../apps/api/src/env.js';
import { parseWorkerEnv } from '../apps/worker/src/env.js';

const connectorEncryptionKey = Buffer.alloc(32, 7).toString('base64');
const opsAlertWebhookUrl = 'https://alerts.shopai.example/events';
const opsAlertWebhookSecret = 'ops-alert-production-secret-000000000000';
const hostedStagingEnv = {
  DEPLOY_ENV: 'staging',
  RELEASE_VERSION: 'abcdef123',
  CATALOG_MODE: 'postgres',
  DATABASE_URL: 'postgresql://shopai:local@db.example/shopai',
  MCP_PUBLIC_ORIGIN: 'https://api.staging.shopai.example',
  WIDGET_ORIGIN: 'https://widget.staging.shopai.example',
  MCP_ALLOWED_ORIGINS: 'https://chatgpt.com,https://chat.openai.com',
  WIDGET_RESOURCE_DOMAINS:
    'https://widget.staging.shopai.example,https://images.staging.shopai.example',
  REDIRECT_SIGNING_SECRET: 'staging-redirect-signing-secret-000000000000',
  AUTH_PILOT_CREDENTIALS:
    '{"pilot@shopai.example":"staging-pilot-credential-0001"}',
  CONNECTOR_SECRET_ENCRYPTION_KEY: connectorEncryptionKey,
} as const;
const hostedProductionEnv = {
  ...hostedStagingEnv,
  DEPLOY_ENV: 'production',
  RELEASE_VERSION: '0123456789abcdef0123456789abcdef01234567',
  MCP_PUBLIC_ORIGIN: 'https://api.shopai.example',
  WIDGET_ORIGIN: 'https://widget.shopai.example',
  OPS_ALERT_WEBHOOK_URL: opsAlertWebhookUrl,
  OPS_ALERT_WEBHOOK_SECRET: opsAlertWebhookSecret,
} as const;

describe('startup environment validation', () => {
  it('defaults the API to credential-free demo mode', () => {
    expect(parseApiEnv({}).CATALOG_MODE).toBe('demo');
    expect(parseApiEnv({}).BETTER_AUTH_ENABLED).toBe('false');
  });

  it('requires independent Better Auth and mail secrets when enabled', () => {
    expect(() =>
      parseApiEnv({ ...hostedStagingEnv, BETTER_AUTH_ENABLED: 'true' }),
    ).toThrow(/BETTER_AUTH_SECRET.*AUTH_EMAIL_FROM.*RESEND_API_KEY/);
    expect(
      parseApiEnv({
        ...hostedStagingEnv,
        BETTER_AUTH_ENABLED: 'true',
        BETTER_AUTH_SECRET: 'test-only-independent-auth-secret-123456',
        AUTH_EMAIL_FROM: 'auth@shopai.example',
        RESEND_API_KEY: 'test-resend-key',
      }).BETTER_AUTH_ENABLED,
    ).toBe('true');
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

  it('accepts production-style ChatGPT staging origins', () => {
    expect(parseApiEnv(hostedStagingEnv)).toMatchObject({
      DEPLOY_ENV: 'staging',
      MCP_PUBLIC_ORIGIN: 'https://api.staging.shopai.example',
      WIDGET_ORIGIN: 'https://widget.staging.shopai.example',
      CONNECTOR_SECRET_ENCRYPTION_KEY: connectorEncryptionKey,
    });
  });

  it('requires connector secret encryption in hosted API and worker runtimes', () => {
    const { CONNECTOR_SECRET_ENCRYPTION_KEY: _ignored, ...withoutKey } =
      hostedStagingEnv;
    expect(() => parseApiEnv(withoutKey)).toThrow(
      /CONNECTOR_SECRET_ENCRYPTION_KEY|encryption key/,
    );
    expect(() =>
      parseWorkerEnv({
        DEPLOY_ENV: 'staging',
        RELEASE_VERSION: 'abcdef123',
        DATABASE_URL: hostedStagingEnv.DATABASE_URL,
        REDIS_URL: 'rediss://redis.example',
      }),
    ).toThrow(/CONNECTOR_SECRET_ENCRYPTION_KEY|encryption key/);
    expect(
      parseWorkerEnv({
        DEPLOY_ENV: 'staging',
        RELEASE_VERSION: 'abcdef123',
        DATABASE_URL: hostedStagingEnv.DATABASE_URL,
        REDIS_URL: 'rediss://redis.example',
        CONNECTOR_SECRET_ENCRYPTION_KEY: connectorEncryptionKey,
      }).CONNECTOR_SECRET_ENCRYPTION_KEY,
    ).toBe(connectorEncryptionKey);
  });

  it('requires an external signed operations alert sink in production', () => {
    const {
      OPS_ALERT_WEBHOOK_URL: _url,
      OPS_ALERT_WEBHOOK_SECRET: _secret,
      ...withoutOpsSink
    } = hostedProductionEnv;
    expect(() => parseApiEnv(withoutOpsSink)).toThrow(
      /operation alert sink|OPS_ALERT_WEBHOOK_URL/,
    );
    expect(() =>
      parseWorkerEnv({
        DEPLOY_ENV: 'production',
        RELEASE_VERSION: hostedProductionEnv.RELEASE_VERSION,
        DATABASE_URL: hostedProductionEnv.DATABASE_URL,
        REDIS_URL: 'rediss://redis.example',
        CONNECTOR_SECRET_ENCRYPTION_KEY: connectorEncryptionKey,
      }),
    ).toThrow(/operation alert sink|OPS_ALERT_WEBHOOK_URL/);
  });

  it('accepts matching production operations alert configuration', () => {
    expect(parseApiEnv(hostedProductionEnv)).toMatchObject({
      OPS_ALERT_WEBHOOK_URL: opsAlertWebhookUrl,
      OPS_ALERT_WEBHOOK_SECRET: opsAlertWebhookSecret,
    });
    expect(
      parseWorkerEnv({
        DEPLOY_ENV: 'production',
        RELEASE_VERSION: hostedProductionEnv.RELEASE_VERSION,
        DATABASE_URL: hostedProductionEnv.DATABASE_URL,
        REDIS_URL: 'rediss://redis.example',
        CONNECTOR_SECRET_ENCRYPTION_KEY: connectorEncryptionKey,
        OPS_ALERT_WEBHOOK_URL: opsAlertWebhookUrl,
        OPS_ALERT_WEBHOOK_SECRET: opsAlertWebhookSecret,
      }),
    ).toMatchObject({
      OPS_ALERT_WEBHOOK_URL: opsAlertWebhookUrl,
      OPS_ALERT_WEBHOOK_SECRET: opsAlertWebhookSecret,
    });
  });

  it('rejects partial or unsafe operations alert configuration', () => {
    expect(() =>
      parseApiEnv({
        ...hostedStagingEnv,
        OPS_ALERT_WEBHOOK_URL: 'http://alerts.shopai.example/events',
        OPS_ALERT_WEBHOOK_SECRET: opsAlertWebhookSecret,
      }),
    ).toThrow(/HTTPS URL/);
    expect(() =>
      parseApiEnv({
        ...hostedStagingEnv,
        OPS_ALERT_WEBHOOK_URL: opsAlertWebhookUrl,
      }),
    ).toThrow(/birlikte ayarlanmalıdır/);
  });

  it('rejects malformed connector encryption keys', () => {
    expect(() =>
      parseApiEnv({
        ...hostedStagingEnv,
        CONNECTOR_SECRET_ENCRYPTION_KEY: 'not-a-32-byte-key',
      }),
    ).toThrow(/32-byte key/);
  });

  it('rejects pathful hosted origins', () => {
    expect(() =>
      parseApiEnv({
        ...hostedStagingEnv,
        MCP_PUBLIC_ORIGIN: 'https://api.staging.shopai.example/mcp',
      }),
    ).toThrow(/origin-only/);
  });

  it('requires the ChatGPT origin in hosted MCP allowlists', () => {
    expect(() =>
      parseApiEnv({
        ...hostedStagingEnv,
        MCP_ALLOWED_ORIGINS: 'https://chat.openai.com',
      }),
    ).toThrow(/chatgpt\.com/);
  });

  it('rejects non-HTTPS hosted widget resource domains', () => {
    expect(() =>
      parseApiEnv({
        ...hostedStagingEnv,
        WIDGET_RESOURCE_DOMAINS: 'http://images.staging.shopai.example',
      }),
    ).toThrow(/origin-only HTTPS/);
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
