// server/api — puente Worker → FCM. Best-effort: sin cuenta de servicio o sin
// tokens, no hace nada. Nunca bloquea ni revierte la publicación.
import type { Db } from "@cookie/server-db";
import { listSpacePushTokens } from "@cookie/server-db";
import {
  oauthAccessToken,
  type PushResult,
  type ServiceAccount,
  sendSpacePush,
} from "@cookie/server-jobs";

export type PushFn = (spaceId: string, seq: number) => Promise<void>;

export interface ParsedServiceAccount {
  readonly account: ServiceAccount;
  readonly projectId: string;
}

/**
 * La cuenta de servicio (JSON de `wrangler secret put FCM_SERVICE_ACCOUNT`)
 * trae `client_email`, `private_key` (PKCS#8 PEM) y `project_id`.
 * Devuelve null si falta o está corrupta (push desactivado).
 */
export function parseServiceAccount(
  raw: string | undefined,
): ParsedServiceAccount | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(raw) as {
      client_email?: unknown;
      private_key?: unknown;
      project_id?: unknown;
    };
    if (
      typeof json.client_email !== "string" ||
      typeof json.private_key !== "string" ||
      typeof json.project_id !== "string"
    )
      return null;
    return {
      account: {
        clientEmail: json.client_email,
        privateKeyPem: json.private_key,
      },
      projectId: json.project_id,
    };
  } catch {
    return null;
  }
}

export interface PushDeps {
  listTokens: (spaceId: string) => Promise<string[]>;
  getAccessToken: (account: ServiceAccount) => Promise<string>;
  send: (
    projectId: string,
    accessToken: string,
    tokens: string[],
    message: { spaceId: string; seq: number },
  ) => Promise<PushResult>;
}

const defaultDeps = (db: Db): PushDeps => ({
  listTokens: (spaceId) => listSpacePushTokens(db, spaceId),
  getAccessToken: (account) => oauthAccessToken(account),
  send: (projectId, accessToken, tokens, message) =>
    sendSpacePush(projectId, accessToken, tokens, message),
});

/** Devuelve el fn de push o null si no hay cuenta de servicio configurada. */
export function makePush(
  serviceAccountJson: string | undefined,
  db: Db,
  deps: Partial<PushDeps> = {},
): PushFn | null {
  const parsed = parseServiceAccount(serviceAccountJson);
  if (!parsed) return null;
  const d = { ...defaultDeps(db), ...deps };
  return async (spaceId, seq) => {
    const tokens = await d.listTokens(spaceId);
    if (tokens.length === 0) return;
    const accessToken = await d.getAccessToken(parsed.account);
    await d.send(parsed.projectId, accessToken, tokens, { spaceId, seq });
  };
}
