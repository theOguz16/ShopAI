import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { products } from './schema.js';

export const categories = pgTable('categories', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
});

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
  },
  (t) => [unique().on(t.categorySlug, t.key)],
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
