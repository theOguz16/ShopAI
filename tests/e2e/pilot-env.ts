const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Pilot E2E için ${name} gerekli.`);
  return value;
};

export const pilot = {
  webUrl: required('PILOT_WEB_URL'),
  apiUrl: required('PILOT_API_URL'),
  merchantId: required('PILOT_MERCHANT_ID'),
  email: required('PILOT_MERCHANT_EMAIL'),
  loginToken: required('PILOT_LOGIN_TOKEN'),
  productTitle: required('PILOT_EXPECTED_PRODUCT_TITLE'),
  externalId: required('PILOT_EXPECTED_EXTERNAL_ID'),
  size: required('PILOT_EXPECTED_SIZE'),
  color: required('PILOT_EXPECTED_COLOR'),
  priceMinor: Number(required('PILOT_EXPECTED_PRICE_MINOR')),
  checkoutUrl: new URL(required('PILOT_EXPECTED_CHECKOUT_URL')),
};

if (!Number.isSafeInteger(pilot.priceMinor) || pilot.priceMinor < 0)
  throw new Error(
    'PILOT_EXPECTED_PRICE_MINOR güvenli pozitif tamsayı olmalıdır.',
  );
