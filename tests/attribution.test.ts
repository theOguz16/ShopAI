import { describe, expect, it } from 'vitest';
import {
  attributionContextSchema,
  CHATGPT_ATTRIBUTION,
  surfaceSchema,
  transportSchema,
  WEB_ATTRIBUTION,
} from '../packages/contracts/src/index.js';

describe('attribution contracts', () => {
  it('keeps transport and surface as separate dimensions', () => {
    expect(CHATGPT_ATTRIBUTION).toEqual({
      transport: 'mcp',
      surface: 'chatgpt',
    });
    expect(WEB_ATTRIBUTION).toEqual({
      transport: 'rest',
      surface: 'web',
    });
  });

  it('accepts current transport and surface values independently', () => {
    expect(transportSchema.options).toEqual(['rest', 'mcp', 'ucp']);
    expect(surfaceSchema.options).toEqual([
      'web',
      'chatgpt',
      'gemini',
      'brand_widget',
    ]);
    expect(
      attributionContextSchema.parse({ transport: 'ucp', surface: 'gemini' }),
    ).toEqual({ transport: 'ucp', surface: 'gemini' });
  });
});
