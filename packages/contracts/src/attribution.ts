import { z } from 'zod';

export const transportSchema = z.enum(['rest', 'mcp', 'ucp']);
export type Transport = z.infer<typeof transportSchema>;

export const surfaceSchema = z.enum([
  'web',
  'chatgpt',
  'gemini',
  'brand_widget',
]);
export type Surface = z.infer<typeof surfaceSchema>;

export const attributionContextSchema = z
  .object({
    transport: transportSchema,
    surface: surfaceSchema,
  })
  .strict();
export type AttributionContext = z.infer<typeof attributionContextSchema>;

export const WEB_ATTRIBUTION: AttributionContext = {
  transport: 'rest',
  surface: 'web',
};

export const CHATGPT_ATTRIBUTION: AttributionContext = {
  transport: 'mcp',
  surface: 'chatgpt',
};
