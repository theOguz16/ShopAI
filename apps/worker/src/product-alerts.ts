import { PostgresProductAlertRepository, type Database } from '@shopai/db';
import type { WorkerEnv } from './env.js';

export interface AlertEmailSender {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

export class ResendAlertEmailSender implements AlertEmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: { to: string; subject: string; text: string }) {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!response.ok)
      throw new Error(`Alert email provider failed: ${response.status}`);
  }
}

export function createAlertEmailSender(env: WorkerEnv) {
  if (!env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL) return undefined;
  return new ResendAlertEmailSender(env.RESEND_API_KEY, env.ALERT_FROM_EMAIL);
}

export async function evaluateAndDeliverProductAlerts(
  db: Database,
  merchantId: string,
  sender?: AlertEmailSender,
) {
  const repository = new PostgresProductAlertRepository(db);
  const evaluation = await repository.evaluateForMerchant(merchantId);
  if (!sender) return { ...evaluation, delivered: 0, pendingDelivery: true };

  const notifications = await repository.claimPendingNotifications(merchantId);
  let delivered = 0;
  for (const notification of notifications) {
    try {
      await sender.send({
        to: notification.recipient,
        subject: notification.subject,
        text: notification.body,
      });
      await repository.markNotificationSent(merchantId, notification.id);
      delivered += 1;
    } catch (error) {
      await repository.retryNotification(
        merchantId,
        notification.id,
        error instanceof Error ? error.message : 'unknown email error',
      );
    }
  }
  return { ...evaluation, delivered, pendingDelivery: false };
}
