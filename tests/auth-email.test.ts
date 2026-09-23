import { describe, expect, it, vi } from 'vitest';
import { createAuthEmailSender } from '../apps/api/src/auth-email.js';

const message = {
  to: 'merchant@example.test',
  subject: 'ShopAI doğrulama',
  url: 'https://api.shopai.test/v1/auth/better/verify-email?token=one-time',
};

describe('Better Auth e-posta teslimi', () => {
  it('yalnız kendi auth linkini Resend adresine gönderir', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const send = createAuthEmailSender({
      apiKey: 'test-secret-key',
      from: 'auth@shopai.test',
      apiOrigin: 'https://api.shopai.test',
      fetcher: fetcher as typeof fetch,
    });
    await send(message);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
    const options = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      from: 'auth@shopai.test',
      to: ['merchant@example.test'],
      subject: 'ShopAI doğrulama',
      text: message.url,
    });
  });

  it('başka origin veya yol içeren linki hiç göndermez', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const send = createAuthEmailSender({
      apiKey: 'test-secret-key',
      from: 'auth@shopai.test',
      apiOrigin: 'https://api.shopai.test',
      fetcher: fetcher as typeof fetch,
    });
    await expect(
      send({
        ...message,
        url: 'https://evil.test/v1/auth/better/verify-email',
      }),
    ).rejects.toThrow('AUTH_EMAIL_URL_REJECTED');
    await expect(
      send({ ...message, url: 'https://api.shopai.test/other' }),
    ).rejects.toThrow('AUTH_EMAIL_URL_REJECTED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('teslim hatasında bağlantıyı loglamadan başarısız olur', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
    const send = createAuthEmailSender({
      apiKey: 'test-secret-key',
      from: 'auth@shopai.test',
      apiOrigin: 'https://api.shopai.test',
      fetcher: fetcher as typeof fetch,
    });
    await expect(send(message)).rejects.toThrow('AUTH_EMAIL_DELIVERY_FAILED');
  });
});
