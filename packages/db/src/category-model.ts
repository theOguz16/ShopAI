import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { connections, products, users } from './schema.js';

export const categories = pgTable(
  'categories',
  {
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    parentSlug: text('parent_slug'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('categories_parent_active').on(t.parentSlug, t.active)],
);

export const categoryFacets = pgTable(
  'category_facets',
  {
    categorySlug: text('category_slug')
      .notNull()
      .references(() => categories.slug, { onDelete: 'cascade' }),
    key: text('facet_key').notNull(),
    label: text('label').notNull(),
    options: jsonb('options').$type<string[]>().notNull(),
    position: integer('position').notNull().default(0),
    attributeScope: text('attribute_scope').notNull().default('variant'),
    attributeKey: text('attribute_key').notNull(),
    unit: text('unit'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique().on(t.categorySlug, t.key),
    check(
      'category_facets_attribute_scope',
      sql`${t.attributeScope} in ('product','variant')`,
    ),
  ],
);

export const sourceCategoryMappings = pgTable(
  'source_category_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    provider: text('provider').notNull(),
    sourceCategoryId: text('source_category_id').notNull(),
    sourceCategoryName: text('source_category_name').notNull(),
    sourceCategoryPath: jsonb('source_category_path').$type<string[] | null>(),
    canonicalCategorySlug: text('canonical_category_slug').references(
      () => categories.slug,
    ),
    status: text('status').notNull().default('needs_mapping'),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    unique().on(
      t.merchantId,
      t.connectionId,
      t.provider,
      t.sourceCategoryId,
    ),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }).onDelete('cascade'),
    check(
      'source_category_mapping_status',
      sql`${t.status} in ('mapped','needs_mapping')`,
    ),
    check(
      'source_category_mapping_target',
      sql`(${t.status} = 'mapped' AND ${t.canonicalCategorySlug} IS NOT NULL)
          OR (${t.status} = 'needs_mapping' AND ${t.canonicalCategorySlug} IS NULL)`,
    ),
    index('source_category_mappings_status').on(t.merchantId, t.status),
    index('source_category_mappings_canonical').on(
      t.canonicalCategorySlug,
      t.status,
    ),
  ],
);

export const productAttributes = pgTable(
  'product_attributes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id').notNull(),
    productId: uuid('product_id').notNull(),
    key: text('facet_key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    unique().on(t.productId, t.key, t.value),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }).onDelete('cascade'),
  ],
);
