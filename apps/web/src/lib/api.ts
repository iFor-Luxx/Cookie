// Cliente HTTP H4. Tokens en memoria + sessionStorage (vida de pestaña).
// Pendiente H7: refresh en store seguro con rotación endurecida.
import type { Platform } from "@cookie/core";

const BASE = import.meta.env["VITE_API_URL"] as string | undefined;
const baseUrl = (BASE ?? "http://localhost:8787").replace(/\/$/, "");

export function apiBaseUrl(): string {
  return baseUrl;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  installationId: string;
  userId: string;
}

export interface DrawingMeta {
  id: string;
  pairSpaceId: string;
  authorUserId: string;
  createdAt: string;
  width: number;
  height: number;
  contentHash: string;
  eventSeq: number;
  deletedAt: string | null;
}

const SESSION_KEY = "cookie.session.v1";

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  private session: Session | null = loadSession();
  private sessionListener: ((s: Session | null) => void) | null = null;

  /** La capa nativa (widget/FCM) se suscribe para espejar la sesión. */
  onSessionChange(fn: (s: Session | null) => void): void {
    this.sessionListener = fn;
  }

  get loggedIn(): boolean {
    return this.session !== null;
  }

  sessionInfo(): { installationId: string; userId: string } | null {
    if (!this.session) return null;
    return {
      installationId: this.session.installationId,
      userId: this.session.userId,
    };
  }

  private persist(): void {
    try {
      if (this.session)
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Almacenamiento no disponible: sesión solo en memoria.
    }
  }

  setSession(s: Session | null): void {
    this.session = s;
    this.persist();
    try {
      this.sessionListener?.(s);
    } catch {
      // El espejo nativo nunca debe romper la sesión web.
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("x-protocol-version", "1");
    if (this.session)
      headers.set("authorization", `Bearer ${this.session.accessToken}`);
    if (
      init.body &&
      typeof init.body === "string" &&
      !headers.has("content-type")
    ) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status === 401 && retry && this.session) {
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.request<T>(path, init, false);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiError(
        res.status,
        body?.error?.code ?? "UNKNOWN",
        body?.error?.message ?? `HTTP ${res.status}`,
      );
    }
    return (await res.json()) as T;
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.session) return false;
    try {
      const res = await fetch(`${baseUrl}/v1/sessions/refresh`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.session.refreshToken}`,
          "x-protocol-version": "1",
        },
      });
      if (!res.ok) throw new Error("refresh rechazado");
      const body = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      this.session = { ...this.session, ...body };
      this.persist();
      return true;
    } catch {
      this.setSession(null);
      return false;
    }
  }

  private post<T>(
    path: string,
    body: unknown,
    extra?: HeadersInit,
  ): Promise<T> {
    const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
    if (extra !== undefined) init.headers = extra;
    return this.request<T>(path, init);
  }

  async register(displayName: string): Promise<void> {
    const platform: Platform =
      typeof window !== "undefined" && "Capacitor" in window
        ? "android"
        : "web";
    const body = (await this.post("/v1/installations", {
      platform,
      displayName,
    })) as {
      installationId: string;
      userId: string;
      installationSecret: string;
      accessToken: string;
      refreshToken: string;
    };
    this.setSession({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      installationId: body.installationId,
      userId: body.userId,
    });
  }

  me(): Promise<{
    userId: string;
    displayName: string;
    pairSpaceId: string | null;
  }> {
    return this.request("/v1/me");
  }

  async createSpace(): Promise<{
    pairSpaceId: string;
    recoverySecret: string;
  }> {
    return this.post("/v1/pair-spaces", {});
  }

  async createInvite(
    spaceId: string,
  ): Promise<{ inviteToken: string; expiresAt: string }> {
    return this.post(`/v1/pair-spaces/${spaceId}/invites`, {});
  }

  async consumeInvite(inviteToken: string): Promise<{ pairSpaceId: string }> {
    const body = (await this.post("/v1/invites/consume", { inviteToken })) as {
      pairSpaceId: string;
    };
    return { pairSpaceId: body.pairSpaceId };
  }

  /** Abre una espera de entrada y devuelve su QR (dispositivo sin sesión). */
  async createLoginAttempt(): Promise<{
    attemptId: string;
    loginCode: string;
    expiresAt: string;
  }> {
    const platform: Platform =
      typeof window !== "undefined" && "Capacitor" in window
        ? "android"
        : "web";
    return this.post("/v1/login-attempts", { platform });
  }

  /** Aprueba una espera con la sesión activa (el celular escanea el QR). */
  async approveLoginAttempt(
    attemptId: string,
    loginCode: string,
  ): Promise<{ platform: string }> {
    return this.post("/v1/login-attempts/approve", { attemptId, loginCode });
  }

  /** Sondea la espera: pendiente hasta que el otro dispositivo aprueba. */
  async pollLoginAttempt(
    attemptId: string,
    loginCode: string,
  ): Promise<
    | { status: "pending" }
    | {
        status: "approved";
        pairSpaceId: string | null;
        userId: string;
        installationId: string;
        accessToken: string;
        refreshToken: string;
      }
  > {
    const body = (await this.post("/v1/login-attempts/poll", {
      attemptId,
      loginCode,
    })) as {
      status: "pending" | "approved";
      pairSpaceId: string | null;
      userId: string;
      installationId: string;
      accessToken: string;
      refreshToken: string;
    };
    if (body.status === "approved") {
      this.setSession({
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        installationId: body.installationId,
        userId: body.userId,
      });
      return {
        status: "approved",
        pairSpaceId: body.pairSpaceId,
        userId: body.userId,
        installationId: body.installationId,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
      };
    }
    return { status: "pending" };
  }

  async recoveryChallenge(
    spaceId: string,
    installationId: string,
  ): Promise<{ challengeId: string }> {
    return this.post(`/v1/pair-spaces/${spaceId}/recovery-challenges`, {
      installationId,
    });
  }

  async recoveryComplete(
    challengeId: string,
    recoverySecret: string,
  ): Promise<void> {
    const platform: Platform =
      typeof window !== "undefined" && "Capacitor" in window
        ? "android"
        : "web";
    const body = (await this.post("/v1/recovery/complete", {
      challengeId,
      recoverySecret,
      platform,
    })) as {
      userId: string;
      installationId: string;
      accessToken: string;
      refreshToken: string;
    };
    this.setSession({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      installationId: body.installationId,
      userId: body.userId,
    });
  }

  async uploadIntent(args: {
    drawingId: string;
    purpose: "drawing-doc" | "drawing-preview";
    contentHash: string;
    byteSize: number;
    contentType: string;
  }): Promise<{ uploadId: string }> {
    return this.post("/v1/uploads/intents", args);
  }

  async uploadPut(
    uploadId: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const headers = new Headers();
    headers.set("x-protocol-version", "1");
    if (this.session)
      headers.set("authorization", `Bearer ${this.session.accessToken}`);
    headers.set("content-type", contentType);
    const res = await fetch(`${baseUrl}/v1/uploads/${uploadId}`, {
      method: "PUT",
      headers,
      body: bytes as BodyInit,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiError(
        res.status,
        body?.error?.code ?? "UNKNOWN",
        body?.error?.message ?? "Upload fallido",
      );
    }
  }

  async publish(
    spaceId: string,
    drawingId: string,
    contentHash: string,
    width: number,
    height: number,
    idempotencyKey: string,
  ): Promise<{ drawing: DrawingMeta }> {
    return this.request(`/v1/pair-spaces/${spaceId}/drawings`, {
      method: "POST",
      body: JSON.stringify({ drawingId, contentHash, width, height }),
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  async timeline(
    spaceId: string,
    cursor?: string,
  ): Promise<{ drawings: DrawingMeta[]; nextCursor: string | null }> {
    const q = cursor
      ? `?cursor=${encodeURIComponent(cursor)}&limit=20`
      : "?limit=20";
    return this.request(`/v1/pair-spaces/${spaceId}/drawings${q}`);
  }

  async events(
    spaceId: string,
    afterSeq: number,
  ): Promise<{
    events: Array<{
      seq: number;
      eventId?: string;
      type: string;
      entityId: string;
    }>;
    currentSeq: number;
    snapshotRequired: boolean;
  }> {
    return this.request(
      `/v1/pair-spaces/${spaceId}/events?afterSeq=${afterSeq}`,
    );
  }

  async realtimeTicket(
    spaceId: string,
  ): Promise<{ ticket: string; expiresAt: string }> {
    return this.request(`/v1/pair-spaces/${spaceId}/realtime`);
  }

  async previewBytes(drawingId: string): Promise<Blob> {
    const headers = new Headers();
    if (this.session)
      headers.set("authorization", `Bearer ${this.session.accessToken}`);
    const res = await fetch(`${baseUrl}/v1/drawings/${drawingId}/preview`, {
      headers,
    });
    if (!res.ok)
      throw new ApiError(res.status, "NOT_FOUND", "Preview no disponible");
    return res.blob();
  }

  async deleteDrawing(drawingId: string): Promise<void> {
    await this.request(`/v1/drawings/${drawingId}`, { method: "DELETE" });
  }

  /** H6: registra el token FCM de esta instalación (Android). Best-effort. */
  async pushToken(token: string): Promise<void> {
    await this.post("/v1/installations/push-token", { token });
  }

  logout(): void {
    const token = this.session?.accessToken;
    this.setSession(null);
    if (token) {
      void fetch(`${baseUrl}/v1/sessions/current`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  }
}

export const api = new ApiClient();
