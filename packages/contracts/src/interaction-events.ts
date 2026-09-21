import { z } from 'zod';

export const interactionEventTypeSchema = z.enum([
  'category_selected',
  'filter_applied',
  'product_impression',
  'product_saved',
  'alert_created',
]);

export const interactionEventInputSchema = z
  .object({
    eventKey: z.string().uuid(),
    type: interactionEventTypeSchema,
    merchantId: z.string().uuid(),
    productId: z.string().uuid().optional(),
    category: z.string().trim().min(1).max(80).optional(),
    filterKind: z
      .enum(['category', 'size', 'color', 'price', 'stock', 'attribute'])
      .optional(),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (
      ['product_impression', 'product_saved', 'alert_created'].includes(
        event.type,
      ) &&
      !event.productId
    )
      ctx.addIssue({
        code: 'custom',
        path: ['productId'],
        message: 'required',
      });
    if (event.type === 'category_selected' && !event.category)
      ctx.addIssue({ code: 'custom', path: ['category'], message: 'required' });
    if (event.type === 'filter_applied' && !event.filterKind)
      ctx.addIssue({
        code: 'custom',
        path: ['filterKind'],
        message: 'required',
      });
  });

export const interactionEventsRequestSchema = z
  .object({
    discoverySessionId: z.string().uuid(),
    events: z.array(interactionEventInputSchema).min(1).max(50),
  })
  .strict();

export type InteractionEventsRequest = z.infer<
  typeof interactionEventsRequestSchema
>;

export const interactionEventsResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
  })
  .strict();
