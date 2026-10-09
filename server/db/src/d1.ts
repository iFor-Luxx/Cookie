import type { Db, DbWrite } from "./db";

/** Filas D1: prepare/bind/first/all/run/batch. Interfaz estructural, sin SDK. */
export interface D1Like {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
  batch(statements: unknown[]): Promise<unknown>;
}

/** Adapter D1 → Db para el Worker en prod. */
export function d1Db(d1: D1Like): Db {
  return {
    get: async <T>(sql: string, ...params: unknown[]): Promise<T | null> =>
      d1
        .prepare(sql)
        .bind(...params)
        .first<T>(),
    all: async <T>(sql: string, ...params: unknown[]): Promise<T[]> =>
      (
        await d1
          .prepare(sql)
          .bind(...params)
          .all<T>()
      ).results,
    run: async (sql: string, ...params: unknown[]): Promise<void> => {
      await d1
        .prepare(sql)
        .bind(...params)
        .run();
    },
    batch: async (ops: DbWrite[]): Promise<void> => {
      await d1.batch(ops.map((op) => d1.prepare(op.sql).bind(...op.params)));
    },
  };
}
