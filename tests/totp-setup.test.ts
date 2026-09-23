import { describe, expect, it } from 'vitest';
import { totpSetupKey } from '../apps/web/lib/totp-setup.js';

describe('doğrulayıcı kurulum adresi', () => {
  it('TOTP anahtarını elle kurulum için çıkarır', () => {
    expect(
      totpSetupKey(
        'otpauth://totp/ShopAI:test%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ShopAI',
      ),
    ).toBe('JBSWY3DPEHPK3PXP');
  });

  it.each([
    'https://example.com/?secret=JBSWY3DPEHPK3PXP',
    'otpauth://hotp/ShopAI?secret=JBSWY3DPEHPK3PXP',
    'otpauth://totp/ShopAI',
    'otpauth://totp/ShopAI?secret=bad%20key',
    'not a URL',
  ])('geçersiz kurulum adresini reddeder: %s', (uri) => {
    expect(totpSetupKey(uri)).toBeNull();
  });
});
