export type AuthEmailMessage = { to: string; subject: string; url: string };

export function createAuthEmailSender(config: {
  apiKey: string;
  from: string;
  apiOrigin: string;
  fetcher?: typeof fetch;
}) {
  return async ({ to, subject, url }: AuthEmailMessage): Promise<void> => {
    const target = new URL(url);
    if (
      target.origin !== config.apiOrigin ||
      !target.pathname.startsWith('/v1/auth/better/')
    )
      throw new Error('AUTH_EMAIL_URL_REJECTED');
    const response = await (config.fetcher ?? fetch)(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject,
          text: url,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error('AUTH_EMAIL_DELIVERY_FAILED');
  };
}
