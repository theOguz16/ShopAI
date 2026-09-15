import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createOpsAlertSender as createApiOpsAlertSender } from '../apps/api/src/ops-alert.js';
import { createOpsAlertSender as createWorkerOpsAlertSender } from '../apps/worker/src/ops-alert.js';

const webhookUrl = 'https://alerts.example/shopai';
const webhookSecret = 'ops-alert-test-secret-000000000000000000';

function assertSignedRequest(
  call: [URL | RequestInfo, RequestInit | undefined] | undefined,
  expectedService: 'api' | 'worker',
) {
  expect(call).toBeDefined();
  const [, init] = call ?? [];
  const headers = init?.headers as Record<string, string>;
  const body = String(init?.body ?? '');
  const timestamp = headers['x-shopai-alert-timestamp'];
  const signature = headers['x-shopai-alert-signature'];
  expect(signature).toBe(
    `sha256=${createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`,
  );
  const payload = JSON.parse(body) as Record<string, unknown>;
  expect(payload).toMatchObject({
    schemaVersion: 1,
    event: 'sync_failed',
    severity: 'error',
    service: expectedService,
    release: 'abcdef123',
    fields: { connectionId: 'connection-1' },
  });
  expect(body).not.toContain(webhookSecret);
  expect(body).not.toContain(webhookUrl);
}

describe('ops alert webhook', () => {
  it('signs API alert payloads without embedding webhook credentials', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 202 }));
    const sender = createApiOpsAlertSender(
      {
        OPS_ALERT_WEBHOOK_URL: webhookUrl,
        OPS_ALERT_WEBHOOK_SECRET: webhookSecret,
        RELEASE_VERSION: 'abcdef123',
      },
      fetcher as typeof fetch,
    );

    await expect(
      sender.send('sync_failed', 'error', { connectionId: 'connection-1' }),
    ).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    assertSignedRequest(fetcher.mock.calls[0], 'api');
  });

  it('uses the same signed contract for worker alerts', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createWorkerOpsAlertSender(
      {
        OPS_ALERT_WEBHOOK_URL: webhookUrl,
        OPS_ALERT_WEBHOOK_SECRET: webhookSecret,
        RELEASE_VERSION: 'abcdef123',
      },
      fetcher as typeof fetch,
    );

    await expect(
      sender.send('sync_failed', 'error', { connectionId: 'connection-1' }),
    ).resolves.toBe(true);
    assertSignedRequest(fetcher.mock.calls[0], 'worker');
  });

  it('is a no-op when an alert sink is not configured', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = createApiOpsAlertSender(
      {
        OPS_ALERT_WEBHOOK_URL: undefined,
        OPS_ALERT_WEBHOOK_SECRET: undefined,
        RELEASE_VERSION: 'development',
      },
      fetcher as typeof fetch,
    );

    await expect(sender.send('request_failed', 'error')).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
