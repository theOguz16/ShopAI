import { describe, expect, it } from 'vitest';
import { normalizeConnectorStoreUrl } from '../packages/connectors/src/index.js';

describe('connector store URL normalization', () => {
  it('keeps equivalent URLs identical across case, port and slash differences', () => {
    // IDN hosts must normalize identically regardless of input case, without
    // hardcoding the punycode form here.
    expect(normalizeConnectorStoreUrl('https://Mağazam.com/')).toBe(
      normalizeConnectorStoreUrl('https://mağazam.com'),
    );
    expect(normalizeConnectorStoreUrl('https://Store.Example.com:443/')).toBe(
      'https://store.example.com',
    );
    expect(normalizeConnectorStoreUrl('https://store.example.com')).toBe(
      'https://store.example.com',
    );
    expect(normalizeConnectorStoreUrl('https://store.example.com/')).toBe(
      'https://store.example.com',
    );
    expect(normalizeConnectorStoreUrl('https://STORE.example.COM')).toBe(
      'https://store.example.com',
    );
    expect(
      normalizeConnectorStoreUrl('https://store.example.com/wp/?utm=ads'),
    ).toBe('https://store.example.com/wp');
  });

  it('keeps subdirectory installs and non-default ports distinct', () => {
    expect(normalizeConnectorStoreUrl('https://example.com/shop')).toBe(
      'https://example.com/shop',
    );
    expect(normalizeConnectorStoreUrl('https://example.com:8443')).toBe(
      'https://example.com:8443',
    );
    expect(normalizeConnectorStoreUrl('https://example.com/shop/')).toBe(
      'https://example.com/shop',
    );
  });

  it('rejects non-HTTPS, userinfo and malformed URLs', () => {
    expect(normalizeConnectorStoreUrl('http://store.example.com')).toBeNull();
    expect(normalizeConnectorStoreUrl('ftp://store.example.com')).toBeNull();
    expect(
      normalizeConnectorStoreUrl('https://user:pass@store.example.com'),
    ).toBeNull();
    expect(
      normalizeConnectorStoreUrl('https://store.example.com/#fragment'),
    ).toBeNull();
    expect(normalizeConnectorStoreUrl('not-a-url')).toBeNull();
    expect(normalizeConnectorStoreUrl('')).toBeNull();
  });
});
