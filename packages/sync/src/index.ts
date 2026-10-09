// @cookie/sync — outbox + cursors. Determinista: reloj/transporte inyectados.
export type PublishState =
  | "draft"
  | "queued"
  | "uploading"
  | "syncing"
  | "synced"
  | "failed";
