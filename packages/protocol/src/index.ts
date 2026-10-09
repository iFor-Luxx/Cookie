import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const DRAWING_SCHEMA_VERSION = 1 as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  requestId: z.string(),
});

export const headersSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  clientVersion: z.string().optional(),
  protocolVersion: z.literal(1),
});
