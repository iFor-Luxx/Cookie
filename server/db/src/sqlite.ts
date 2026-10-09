import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Db } from "./db";

const here = dirname(fileURLToPath(import.meta.url));

export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  const dir = join(here, "..", "migrations");
  for (const f of readdirSync(dir).sort()) {
    db.exec(readFileSync(join(dir, f), "utf8"));
  }
}

export function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

function toParams(params: readonly unknown[]): SQLInputValue[] {
  return params.map((p): SQLInputValue => {
    if (p === undefined || p === null) return null;
    if (typeof p === "string" || typeof p === "number" || typeof p === "bigint")
      return p;
    if (p instanceof Uint8Array) return p;
    throw new TypeError(`sqlite: parámetro no soportado (${typeof p})`);
  });
}

/** Adapter node:sqlite → Db. Solo tests/H2 local; prod usa D1. */
export function sqliteDb(db: DatabaseSync): Db {
  return {
    get: async <T>(sql: string, ...params: unknown[]): Promise<T | null> => {
      const row = db.prepare(sql).get(...toParams(params)) as T | undefined;
      return row ?? null;
    },
    all: async <T>(sql: string, ...params: unknown[]): Promise<T[]> =>
      db.prepare(sql).all(...toParams(params)) as T[],
    run: async (sql: string, ...params: unknown[]): Promise<void> => {
      db.prepare(sql).run(...toParams(params));
    },
  };
}
