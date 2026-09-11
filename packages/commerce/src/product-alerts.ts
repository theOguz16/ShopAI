import type { ProductAlertConditionType } from '@shopai/contracts/product-alerts';

export type ProductAlertEvaluationInput = {
  conditionType: ProductAlertConditionType;
  targetValue: number | null;
  currentPriceMinor: number | null;
  available: boolean | null;
};

export function shouldTriggerProductAlert(
  input: ProductAlertEvaluationInput,
): boolean {
  if (input.conditionType === 'PRICE_BELOW') {
    return (
      input.targetValue !== null &&
      input.currentPriceMinor !== null &&
      input.currentPriceMinor < input.targetValue
    );
  }
  return input.available === true;
}

export function buildProductAlertEmail(input: {
  conditionType: ProductAlertConditionType;
  productTitle: string;
  variantLabel?: string | null;
  targetValue: number | null;
  currentPriceMinor: number | null;
}) {
  if (input.conditionType === 'PRICE_BELOW') {
    return {
      subject: `Fiyat düştü: ${input.productTitle}`,
      text: `${input.productTitle}${input.variantLabel ? ` (${input.variantLabel})` : ''} için takip ettiğin fiyat koşulu gerçekleşti. Güncel fiyat: ${((input.currentPriceMinor ?? 0) / 100).toFixed(2)} TL.`,
    };
  }
  return {
    subject: `Stok geldi: ${input.productTitle}`,
    text: `${input.productTitle}${input.variantLabel ? ` (${input.variantLabel})` : ''} yeniden stokta.`,
  };
}
