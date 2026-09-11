import { z } from 'zod';

export const productAlertConditionTypeSchema = z.enum([
  'PRICE_BELOW',
  'BACK_IN_STOCK',
]);
export type ProductAlertConditionType = z.infer<
  typeof productAlertConditionTypeSchema
>;

export const productAlertStatusSchema = z.enum([
  'ACTIVE',
  'TRIGGERED',
  'CANCELLED',
]);
export type ProductAlertStatus = z.infer<typeof productAlertStatusSchema>;

const targetValueSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const createProductAlertRequestObject = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    conditionType: productAlertConditionTypeSchema,
    targetValue: targetValueSchema.nullable().optional(),
    email: z.string().trim().email().max(254),
  })
  .strict();

export const createProductAlertRequestShape =
  createProductAlertRequestObject.shape;

const refinedCreateProductAlertRequestSchema =
  createProductAlertRequestObject.superRefine((value, ctx) => {
    if (value.conditionType === 'PRICE_BELOW' && value.targetValue == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetValue'],
        message: 'PRICE_BELOW için targetValue zorunludur.',
      });
    }
    if (value.conditionType === 'BACK_IN_STOCK') {
      if (!value.variantId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['variantId'],
          message: 'BACK_IN_STOCK için variantId zorunludur.',
        });
      }
      if (value.targetValue != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targetValue'],
          message: 'BACK_IN_STOCK targetValue kullanmaz.',
        });
      }
    }
  });

export const createProductAlertRequestSchema = Object.assign(
  refinedCreateProductAlertRequestSchema,
  { shape: createProductAlertRequestShape },
);
export type CreateProductAlertRequest = z.infer<
  typeof refinedCreateProductAlertRequestSchema
>;

export const productAlertSchema = z
  .object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable(),
    conditionType: productAlertConditionTypeSchema,
    targetValue: targetValueSchema.nullable(),
    status: productAlertStatusSchema,
    channel: z.literal('email'),
    email: z.string().email(),
    createdAt: z.string().datetime(),
    triggeredAt: z.string().datetime().nullable(),
  })
  .strict();
export type ProductAlert = z.infer<typeof productAlertSchema>;

export const productAlertResponseSchema = z
  .object({ alert: productAlertSchema })
  .strict();
export const productAlertsResponseSchema = z
  .object({ alerts: z.array(productAlertSchema) })
  .strict();

export const productAlertIdParamsSchema = z
  .object({ alertId: z.string().uuid() })
  .strict();

export const cancelProductAlertResponseSchema = z
  .object({ cancelled: z.boolean() })
  .strict();
