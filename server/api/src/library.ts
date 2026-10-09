// server/api — rutas H4 (uploads, publicación, timeline, eventos).
import {
  type DrawingRecord,
  decodeCursor,
  deleteDrawing,
  encodeCursor,
  publishDrawing,
} from "@cookie/core";
import { parseDocument } from "@cookie/drawing";
import { publishDrawingRequest, uploadIntentRequest } from "@cookie/protocol";
import { LIMITS } from "@cookie/storage";
import {
  type AppDeps,
  auth,
  checkRate,
  domainErr,
  err,
  rateKeyInstallation,
  readJson,
  requireMembership,
} from "./http";
import { runMaintenance } from "./maintenance";
import { RATE_LIMITS } from "./middleware";

const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 3600;
const INTENT_TTL_SECONDS = 15 * 60;

function meta(d: DrawingRecord, eventSeq: number): Record<string, unknown> {
  return {
    id: d.id,
    pairSpaceId: d.pairSpaceId,
    authorUserId: d.authorUserId,
    createdAt: d.createdAt,
    width: d.width,
    height: d.height,
    contentHash: d.contentHash,
    eventSeq,
    deletedAt: d.deletedAt,
  };
}

function objectKeyFor(
  spaceId: string,
  drawingId: string,
  purpose: string,
): string {
  const leaf = purpose === "drawing-doc" ? "doc-v1.json" : "preview-v1.webp";
  return `spaces/${spaceId}/drawings/${drawingId}/${leaf}`;
}

function previewMagicOk(bytes: Uint8Array): boolean {
  const png = [0x89, 0x50, 0x4e, 0x47];
  const jpeg = [0xff, 0xd8, 0xff];
  const webpRiff = [0x52, 0x49, 0x46, 0x46];
  const webpSig = [0x57, 0x45, 0x42, 0x50];
  const starts = (sig: number[]): boolean =>
    sig.every((b, i) => bytes[i] === b);
  if (starts(png) || starts(jpeg)) return true;
  if (
    starts(webpRiff) &&
    [8, 9, 10, 11].every((i) => bytes[i] === webpSig[i - 8])
  )
    return true;
  return false;
}

function isUniqueConflict(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed|UNIQUE violation|duplicate/i.test(msg);
}

