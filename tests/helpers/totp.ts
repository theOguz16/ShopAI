import { createHmac } from 'node:crypto';

export function testTotp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const letter of secret.toUpperCase().replaceAll('=', '')) {
    const index = alphabet.indexOf(letter);
    if (index < 0) throw new Error('Invalid TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = createHmac('sha1', key).update(counter).digest();
  const position = (digest[digest.length - 1] ?? 0) & 15;
  const value = (digest.readUInt32BE(position) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, '0');
}
