import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp.js';
import { createServices } from './services.js';
import { parseApiEnv } from './env.js';
const env = parseApiEnv(process.env);
const services = createServices(env);
const server = createMcpServer(services, {
  origin: env.WIDGET_ORIGIN,
  resourceDomains: env.WIDGET_RESOURCE_DOMAINS,
});
await server.connect(new StdioServerTransport());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await server.close();
    await services.close();
  });
