import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const DRAWING_SCHEMA_VERSION = 1 as const;

export const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PAIRSPACE_FULL",
  "INVITE_EXPIRED",
  "INVITE_ALREADY_USED",
  "IDEMPOTENCY_CONFLICT",
  "UPLOAD_EXPIRED",
  "BLOB_NOT_FOUND",
  "CURSOR_EXPIRED",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "QUOTA_EXCEEDED",
  "TEMPORARY_UNAVAILABLE",
]);

export const errorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
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

export const platformSchema = z.enum(["web", "android"]);
export const displayNameSchema = z.string().min(1).max(32);

// POST /v1/installations
export const createInstallationRequest = z.object({
  platform: platformSchema,
  displayName: displayNameSchema,
});
export const createInstallationResponse = z.object({
  installationId: z.string(),
  userId: z.string(),
  // Secreto de credencial: se devuelve UNA sola vez, nunca se re-lee.
  installationSecret: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});

// POST /v1/sessions/refresh — refresh via Authorization: Bearer <refresh>
export const refreshSessionResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});

// GET /v1/me
export const meResponse = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatarVersion: z.string().nullable(),
  pairSpaceId: z.string().nullable(),
});

// PATCH /v1/me
export const updateMeRequest = z.object({
  displayName: displayNameSchema.optional(),
});
export const updateMeResponse = meResponse;

// POST /v1/pair-spaces — crea espacio + primer miembro + recovery secret
export const createPairSpaceResponse = z.object({
  pairSpaceId: z.string(),
  // Secreto de recovery: mostrar UNA vez. Sin él no hay recuperación.
  recoverySecret: z.string(),
});

// POST /v1/pair-spaces/{id}/invites
export const createInviteRequest = z.object({
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .default(3600),
});
export const createInviteResponse = z.object({
  inviteId: z.string(),
  // Token de invitación: un solo uso, TTL corto. Compartir por canal privado.
  inviteToken: z.string(),
  expiresAt: z.string(),
});

// POST /v1/invites/consume
export const consumeInviteRequest = z.object({
  inviteToken: z.string().min(1),
  displayName: displayNameSchema,
  platform: platformSchema.default("web"),
});
export const consumeInviteResponse = z.object({
  pairSpaceId: z.string(),
  userId: z.string(),
  installationId: z.string(),
  installationSecret: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});

// POST /v1/pair-spaces/{id}/recovery-challenges
export const recoveryChallengeRequest = z.object({
  installationId: z.string().min(1),
});
export const recoveryChallengeResponse = z.object({
  challengeId: z.string(),
  expiresAt: z.string(),
});

// POST /v1/recovery/complete
export const recoveryCompleteRequest = z.object({
  challengeId: z.string().min(1),
  recoverySecret: z.string().min(1),
  platform: platformSchema,
});
export const recoveryCompleteResponse = z.object({
  userId: z.string(),
  installationId: z.string(),
  installationSecret: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
