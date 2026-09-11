import { z } from 'zod';

const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol), {
    message: 'redis:// veya rediss:// adresi olmalı',
  });

const baseSchema = z.object({
  DEPLOY_ENV: z
    .enum(['local', 'test', 'staging', 'production'])
    .default('local'),
  RELEASE_VERSION: z.string().min(7).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  AUTH_PILOT_CREDENTIALS: z
    .string()
    .default('{"pilot@shopai.local":"shopai-local-pilot-token"}')
    .transform((value, context) => {
      try {
        const parsed = JSON.parse(value) as unknown;
        const result = z
          .record(z.string().email(), z.string().min(16))
          .safeParse(parsed);
        if (result.success && Object.keys(result.data).length) {
          const normalized: Record<string, string> = {};
          for (const [email, credential] of Object.entries(result.data)) {
            const key = email.trim().toLowerCase();
            if (key in normalized)
              throw new Error('duplicate normalized email');
            normalized[key] = credential;
          }
          return normalized;
        }
      } catch {
        // A generic issue below avoids reflecting credential material.
      }
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'e-posta → pilot kodu JSON eşlemesi geçersiz',
      });
      return z.NEVER;
    }),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(30).default(5),
  UPLOAD_DIR: z.string().min(1).default('private/uploads'),
  REDIS_URL: redisUrlSchema.default('redis://127.0.0.1:6379'),
  AI_PROVIDER: z.enum(['rules', 'openai']).default('rules'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('gpt-5-mini'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2500),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(50).max(2000).default(300),
  AI_MAX_COST_USD: z.coerce.number().positive().max(1).default(0.002),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().optional(),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().optional(),
  MCP_PUBLIC_ORIGIN: z.string().url().default('http://127.0.0.1:4000'),
  MCP_ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,https://chatgpt.com,https://chat.openai.com',
    )
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  WIDGET_ORIGIN: z.string().url().default('http://127.0.0.1:3001'),
  WIDGET_RESOURCE_DOMAINS: z
    .string()
    .default('https://example.com')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  REDIRECT_SIGNING_SECRET: z
    .string()
    .min(32)
    .default('shopai-local-redirect-signing-key-change-me'),
  REDIRECT_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(900),
  CONVERSION_CALLBACK_SECRET: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(32).optional(),
  ),
});

const apiEnvSchema = z
  .discriminatedUnion('CATALOG_MODE', [
    baseSchema.extend({ CATALOG_MODE: z.literal('demo') }),
    baseSchema.extend({
      CATALOG_MODE: z.literal('postgres'),
      DATABASE_URL: z.string().url().startsWith('postgres'),
    }),
  ])
  .superRefine((env, context) => {
    if (env.DEPLOY_ENV !== 'local' && env.CATALOG_MODE === 'demo')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CATALOG_MODE'],
        message: 'demo modu yalnız DEPLOY_ENV=local ortamında kullanılabilir',
      });
    if (env.DEPLOY_ENV !== 'local' && env.RELEASE_VERSION === 'development')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RELEASE_VERSION'],
        message: 'local dışı ortamda immutable sürüm kimliği zorunludur',
      });
    if (
      env.DEPLOY_ENV !== 'local' &&
      env.AUTH_PILOT_CREDENTIALS['pilot@shopai.local'] ===
        'shopai-local-pilot-token'
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_PILOT_CREDENTIALS'],
        message: 'local dışı ortamda benzersiz kimlik secretı zorunludur',
      });
    if (env.AI_PROVIDER === 'openai') {
      for (const key of [
        'OPENAI_API_KEY',
        'AI_INPUT_USD_PER_MILLION',
        'AI_OUTPUT_USD_PER_MILLION',
      ] as const) {
        if (env[key] === undefined)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'AI_PROVIDER=openai iken zorunludur',
          });
      }
    }
    if (env.CATALOG_MODE === 'postgres') {
      for (const key of ['MCP_PUBLIC_ORIGIN', 'WIDGET_ORIGIN'] as const) {
        const url = new URL(env[key]);
        if (url.protocol !== 'https:')
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'postgres/staging modunda HTTPS olmalıdır',
          });
        if (url.origin !== env[key])
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'path/query içermeyen origin-only URL olmalıdır',
          });
      }
      if (
        env.REDIRECT_SIGNING_SECRET ===
        'shopai-local-redirect-signing-key-change-me'
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIRECT_SIGNING_SECRET'],
          message: 'postgres/staging modunda benzersiz bir secret olmalıdır',
        });
    }
    if (env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production') {
      if (!env.MCP_ALLOWED_ORIGINS.includes('https://chatgpt.com'))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MCP_ALLOWED_ORIGINS'],
          message: 'hosted ChatGPT için https://chatgpt.com allowlist içinde olmalıdır',
        });
      for (const [key, origins] of [
        ['MCP_ALLOWED_ORIGINS', env.MCP_ALLOWED_ORIGINS],
        ['WIDGET_RESOURCE_DOMAINS', env.WIDGET_RESOURCE_DOMAINS],
      ] as const) {
        for (const value of origins) {
          const url = new URL(value);
          if (url.protocol !== 'https:' || url.origin !== value)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: 'hosted ortamda yalnız origin-only HTTPS URL kullanılabilir',
            });
        }
      }
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(env: NodeJS.ProcessEnv): ApiEnv {
  const result = apiEnvSchema.safeParse({
    ...env,
    CATALOG_MODE: env.CATALOG_MODE ?? 'demo',
  });
  if (!result.success) {
    throw new Error(
      `API ortam ayarları geçersiz: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}
