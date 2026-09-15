import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  recordedSearchIntentSchema,
  searchAnalyticsIntentSchema,
} from '../packages/contracts/src/search-analytics.js';

describe('search analytics intent taxonomy', () => {
  it('keeps client intents separate from server-recorded pagination', () => {
    expect(searchAnalyticsIntentSchema.options).toEqual([
      'catalog_load',
      'explicit_search',
      'refinement',
    ]);
    expect(recordedSearchIntentSchema.options).toEqual([
      'catalog_load',
      'explicit_search',
      'refinement',
      'pagination',
    ]);
  });

  it('adds a constrained and indexed search intent column', async () => {
    const migration = await readFile(
      new URL(
        '../packages/db/drizzle/0026_search_intent_metrics.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(migration).toContain(
      'ADD COLUMN "intent" text DEFAULT \'explicit_search\' NOT NULL',
    );
    expect(migration).toContain(
      "CHECK (\"intent\" in ('catalog_load','explicit_search','refinement','pagination'))",
    );
    expect(migration).toContain('search_events_intent_reporting');
  });
});
