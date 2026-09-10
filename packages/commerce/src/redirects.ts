import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AttributionContext, Surface, Transport } from '@shopai/contracts';
import { surfaceSchema, transportSchema } from '@shopai/contracts';

export * from './sync-progress.js';

export type RedirectClaims = {
  version: 2;
  offerId: string;
  searchId: string;
  transport: Transport;
  surface: Surface;
  issuedAt: number;
  expiresAt: number;
};

export class RedirectTokenError extends Error {
  constructor(
    readonly code: 'INVALID_TOKEN' | 'EXPIRED_TOKEN',
    message: string,
  ) {
    super(message);
  }
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class RedirectTokens {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = 15 * 60,
  ) {
    if (Buffer.byteLength(secret) < 32)
      throw new Error('Yönlendirme imza anahtarı en az 32 byte olmalıdır.');
  }

  create(
    input: Pick<
      RedirectClaims,
      'offerId' | 'searchId' | 'transport' | 'surface'
    >,
    now = Date.now(),
  ) {
    if (!uuid.test(input.offerId) || !uuid.test(input.searchId))
      throw new RedirectTokenError(
        'INVALID_TOKEN',
        'Geçersiz yönlendirme kimliği.',
      );
    if (
      !transportSchema.safeParse(input.transport).success ||
      !surfaceSchema.safeParse(input.surface).success
    )
      throw new RedirectTokenError(
        'INVALID_TOKEN',
        'Geçersiz yönlendirme attribution bilgisi.',
      );
    const issuedAt = Math.floor(now / 1000);
    const claims: RedirectClaims = {
      version: 2,
      ...input,
      issuedAt,
      expiresAt: issuedAt + this.ttlSeconds,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string, now = Date.now()): RedirectClaims {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra)
      throw new RedirectTokenError(
        'INVALID_TOKEN',
        'Yönlendirme bağlantısı geçersiz.',
      );
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new RedirectTokenError(
        'INVALID_TOKEN',
        'Yönlendirme bağlantısı geçersiz.',
      );
    let claims: Partial<RedirectClaims>;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new RedirectTokenError(
        'INVALID_TOKEN',
        'Yönlendirme bağlantısı geçersiz.',
      );
    }
    if (
      claims.version !== 2 ||
      typeof claims.offerId !== 'string' ||
      !uuid.test(claims.offerId) ||
      typeof claims.searchId !== 'string' ||
      !uuid.test(claims.searchId) ||
      !transportSchema.safeParse(claims.transport).success ||
      !surfaceSchema.safeParse(claims.surface).success ||
      !Number.isSafeInteger(claims.issuedAt) ||
      !Number.isSafeInteger(claims.expiresAt)
    )
      throw new RedirectTokenError(
        'INVALID_TOKEN',
        'Yönlendirme bağlantısı geçersiz.',
      );
    if ((claims.expiresAt as number) <= Math.floor(now / 1000))
      throw new RedirectTokenError(
        'EXPIRED_TOKEN',
        'Yönlendirme bağlantısının süresi dolmuş.',
      );
    return claims as RedirectClaims;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url');
  }
}

export function classifyRedirectRequest(userAgent: string | undefined) {
  if (!userAgent) return 'bot' as const;
  return /bot|crawler|spider|preview|slackbot|discordbot|whatsapp|facebookexternalhit|twitterbot|linkedinbot/iu.test(
    userAgent,
  )
    ? ('bot' as const)
    : ('human' as const);
}

export type RedirectTarget = { url: string; merchantId: string };
export interface RedirectRepository {
  resolvePublishedOffer(offerId: string): Promise<RedirectTarget | null>;
  recordClick(input: {
    claims: RedirectClaims;
    merchantId: string;
    classification: 'human' | 'bot';
  }): Promise<void>;
}

export class RedirectService {
  constructor(
    private readonly tokens: RedirectTokens,
    private readonly repository: RedirectRepository,
    private readonly publicOrigin: string,
  ) {}

  createLink(
    input: Pick<RedirectClaims, 'offerId' | 'searchId'> & AttributionContext,
  ) {
    return new URL(
      `/r/${this.tokens.create(input)}`,
      this.publicOrigin,
    ).toString();
  }

  async open(token: string, userAgent?: string) {
    const claims = this.tokens.verify(token);
    const target = await this.repository.resolvePublishedOffer(claims.offerId);
    if (!target) return null;
    const url = new URL(target.url);
    if (url.protocol !== 'https:')
      throw new Error('Kayıtlı yönlendirme hedefi HTTPS değil.');
    const classification = classifyRedirectRequest(userAgent);
    await this.repository.recordClick({
      claims,
      merchantId: target.merchantId,
      classification,
    });
    return { url: url.toString(), classification };
  }
}
