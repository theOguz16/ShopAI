import { buildApp } from './app.js';
import { parseApiEnv } from './env.js';
const env = parseApiEnv(process.env);
const app = await buildApp(undefined, env);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({
  host: env.HOST,
  port: env.PORT,
});
