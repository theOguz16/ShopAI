import { createHmac, randomUUID } from 'node:crypto';
import type { ApiEnv } from './env.js';

export type OpsAlertSeverity = 'warning' | 'error';
export type OpsAlertFields = Record<string, unknown>;

type FetchLike = typeof fetch;

type OpsAlertPayload = {
  schemaVersion: 1;
  alertId: string;
  event: string;
  severity: OpsAlertSeverity;
  service: 'api';
  release: string;
  emittedAt: string;
  fields: OpsAlertFields;
};

export function createOpsAlertSender(
  env: Pick<
    ApiEnv,
    'OPS_ALERT_WEBHOOK_URL' | 'OPS_ALERT_WEBHOOK_SECRET' | 'RELEASE_VERSION'
  >,
  fetcher: FetchLike = fetch,
) {
  const webhookUrl = env.OPS_ALERT_WEBHOOK_URL;
  const webhookSecret = env.OPS_ALERT_WEBHOOK_SECRET;

  return {
    enabled: Boolean(webhookUrl && webhookSecret),
    async send(
      event: string,
      severity: OpsAlertSeverity,
      fields: OpsAlertFields = {},
    ) {
      if (!webhookUrl || !webhookSecret) return false;
      const timestamp = String(Date.now());
      const payload: OpsAlertPayload = {
        schemaVersion: 1,
        alertId: randomUUID(),
        event,
        severity,
        service: 'api',
        release: env.RELEASE_VERSION,
        emittedAt: new Date(Number(timestamp)).toISOString(),
        fields,
      };
      const body = JSON.stringify(payload);
      const signature = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
      try {
        const response = await fetcher(webhookUrl, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'x-shopai-alert-timestamp': timestamp,
            'x-shopai-alert-signature': `sha256=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'ops_alert_delivery_failed',
              service: 'api',
              release: env.RELEASE_VERSION,
              statusCode: response.status,
            }),
          );
          return false;
        }
        return true;
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'ops_alert_delivery_failed',
            service: 'api',
            release: env.RELEASE_VERSION,
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
        return false;
      }
    },
  };
}
