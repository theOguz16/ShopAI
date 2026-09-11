import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  merchantConversionRequestSchema,
  type MerchantConversionRequest,
} from '@shopai/contracts/merchant-conversions';
import type { Surface, Transport } from '@shopai/contracts';

export const MERCHANT_CONVERSION_SIGNATURE_TTL_SECONDS = 5 * 60;

export type MerchantConversionAttribution = {
  clickId: string;
  searchId: string;
  discoverySessionId: string | null;
  offerId: string;
  connectionId: string;
  transport: Transport;
  surface: Surface;
};

export type MerchantConversionRecordResult =
  | ({
      status: 'created' | 'duplicate';
      conversionId: string;
    } & MerchantConversionAttribution)
  | { status: 'click_not_found' }
  | { status: 'tracking_not_configured' }
  | { status: 'order_conflict' };

export interface MerchantConversionRepository {
  recordPaidOrder(input: {
    merchantId: string;
    clickId: string;
    orderId: string;
    orderValueMinor: number;
    currency: 'TRY';
  }): Promise<MerchantConversionRecordResult>;
}

export function merchantOrderValueToMinor(orderValue: number) {
  const minor = Math.round(orderValue * 100);
  if (!Number.isSafeInteger(minor) || minor < 0)
    throw new Error('Sipariş tutarı güvenli aralığın dışında.');
  return minor;
}

export function canonicalMerchantConversionPayload(
  payload: MerchantConversionRequest,
) {
  const parsed = merchantConversionRequestSchema.parse(payload);
  return JSON.stringify({
    clickId: parsed.clickId,
    orderId: parsed.orderId,
    orderValue: parsed.orderValue,
    currency: parsed.currency,
  });
}

export function deriveMerchantConversionKey(
  rootSecret: string,
  merchantId: string,
) {
  return createHmac('sha256', rootSecret).update(merchantId).digest();
}

export function signMerchantConversionRequest(input: {
  rootSecret: string;
  merchantId: string;
  timestamp: string;
  payload: MerchantConversionRequest;
}) {
  const key = deriveMerchantConversionKey(input.rootSecret, input.merchantId);
  return createHmac('sha256', key)
    .update(
      `${input.timestamp}.${canonicalMerchantConversionPayload(input.payload)}`,
    )
    .digest('hex');
}

export function verifyMerchantConversionRequestSignature(input: {
  rootSecret: string;
  merchantId: string;
  timestamp: string;
  signature: string;
  payload: MerchantConversionRequest;
  now?: number;
}) {
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds) || !Number.isInteger(timestampSeconds))
    return { valid: false as const, code: 'INVALID_SIGNATURE' as const };
  const now = input.now ?? Date.now();
  if (
    Math.abs(now - timestampSeconds * 1000) >
    MERCHANT_CONVERSION_SIGNATURE_TTL_SECONDS * 1000
  )
    return { valid: false as const, code: 'STALE_SIGNATURE' as const };
  if (!/^[0-9a-f]{64}$/iu.test(input.signature))
    return { valid: false as const, code: 'INVALID_SIGNATURE' as const };
  const expected = Buffer.from(
    signMerchantConversionRequest({
      rootSecret: input.rootSecret,
      merchantId: input.merchantId,
      timestamp: input.timestamp,
      payload: input.payload,
    }),
    'hex',
  );
  const received = Buffer.from(input.signature, 'hex');
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return { valid: false as const, code: 'INVALID_SIGNATURE' as const };
  return { valid: true as const };
}

export class MerchantConversions {
  constructor(private readonly repository: MerchantConversionRepository) {}

  async confirmPaidOrder(
    merchantId: string,
    payload: MerchantConversionRequest,
  ) {
    const parsed = merchantConversionRequestSchema.parse(payload);
    return this.repository.recordPaidOrder({
      merchantId,
      clickId: parsed.clickId,
      orderId: parsed.orderId,
      orderValueMinor: merchantOrderValueToMinor(parsed.orderValue),
      currency: parsed.currency,
    });
  }
}
