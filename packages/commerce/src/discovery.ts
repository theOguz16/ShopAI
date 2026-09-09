import { randomUUID } from 'node:crypto';
import type {
  DiscoverySession,
  DiscoverySessionCreateRequest,
  Surface,
  Transport,
} from '@shopai/contracts';

export type DiscoverySessionRecord = DiscoverySession;

export interface DiscoverySessionRepository {
  resolveActiveMerchant(value: string): Promise<{ id: string } | null>;
  create(input: {
    surface: Surface;
    transport: Transport;
    merchantScope: string[];
    referrer: string | null;
    campaign: string | null;
    anonymousUserId: string;
    userId: string | null;
  }): Promise<DiscoverySessionRecord>;
  findById(id: string): Promise<DiscoverySessionRecord | null>;
}

export class DiscoverySessions {
  constructor(private readonly repository: DiscoverySessionRepository) {}

  async create(
    input: DiscoverySessionCreateRequest,
    context: { transport: Transport; userId?: string | null },
  ) {
    const merchantScope = input.merchant
      ? await this.resolveMerchantScope(input.merchant)
      : [];
    return this.repository.create({
      surface: input.surface,
      transport: context.transport,
      merchantScope,
      referrer: input.referrer ?? null,
      campaign: input.campaign ?? null,
      anonymousUserId: input.anonymousUserId ?? randomUUID(),
      userId: context.userId ?? null,
    });
  }

  async require(id: string) {
    const session = await this.repository.findById(id);
    if (!session)
      throw Object.assign(new Error('Discovery session bulunamadı.'), {
        statusCode: 400,
        code: 'DISCOVERY_SESSION_NOT_FOUND',
      });
    return session;
  }

  assertAttribution(
    session: DiscoverySessionRecord,
    attribution: { surface: Surface; transport: Transport },
  ) {
    if (
      session.surface !== attribution.surface ||
      session.transport !== attribution.transport
    )
      throw Object.assign(
        new Error('Discovery session attribution uyuşmuyor.'),
        {
          statusCode: 400,
          code: 'DISCOVERY_SESSION_ATTRIBUTION_MISMATCH',
        },
      );
  }

  applyMerchantScope(
    session: DiscoverySessionRecord,
    context: { merchantIds?: string[] },
  ) {
    if (!session.merchantScope.length) return context;
    const requested = context.merchantIds;
    if (requested?.length) {
      const outsideScope = requested.some(
        (merchantId) => !session.merchantScope.includes(merchantId),
      );
      if (outsideScope)
        throw Object.assign(
          new Error('Discovery session merchant scope dışı.'),
          {
            statusCode: 403,
            code: 'DISCOVERY_SESSION_SCOPE_MISMATCH',
          },
        );
      return context;
    }
    return { ...context, merchantIds: session.merchantScope };
  }

  private async resolveMerchantScope(merchant: string) {
    const resolved = await this.repository.resolveActiveMerchant(merchant);
    if (!resolved)
      throw Object.assign(new Error('Merchant bulunamadı.'), {
        statusCode: 404,
        code: 'MERCHANT_NOT_FOUND',
      });
    return [resolved.id];
  }
}
