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
const optionalNonemptyString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().min(1).optional(),
);

const optionalOpsWebhookUrlSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, 'HTTPS URL olmalı ve credential/query/fragment içermemelidir')
    .optional(),
);

const optionalOpsWebhookSecretSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().min(32).optional(),
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
    CONNECTOR_SECRET_BACKEND: z.enum(['file', 'aws']).default('file'),
    CONNECTOR_SECRET_AWS_REGION: optionalNonemptyString,
    CONNECTOR_SECRET_AWS_NAMESPACE: optionalNonemptyString,
    CONNECTOR_SECRET_AWS_HEALTH_SECRET_ID: optionalNonemptyString,
    CONNECTOR_SECRET_AWS_KMS_KEY_ID: optionalNonemptyString,
    OPS_ALERT_WEBHOOK_URL: optionalOpsWebhookUrlSchema,
    OPS_ALERT_WEBHOOK_SECRET: optionalOpsWebhookSecretSchema,
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
      env.DEPLOY_ENV === 'production' &&
      env.CONNECTOR_SECRET_BACKEND !== 'aws'
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONNECTOR_SECRET_BACKEND'],
        message: 'production managed AWS secret backend gerektirir',
      });
    if (env.CONNECTOR_SECRET_BACKEND === 'aws') {
      if (
        !env.CONNECTOR_SECRET_AWS_REGION ||
        !env.CONNECTOR_SECRET_AWS_NAMESPACE ||
        !env.CONNECTOR_SECRET_AWS_HEALTH_SECRET_ID
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_AWS_REGION'],
          message: 'AWS secret provider yapılandırması eksik',
        });
      if (
        env.CONNECTOR_SECRET_AWS_REGION &&
        !/^[a-z]{2}-[a-z]+-\d$/u.test(env.CONNECTOR_SECRET_AWS_REGION)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_AWS_REGION'],
          message: 'AWS region geçersiz',
        });
      if (
        env.CONNECTOR_SECRET_AWS_NAMESPACE &&
        !/^shopai\/(staging|production|test)$/u.test(
          env.CONNECTOR_SECRET_AWS_NAMESPACE,
        )
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_AWS_NAMESPACE'],
          message: 'AWS namespace geçersiz',
        });
      if (
        env.CONNECTOR_SECRET_AWS_NAMESPACE &&
        env.CONNECTOR_SECRET_AWS_HEALTH_SECRET_ID !==
          `${env.CONNECTOR_SECRET_AWS_NAMESPACE}/health`
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_AWS_HEALTH_SECRET_ID'],
          message: 'AWS health secret namespace ile eşleşmeli',
        });
      if (
        env.DEPLOY_ENV === 'production' &&
        env.CONNECTOR_SECRET_AWS_NAMESPACE !== 'shopai/production'
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_AWS_NAMESPACE'],
          message: 'production namespace ayrı olmalıdır',
        });
      if (
        env.DEPLOY_ENV === 'staging' &&
        env.CONNECTOR_SECRET_AWS_NAMESPACE !== 'shopai/staging'
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_AWS_NAMESPACE'],
          message: 'staging namespace ayrı olmalıdır',
        });
    }
    if (
      (env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production') &&
      env.CONNECTOR_SECRET_BACKEND === 'file' &&
      !env.CONNECTOR_SECRET_ENCRYPTION_KEY
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONNECTOR_SECRET_ENCRYPTION_KEY'],
        message: 'hosted ortamda connector secret encryption key zorunludur',
      });
    if (
      Boolean(env.OPS_ALERT_WEBHOOK_URL) !==
      Boolean(env.OPS_ALERT_WEBHOOK_SECRET)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPS_ALERT_WEBHOOK_URL'],
        message: 'OPS alert webhook URL ve secret birlikte ayarlanmalıdır',
      });
    if (env.DEPLOY_ENV === 'production' && !env.OPS_ALERT_WEBHOOK_URL)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPS_ALERT_WEBHOOK_URL'],
        message: 'production ortamında harici operasyon alert sink zorunludur',
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
