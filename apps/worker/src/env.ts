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
    CONNECTOR_SECRET_BACKEND: z.enum(['file', 'openbao']).default('file'),
    CONNECTOR_SECRET_OPENBAO_ADDRESS: optionalNonemptyString,
    CONNECTOR_SECRET_OPENBAO_MOUNT: optionalNonemptyString,
    CONNECTOR_SECRET_OPENBAO_ROLE_ID: optionalNonemptyString,
    CONNECTOR_SECRET_OPENBAO_SECRET_ID: optionalNonemptyString,
    CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE: optionalNonemptyString,
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
      (env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production') &&
      env.CONNECTOR_SECRET_BACKEND !== 'openbao'
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONNECTOR_SECRET_BACKEND'],
        message: 'hosted ortam OpenBao secret backend gerektirir',
      });
    if (env.CONNECTOR_SECRET_BACKEND === 'openbao') {
      for (const key of [
        'CONNECTOR_SECRET_OPENBAO_ADDRESS',
        'CONNECTOR_SECRET_OPENBAO_MOUNT',
        'CONNECTOR_SECRET_OPENBAO_ROLE_ID',
      ] as const)
        if (!env[key])
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'OpenBao ayarı gerekli',
          });
      if (
        !env.CONNECTOR_SECRET_OPENBAO_SECRET_ID &&
        !env.CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE'],
          message: 'OpenBao bootstrap credential gerekli',
        });
      if (
        (env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production') &&
        !env.CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_OPENBAO_SECRET_ID_FILE'],
          message: 'hosted OpenBao credential dosyası gerekli',
        });
      if (
        (env.DEPLOY_ENV === 'staging' || env.DEPLOY_ENV === 'production') &&
        env.CONNECTOR_SECRET_OPENBAO_SECRET_ID
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_OPENBAO_SECRET_ID'],
          message: 'hosted AppRole SecretID env yerine dosyada tutulmalıdır',
        });
      if (env.CONNECTOR_SECRET_OPENBAO_ADDRESS) {
        try {
          const url = new URL(env.CONNECTOR_SECRET_OPENBAO_ADDRESS);
          if (
            url.protocol !== 'https:' ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
          )
            throw new Error('invalid OpenBao URL');
        } catch {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CONNECTOR_SECRET_OPENBAO_ADDRESS'],
            message: 'OpenBao HTTPS origin gerekli',
          });
        }
      }
      const expectedMount = `shopai-${env.DEPLOY_ENV}`;
      if (env.CONNECTOR_SECRET_OPENBAO_MOUNT !== expectedMount)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONNECTOR_SECRET_OPENBAO_MOUNT'],
          message: `${env.DEPLOY_ENV} mount ayrı olmalıdır`,
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
