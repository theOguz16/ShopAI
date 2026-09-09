import { z } from 'zod';
import { surfaceSchema, transportSchema } from './attribution.js';

const merchantSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const discoverySessionCreateRequestSchema = z
  .object({
    surface: surfaceSchema,
    merchant: z.union([z.string().uuid(), merchantSlugSchema]).optional(),
    referrer: z.string().trim().min(1).max(2048).optional().nullable(),
    campaign: z.string().trim().min(1).max(128).optional().nullable(),
    anonymousUserId: z.string().uuid().optional(),
  })
  .strict();

export type DiscoverySessionCreateRequest = z.infer<
  typeof discoverySessionCreateRequestSchema
>;

export const discoverySessionSchema = z
  .object({
    id: z.string().uuid(),
    surface: surfaceSchema,
    transport: transportSchema,
    merchantScope: z.array(z.string().uuid()).max(20),
    referrer: z.string().max(2048).nullable(),
    campaign: z.string().max(128).nullable(),
    anonymousUserId: z.string().uuid(),
    userId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type DiscoverySession = z.infer<typeof discoverySessionSchema>;
