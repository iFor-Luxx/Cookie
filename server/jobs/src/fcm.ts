// server/jobs — envío FCM HTTP v1 (data-only, sin contenido).
// Sin SDK: fetch + OAuth2 JWT con la cuenta de servicio (WebCrypto RS256).
// Los secretos viven solo en el servidor (wrangler secret).

export interface ServiceAccount {
  readonly clientEmail: string;
  /** Clave privada PKCS#8 PEM de la cuenta de servicio. */
  readonly privateKeyPem: string;
}

export interface PushMessage {
  readonly spaceId: string;
  readonly seq: number;
}

const FCM_BATCH_MAX = 500;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** JWT de cuenta de servicio para oauth2 (1h). Exportado para tests. */
export async function serviceAccountJwt(
  account: ServiceAccount,
  nowSeconds: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

export async function oauthAccessToken(
  account: ServiceAccount,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await serviceAccountJwt(account, now);
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`oauth2 falló: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("oauth2 sin access_token");
  return body.access_token;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export interface PushResult {
  readonly sent: number;
  readonly failed: number;
}

/**
 * Envía data message mínimo a instalaciones Android. Deduplicar por
 * instalación arriba (un token por instalación). FCM puede retrasar o
 * no entregar: best-effort documentado, nunca revierte publicaciones.
 */
export async function sendSpacePush(
  projectId: string,
  accessToken: string,
  tokens: string[],
  message: PushMessage,
  fetchFn: typeof fetch = fetch,
): Promise<PushResult> {
  let sent = 0;
  let failed = 0;
  const unique = [...new Set(tokens.filter((t) => t.length > 0))];
  for (const batch of chunk(unique, FCM_BATCH_MAX)) {
    const results = await Promise.all(
      batch.map(async (token) => {
        try {
          const res = await fetchFn(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${accessToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  token,
                  data: { spaceId: message.spaceId, seq: String(message.seq) },
                },
              }),
            },
          );
          return res.ok;
        } catch {
          return false;
        }
      }),
    );
    for (const ok of results) {
      if (ok) sent++;
      else failed++;
    }
  }
  return { sent, failed };
}
