import { z } from 'zod';

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
  })
  .superRefine((env, context) => {
    if (env.DEPLOY_ENV !== 'local' && env.RELEASE_VERSION === 'development')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RELEASE_VERSION'],
        message: 'local dışı ortamda immutable sürüm kimliği zorunludur',
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
