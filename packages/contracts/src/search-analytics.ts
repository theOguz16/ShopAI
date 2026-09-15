import { z } from 'zod';

export const searchAnalyticsIntentSchema = z.enum([
  'catalog_load',
  'explicit_search',
  'refinement',
]);

export type SearchAnalyticsIntent = z.infer<typeof searchAnalyticsIntentSchema>;

export const recordedSearchIntentSchema = z.enum([
  'catalog_load',
  'explicit_search',
  'refinement',
  'pagination',
]);

export type RecordedSearchIntent = z.infer<typeof recordedSearchIntentSchema>;
