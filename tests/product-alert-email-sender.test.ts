import { describe, expect, it } from 'vitest';
import { ResendAlertEmailSender } from '../apps/worker/src/product-alerts.js';

describe('ResendAlertEmailSender', () => {
  it('sends the stable notification idempotency key as the Resend header', async () => {
    const requests: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(init ?? {});
      return new Response(null, { status: 200 });
    };
    const sender = new ResendAlertEmailSender(
      're_test',
      'ShopAI <alerts@example.com>',
      fetchImpl,
    );
    const input = {
      idempotencyKey: 'product-alert/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      to: 'shopper@example.com',
      subject: 'Fiyat alarmı',
      text: 'Ürünün fiyatı düştü.',
    };

    await sender.send(input);
    await sender.send(input);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.method).toBe('POST');
      expect(request.headers).toEqual(
        expect.objectContaining({
          'Idempotency-Key': input.idempotencyKey,
        }),
      );
    }
  });
});
