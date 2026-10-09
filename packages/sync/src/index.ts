// @cookie/sync — outbox + cursors + retries. Determinista (reloj/transporte inyectados).
export type PublishState =
  | "draft"
  | "queued"
  | "uploading"
  | "syncing"
  | "synced"
  | "failed";

export * from "./engine";
export * from "./outbox";
export * from "./reconcile";