export async function handleLibraryRoutes(
  deps: AppDeps,
  req: Request,
  url: URL,
  requestId: string,
): Promise<Response | null> {
  const me = await auth(deps, req);
  const needsAuth =
    url.pathname.startsWith("/v1/uploads/") ||
    /\/v1\/pair-spaces\/[^/]+\/(drawings|events)/.test(url.pathname) ||
    url.pathname.startsWith("/v1/drawings/");
  if (needsAuth && !me) {
    return err(requestId, "UNAUTHENTICATED", "Autenticación requerida", 401);
  }

  // POST /v1/uploads/intents
  if (req.method === "POST" && url.pathname === "/v1/uploads/intents") {
    if (!me)
      return err(requestId, "UNAUTHENTICATED", "Autenticación requerida", 401);
    const limited = checkRate(
      deps,
      requestId,
      rateKeyInstallation(me.installation.id, "upload-intent"),
      RATE_LIMITS.uploadIntent,
    );
    if (limited) return limited;
    const parsed = uploadIntentRequest.safeParse(await readJson(req));
    if (!parsed.success)
      return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
    const { drawingId, purpose, contentHash, byteSize, contentType } =
      parsed.data;
    const spaces = await deps.store.userSpaces(me.user.id);
    if (spaces.length === 0)
      return err(requestId, "FORBIDDEN", "Sin espacio activo", 403);
    const spaceId = spaces[0]?.pairSpaceId;
    if (!spaceId) return err(requestId, "FORBIDDEN", "Sin espacio activo", 403);
    const maxBytes =
      purpose === "drawing-doc" ? LIMITS.drawingDocBytes : LIMITS.previewBytes;
    const ctOk =
      purpose === "drawing-doc"
        ? contentType === "application/json"
        : ["image/webp", "image/png", "image/jpeg"].includes(contentType);
    if (!ctOk || byteSize > maxBytes) {
      return err(
        requestId,
        "VALIDATION_ERROR",
        "Tipo o tamaño no permitido",
        400,
      );
    }
    const now = deps.clock.nowIso();
    const intentId = deps.crypto.newId();
    await deps.library.createUploadIntent({
      id: intentId,
      installationId: me.installation.id,
      pairSpaceId: spaceId,
      drawingId,
      purpose,
      objectKey: objectKeyFor(spaceId, drawingId, purpose),
      expectedHash: contentHash,
      maxBytes,
      createdAt: now,
      expiresAt: new Date(
        new Date(now).getTime() + INTENT_TTL_SECONDS * 1000,
      ).toISOString(),
      consumedAt: null,
    });
    const intent = await deps.library.findUploadIntent(intentId);
    return Response.json(
      { uploadId: intentId, expiresAt: intent?.expiresAt ?? now },
      { status: 201 },
    );
  }

  // PUT /v1/uploads/{id} — body binario.
  const putMatch = /^\/v1\/uploads\/([^/]+)$/.exec(url.pathname);
  if (req.method === "PUT" && putMatch) {
    if (!me)
      return err(requestId, "UNAUTHENTICATED", "Autenticación requerida", 401);
    const uploadId = putMatch[1];
    if (!uploadId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const intent = await deps.library.findUploadIntent(uploadId);
    const now = deps.clock.nowIso();
    if (!intent || intent.installationId !== me.installation.id) {
      return err(requestId, "NOT_FOUND", "Upload desconocido", 404);
    }
    if (intent.consumedAt !== null || intent.expiresAt <= now) {
      return err(
        requestId,
        "UPLOAD_EXPIRED",
        "Intent vencido o consumido",
        410,
      );
    }
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > intent.maxBytes) {
      return err(requestId, "VALIDATION_ERROR", "Tamaño inválido", 400);
    }
    if ((await deps.crypto.sha256Hex(buf)) !== intent.expectedHash) {
      return err(requestId, "VALIDATION_ERROR", "Hash no coincide", 400);
    }
    if (intent.purpose === "drawing-doc") {
      try {
        const text = new TextDecoder().decode(buf);
        parseDocument(JSON.parse(text));
      } catch {
        return err(requestId, "VALIDATION_ERROR", "Documento inválido", 400);
      }
    } else if (!previewMagicOk(buf)) {
      return err(
        requestId,
        "VALIDATION_ERROR",
        "Preview no es imagen válida",
        400,
      );
    }
    await deps.objects.put(intent.objectKey, {
      bytes: buf,
      contentType:
        intent.purpose === "drawing-doc" ? "application/json" : "image/webp",
      size: buf.length,
    });
    await deps.library.consumeUploadIntent(intent.id, now);
    return Response.json({ ok: true, size: buf.length });
  }

  // POST /v1/pair-spaces/{id}/drawings — requiere Idempotency-Key.
  const publishMatch = /^\/v1\/pair-spaces\/([^/]+)\/drawings$/.exec(
    url.pathname,
  );
  if (req.method === "POST" && publishMatch) {
    if (!me)
      return err(requestId, "UNAUTHENTICATED", "Autenticación requerida", 401);
    const limitedPublish = checkRate(
      deps,
      requestId,
      rateKeyInstallation(me.installation.id, "publish"),
      RATE_LIMITS.publish,
    );
    if (limitedPublish) return limitedPublish;
    const spaceId = publishMatch[1];
    if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const key = req.headers.get("idempotency-key");
    if (!key) {
      return err(requestId, "VALIDATION_ERROR", "Falta Idempotency-Key", 400);
    }
    const parsed = publishDrawingRequest.safeParse(await readJson(req));
    if (!parsed.success)
      return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
    const requestHash = await deps.crypto.sha256Hex(
      JSON.stringify(parsed.data),
    );
    const scope = `publish:${spaceId}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await publishDrawing(
          deps.store,
          deps.library,
          deps.objects,
          deps.crypto,
          deps.clock,
          {
            spaceId,
            actorUserId: me.user.id,
            drawingId: parsed.data.drawingId,
            contentHash: parsed.data.contentHash,
            width: parsed.data.width,
            height: parsed.data.height,
            idempotencyKey: key,
            requestHash,
            scope,
            idempotencyTtlSeconds: IDEMPOTENCY_TTL_SECONDS,
          },
        );
        if (!res.ok)
          return domainErr(requestId, res.code, "No se pudo publicar");
        // Fanout post-commit (best-effort): el cliente reconcilia por cursor.
        // El aviso es un nudge; la verdad viaja por /events (dedupe por seq).
        await deps
          .notify({
            spaceId,
            type: "drawing.created",
            seq: res.value.eventSeq,
            entityId: res.value.drawing.id,
            actorUserId: me.user.id,
          })
          .catch(() => undefined);
        return Response.json(
          { drawing: meta(res.value.drawing, res.value.eventSeq) },
          { status: 201 },
        );
      } catch (e) {
        if (!isUniqueConflict(e) || attempt === 2) throw e;
        // Carrera de seq: el registro de idempotencia ya debe existir.
        const existing = await deps.library.getIdempotency(scope, key);
        if (existing && existing.requestHash === requestHash) {
          const value = JSON.parse(existing.responseJson) as {
            drawing: DrawingRecord;
            eventSeq: number;
          };
          return Response.json(
            { drawing: meta(value.drawing, value.eventSeq) },
            { status: 201 },
          );
        }
      }
    }
    return err(
      requestId,
      "TEMPORARY_UNAVAILABLE",
      "Reintenta la publicación",
      503,
      true,
    );
  }

  // GET /v1/pair-spaces/{id}/drawings — timeline paginado.
  const timelineMatch = /^\/v1\/pair-spaces\/([^/]+)\/drawings$/.exec(
    url.pathname,
  );
  if (req.method === "GET" && timelineMatch && me) {
    const spaceId = timelineMatch[1];
    if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const gate = await requireMembership(deps, me, spaceId, requestId);
    if (!gate.ok) return gate.response;
    const cursorParam = url.searchParams.get("cursor");
    const after = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !after) {
      return err(requestId, "VALIDATION_ERROR", "Cursor inválido", 400);
    }
    const limit = Math.min(
      Math.max(
        Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20,
        1,
      ),
      LIMITS.timelinePage,
    );
    const rows = await deps.library.listDrawingsVisible(spaceId, after, limit);
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length > 0
        ? encodeCursor({
            createdAt: page[page.length - 1]?.drawing.createdAt ?? "",
            id: page[page.length - 1]?.drawing.id ?? "",
          })
        : null;
    return Response.json({
      drawings: page.map((r) => meta(r.drawing, r.eventSeq)),
      nextCursor,
    });
  }

  // GET /v1/pair-spaces/{id}/events — replay por seq.
  const eventsMatch = /^\/v1\/pair-spaces\/([^/]+)\/events$/.exec(url.pathname);
  if (req.method === "GET" && eventsMatch && me) {
    const spaceId = eventsMatch[1];
    if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const gate = await requireMembership(deps, me, spaceId, requestId);
    if (!gate.ok) return gate.response;
    const afterSeq = Number.parseInt(
      url.searchParams.get("afterSeq") ?? "0",
      10,
    );
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      return err(requestId, "VALIDATION_ERROR", "afterSeq inválido", 400);
    }
    const currentSeq = await deps.library.currentSeq(spaceId);
    const minSeq = await deps.library.minSeq(spaceId);
    if (afterSeq > 0 && (minSeq === null || afterSeq < minSeq)) {
      return Response.json({ events: [], currentSeq, snapshotRequired: true });
    }
    const events = await deps.library.listEvents(
      spaceId,
      afterSeq,
      LIMITS.eventBatch,
    );
    return Response.json({
      events: events.map((e) => ({
        seq: e.seq,
        eventId: e.eventId,
        type: e.type,
        actorUserId: e.actorUserId,
        entityId: e.entityId,
        createdAt: e.createdAt,
      })),
      currentSeq,
      snapshotRequired: false,
    });
  }

  // GET /v1/pair-spaces/{id}/realtime — ticket WS un solo uso, TTL 30s.
  const ticketMatch = /^\/v1\/pair-spaces\/([^/]+)\/realtime$/.exec(
    url.pathname,
  );
  if (req.method === "GET" && ticketMatch && me) {
    const limitedTicket = checkRate(
      deps,
      requestId,
      rateKeyInstallation(me.installation.id, "ticket"),
      RATE_LIMITS.ticket,
    );
    if (limitedTicket) return limitedTicket;
    const spaceId = ticketMatch[1];
    if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const gate = await requireMembership(deps, me, spaceId, requestId);
    if (!gate.ok) return gate.response;
    const now = deps.clock.nowIso();
    const ticket = deps.crypto.newId();
    await deps.tickets.createTicket({
      id: ticket,
      pair_space_id: spaceId,
      installation_id: me.installation.id,
      created_at: now,
      expires_at: new Date(new Date(now).getTime() + 30_000).toISOString(),
      consumed_at: null,
    });
    return Response.json({
      ticket,
      expiresAt: new Date(new Date(now).getTime() + 30_000).toISOString(),
    });
  }

  // POST /internal/tickets/consume — solo DO (secreto interno).
  if (req.method === "POST" && url.pathname === "/internal/tickets/consume") {
    if (req.headers.get("authorization") !== `Bearer ${deps.internalSecret}`) {
      return err(requestId, "FORBIDDEN", "Interno", 403);
    }
    const body = (await readJson(req)) as { ticket?: unknown };
    if (typeof body?.ticket !== "string") {
      return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
    }
    const consumed = await deps.tickets.consumeTicket(
      body.ticket,
      deps.clock.nowIso(),
    );
    if (!consumed) return err(requestId, "NOT_FOUND", "Ticket inválido", 404);
    return Response.json({
      spaceId: consumed.pair_space_id,
      installationId: consumed.installation_id,
    });
  }

  // GET /internal/spaces/{id}/seq — solo DO (secreto interno).
  const seqMatch = /^\/internal\/spaces\/([^/]+)\/seq$/.exec(url.pathname);
  if (req.method === "GET" && seqMatch?.[1]) {
    if (req.headers.get("authorization") !== `Bearer ${deps.internalSecret}`) {
      return err(requestId, "FORBIDDEN", "Interno", 403);
    }
    return Response.json({
      currentSeq: await deps.library.currentSeq(seqMatch[1]),
    });
  }

  // GET /v1/pair-spaces/{id}/export — manifiesto versionado (portabilidad §5.7).
  // Los bytes se descargan con los endpoints de dibujo existentes.
  const exportMatch = /^\/v1\/pair-spaces\/([^/]+)\/export$/.exec(url.pathname);
  if (req.method === "GET" && exportMatch && me) {
    const spaceId = exportMatch[1];
    if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const gate = await requireMembership(deps, me, spaceId, requestId);
    if (!gate.ok) return gate.response;
    const rows = await deps.library.listDrawingsVisible(spaceId, null, 10_000);
    return Response.json({
      version: 1,
      pairSpaceId: spaceId,
      exportedAt: deps.clock.nowIso(),
      exportedBy: me.user.id,
      drawings: rows.map((r) => meta(r.drawing, r.eventSeq)),
    });
  }

  // POST /internal/maintenance/gc — limpieza de huérfanos y vencidos.
  if (req.method === "POST" && url.pathname === "/internal/maintenance/gc") {
    if (req.headers.get("authorization") !== `Bearer ${deps.internalSecret}`) {
      return err(requestId, "FORBIDDEN", "Interno", 403);
    }
    return Response.json(
      await runMaintenance(
        deps.library,
        deps.tickets,
        deps.objects,
        deps.clock.nowIso(),
      ),
    );
  }

  // GET /v1/drawings/{id} + bytes + DELETE.
  const drawingMatch = /^\/v1\/drawings\/([^/]+)(\/(document|preview))?$/.exec(
    url.pathname,
  );
  if (drawingMatch && me) {
    const drawingId = drawingMatch[1];
    const sub = drawingMatch[3];
    if (!drawingId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const drawing = await deps.library.findDrawing(drawingId);
    if (!drawing) {
      return err(requestId, "NOT_FOUND", "Dibujo desconocido", 404);
    }
    const gate = await requireMembership(
      deps,
      me,
      drawing.pairSpaceId,
      requestId,
    );
    if (!gate.ok) return gate.response;

    if (req.method === "DELETE" && !sub) {
      // El core resuelve el tombstone idempotente (re-borrado → 200).
      const res = await deleteDrawing(
        deps.store,
        deps.library,
        deps.crypto,
        deps.clock,
        {
          drawingId,
          actorUserId: me.user.id,
        },
      );
      if (!res.ok) return domainErr(requestId, res.code, "No se pudo borrar");
      await deps
        .notify({
          spaceId: drawing.pairSpaceId,
          type: "drawing.deleted",
          seq: res.value.eventSeq,
          entityId: drawingId,
          actorUserId: me.user.id,
        })
        .catch(() => undefined);
      return Response.json({ ok: true, eventSeq: res.value.eventSeq });
    }
    if (drawing.deletedAt !== null) {
      return err(requestId, "NOT_FOUND", "Dibujo desconocido", 404);
    }
    if (req.method === "GET" && !sub) {
      const seq = await deps.library.currentSeq(drawing.pairSpaceId);
      return Response.json({ drawing: meta(drawing, seq) });
    }
    if (req.method === "GET" && (sub === "document" || sub === "preview")) {
      const key = sub === "document" ? drawing.documentKey : drawing.previewKey;
      const obj = await deps.objects.get(key);
      if (!obj)
        return err(requestId, "BLOB_NOT_FOUND", "Recurso no disponible", 404);
      const copy = Uint8Array.from(obj.bytes);
      return new Response(copy.buffer as ArrayBuffer, {
        headers: {
          "content-type": obj.contentType,
          "content-length": String(obj.size),
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    }
  }

  return null;
}
