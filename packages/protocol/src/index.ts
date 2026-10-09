import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const DRAWING_SCHEMA_VERSION = 1 as const;

export const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PAIRSPACE_FULL",
  "INVITE_EXPIRED",
  "INVITE_ALREADY_USED",
  "LOGIN_EXPIRED",
  "LOGIN_ALREADY_USED",
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

// POST /v1/installations/push-token — registra el token FCM (H6, Android).
export const pushTokenRequest = z.object({
  token: z.string().min(1).max(4096),
});

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

// POST /v1/invites/consume — autenticado: vincula al usuario ya registrado.
// Sin segundo nombre: la identidad viene del onboarding (una sola vez).
export const consumeInviteRequest = z.object({
  inviteToken: z.string().min(1),
});
export const consumeInviteResponse = z.object({
  pairSpaceId: z.string(),
});

// POST /v1/login-attempts — abre una espera de entrada (sin sesión).
// El QR no es credencial: solo referencia el intento pendiente.
export const createLoginAttemptRequest = z.object({
  platform: platformSchema.default("web"),
  ttlSeconds: z.number().int().min(60).max(600).default(300),
});
export const createLoginAttemptResponse = z.object({
  attemptId: z.string(),
  loginCode: z.string(),
  expiresAt: z.string(),
});

// POST /v1/login-attempts/approve — el celular con sesión aprueba (FR-10).
export const approveLoginAttemptRequest = z.object({
  attemptId: z.string().min(1),
  loginCode: z.string().min(1),
});
export const approveLoginAttemptResponse = z.object({
  platform: platformSchema,
});

// POST /v1/login-attempts/poll — el PC sondea hasta entrar (misma identidad).
export const pollLoginAttemptRequest = z.object({
  attemptId: z.string().min(1),
  loginCode: z.string().min(1),
});
export const pollLoginAttemptResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("approved"),
    pairSpaceId: z.string().nullable(),
    userId: z.string(),
    installationId: z.string(),
    installationSecret: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresInSeconds: z.number().int().positive(),
  }),
]);

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

// ---- H4: uploads, publicación, timeline ----

export const uploadPurposeSchema = z.enum(["drawing-doc", "drawing-preview"]);
export const hexHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

// POST /v1/uploads/intents — el servidor asigna objectKey y TTL.
export const uploadIntentRequest = z.object({
  drawingId: z.string().min(1),
  purpose: uploadPurposeSchema,
  contentHash: hexHashSchema,
  byteSize: z.number().int().positive(),
  contentType: z.string().min(1),
});
export const uploadIntentResponse = z.object({
  uploadId: z.string(),
  expiresAt: z.string(),
});

// PUT /v1/uploads/{id} — body binario; respuesta JSON mínima.
export const uploadCompleteResponse = z.object({
  ok: z.literal(true),
  size: z.number().int(),
});

export const drawingMetaSchema = z.object({
  id: z.string(),
  pairSpaceId: z.string(),
  authorUserId: z.string(),
  createdAt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentHash: hexHashSchema,
  eventSeq: z.number().int(),
  deletedAt: z.string().nullable(),
});

// POST /v1/pair-spaces/{id}/drawings — requiere Idempotency-Key.
export const publishDrawingRequest = z.object({
  drawingId: z.string().min(1),
  contentHash: hexHashSchema,
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
});
export const publishDrawingResponse = z.object({
  drawing: drawingMetaSchema,
});

// GET /v1/pair-spaces/{id}/drawings?cursor=&limit=
export const timelineResponse = z.object({
  drawings: z.array(drawingMetaSchema),
  nextCursor: z.string().nullable(),
});

export const pairEventSchema = z.object({
  seq: z.number().int(),
  eventId: z.string(),
  type: z.enum(["drawing.created", "drawing.deleted", "profile.updated"]),
  actorUserId: z.string(),
  entityId: z.string(),
  createdAt: z.string(),
});

// GET /v1/pair-spaces/{id}/events?afterSeq=N
export const eventsResponse = z.object({
  events: z.array(pairEventSchema),
  currentSeq: z.number().int(),
  snapshotRequired: z.boolean(),
});

// GET /v1/drawings/{id}
export const drawingResponse = z.object({
  drawing: drawingMetaSchema,
});

// DELETE /v1/drawings/{id} — tombstone idempotente.
export const deleteDrawingResponse = z.object({
  ok: z.literal(true),
  eventSeq: z.number().int(),
});

// ---- H5: realtime ----

// GET /v1/pair-spaces/{id}/realtime — ticket de un solo uso, TTL segundos.
// El ticket viaja en header (nunca el bearer) y se consume al aceptar el WS.
export const realtimeTicketResponse = z.object({
  ticket: z.string(),
  expiresAt: z.string(),
});

// Mensajes WS (pair.v1). Nunca documento ni imagen por WS (máx 64 KiB).
export const wsHelloSchema = z.object({
  type: z.literal("hello"),
  protocol: z.literal(1),
  lastEventSeq: z.number().int().min(0),
  installationId: z.string(),
});
export const wsReadySchema = z.object({
  type: z.literal("ready"),
  currentSeq: z.number().int(),
  serverTime: z.string(),
});
export const wsServerEventSchema = z.object({
  type: z.enum([
    "drawing.created",
    "drawing.deleted",
    "profile.updated",
    "presence.changed",
    "sync.ack",
  ]),
  seq: z.number().int().optional(),
  eventId: z.string().optional(),
});
