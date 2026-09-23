/** The otpauth URI is a credential; only extract its manual-entry key locally. */
export function totpSetupKey(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp')
      return null;
    const secret = parsed.searchParams.get('secret');
    return secret && /^[A-Z2-7]+$/i.test(secret) ? secret : null;
  } catch {
    return null;
  }
}
