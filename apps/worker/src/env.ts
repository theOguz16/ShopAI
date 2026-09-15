import { z } from 'zod';

const optionalConnectorEncryptionKeySchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z
    .string()
    .refine(
      (value) => Buffer.from(value.trim(), 'base64').length === 32,
      'base64 encoded 32-byte key olmalıdır',
    )
    .optional(),
);

const workerEnvSchema = z
  .object({
    DEPLOY_ENV: z
      .enum(['local', 'test', 'staging', 'production'])
      .default('local'),
    RELEASE_VERSION: z.string().min(7).default('development'),
    DATABASE_URL: z.string().url().startsWith('postgres'),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'redis:' || protocol === 'rediss:';
      }, 'redis:// veya rediss:// adresi olmalı'),
    CONNECTOR_SECRET_ENCRYPTION_KEY: optionalConnectorEncryptionKeySchema,
    RESEND_API_KEY: z.string().min(8).optional(),
    ALERT_FROM_EMAIL: z.string().email().optional(),
  })
  .superRefine((env, context) => {
    if (env.DEPLOY_ENV !== 'local' && env.RELEASE_VERSION === 'development')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RELEASE_VERSION'],
        message: 'local dışı ortamda immutable sürüm kimliği zorunludur',
      });
    if (
      (env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production') &&
      !env.CONNECTOR_SECRET_ENCRYPTION_KEY
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONNECTOR_SECRET_ENCRYPTION_KEY'],
        message: 'hosted ortamda connector secret encryption key zorunludur',
      });
    if (Boolean(env.RESEND_API_KEY) !== Boolean(env.ALERT_FROM_EMAIL))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message:
          'Alert email delivery için RESEND_API_KEY ve ALERT_FROM_EMAIL birlikte ayarlanmalıdır',
      });
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(env: NodeJS.ProcessEnv): WorkerEnv {
  const result = workerEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Worker ortam ayarları geçersiz: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}
