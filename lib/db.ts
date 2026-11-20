import { createClient, Client, InStatement, Transaction } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";

// Production data layer: Turso Cloud / libSQL client
// Canonical shared database on Turso: all Vercel serverless functions connect to the same instance.
// Fallback: local SQLite file (file:prisma/dev.db) for local offline development.

export interface DatabaseClient {
  execute(stmt: InStatement): Promise<any>;
  batch(stmts: InStatement[], mode?: "write" | "read" | "deferred"): Promise<any[]>;
  exec(sql: string): Promise<void>;
  all<T = any>(sql: string, ...args: any[]): Promise<T[]>;
  get<T = any>(sql: string, ...args: any[]): Promise<T | undefined>;
  run(sql: string, ...args: any[]): Promise<{ rowsAffected: number; lastInsertRowid?: bigint | number }>;
  prepare(sql: string): {
    all<T = any>(...args: any[]): Promise<T[]>;
    get<T = any>(...args: any[]): Promise<T | undefined>;
    run(...args: any[]): Promise<{ rowsAffected: number; lastInsertRowid?: bigint | number }>;
  };
  transaction(mode?: "write" | "read" | "deferred"): Promise<Transaction>;
}

declare global {
  // eslint-disable-next-line no-var
  var __libsqlDb: DatabaseClient | undefined;
  // eslint-disable-next-line no-var
  var __rawLibsql: Client | undefined;
}

function normalizeArgs(args: any[]): any[] {
  const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return list.map((val) => (val === undefined ? null : val));
}

export function createDatabaseWrapper(rawClient: Client): DatabaseClient {
  return {
    async execute(stmt: InStatement) {
      return rawClient.execute(stmt);
    },
    async batch(stmts: InStatement[], mode: "write" | "read" | "deferred" = "write") {
      return rawClient.batch(stmts, mode);
    },
    async exec(sql: string) {
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));
      if (statements.length > 0) {
        await rawClient.batch(statements, "write");
      }
    },
    async all<T = any>(sql: string, ...args: any[]): Promise<T[]> {
      const res = await rawClient.execute({ sql, args: normalizeArgs(args) });
      return res.rows as unknown as T[];
    },
    async get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> {
      const res = await rawClient.execute({ sql, args: normalizeArgs(args) });
      return res.rows[0] as unknown as T | undefined;
    },
    async run(sql: string, ...args: any[]): Promise<{ rowsAffected: number; lastInsertRowid?: bigint | number }> {
      const res = await rawClient.execute({ sql, args: normalizeArgs(args) });
      return {
        rowsAffected: res.rowsAffected,
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
      };
    },
    prepare(sql: string) {
      return {
        async all<T = any>(...args: any[]): Promise<T[]> {
          const res = await rawClient.execute({ sql, args: normalizeArgs(args) });
          return res.rows as unknown as T[];
        },
        async get<T = any>(...args: any[]): Promise<T | undefined> {
          const res = await rawClient.execute({ sql, args: normalizeArgs(args) });
          return res.rows[0] as unknown as T | undefined;
        },
        async run(...args: any[]): Promise<{ rowsAffected: number; lastInsertRowid?: bigint | number }> {
          const res = await rawClient.execute({ sql, args: normalizeArgs(args) });
          return {
            rowsAffected: res.rowsAffected,
            lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
          };
        },
      };
    },
    async transaction(mode: "write" | "read" | "deferred" = "write") {
      return rawClient.transaction(mode);
    },
  };
}

export function getDb(): DatabaseClient {
  if (!global.__libsqlDb) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    let client: Client;
    if (tursoUrl) {
      client = createClient({
        url: tursoUrl,
        authToken: tursoToken,
      });
    } else {
      // Local development fallback
      const localPath = path.join(process.cwd(), "prisma", "dev.db");
      client = createClient({
        url: `file:${localPath}`,
      });
    }

    global.__rawLibsql = client;
    global.__libsqlDb = createDatabaseWrapper(client);
  }
  return global.__libsqlDb;
}

export function newId(prefix = ""): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureBaselineData(_db?: any): void {
  // Baseline data is maintained permanently in Turso cloud.
}

