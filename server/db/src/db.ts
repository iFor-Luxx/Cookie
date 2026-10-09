// @cookie/server-db — Db mínimo compartido por adapters (D1 prod, node:sqlite tests).
// Placeholders `?` en ambos. Tiempos ISO-8601 TEXT. Sin ORM.
export interface Db {
  get<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<void>;
}
