/**
 * In-process SQLite adapter that emulates the subset of the Cloudflare D1
 * API used by this project (prepare/bind/first/all/run + batch as a single
 * transaction). Lets the real application SQL run unchanged in tests.
 */

import BetterSqlite3 from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
export const MIGRATION_FILES = [
  '0001_initial_schema.sql',
  '0002_add_indexes.sql',
  '0003_submission_idempotency.sql',
];

/**
 * Strip comments safely, then split on semicolons. Inline `--` comments can
 * contain semicolons, so they must be removed per-line BEFORE splitting —
 * but only outside single-quoted string literals.
 */
export function stripComments(sql: string): string {
  let out = '';
  for (const line of sql.split('\n')) {
    let inStr = false;
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'") inStr = !inStr;
      else if (!inStr && ch === '-' && line[i + 1] === '-') { cut = i; break; }
    }
    out += (cut >= 0 ? line.slice(0, cut) : line) + '\n';
  }
  return out;
}

export function splitStatements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface BoundStatement {
  first<T = any>(colName?: string | null): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }>;
  run<T = any>(): Promise<{ success: boolean; meta: any; results: any[] }>;
  /** internal: synchronous executor used by batch() */
  __exec(sqlite: BetterSqlite3.Database): void;
}

function normalizeValue(v: unknown): any {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

function d1Error(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const err = new Error(`[D1] ${msg}`);
  (err as any).cause = e;
  return err;
}

export class D1TestDb {
  readonly sqlite: BetterSqlite3.Database;

  constructor(filename: string = ':memory:') {
    this.sqlite = new BetterSqlite3(filename);
    this.sqlite.pragma('foreign_keys = ON');
  }

  applyMigrations(files: string[] = MIGRATION_FILES): void {
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
      for (const stmt of splitStatements(sql)) {
        this.sqlite.exec(stmt);
      }
    }
  }

  prepare(query: string): { bind(...values: unknown[]): BoundStatement } {
    const sqlite = this.sqlite;
    return {
      bind(...values: unknown[]): BoundStatement {
        const norm = values.map(normalizeValue);
        const execSync = () => sqlite.prepare(query).run(...norm);
        return {
          async first<T = any>(colName?: string | null): Promise<T | null> {
            try {
              const row = sqlite.prepare(query).get(...norm);
              if (row === undefined) return null;
              if (typeof colName === 'string') return ((row as any)[colName] ?? null) as T | null;
              return row as T;
            } catch (e) {
              throw d1Error(e);
            }
          },
          async all<T = any>() {
            try {
              const r = sqlite.prepare(query).all(...norm);
              return { results: r as T[], success: true, meta: { changes: r.length } };
            } catch (e) {
              throw d1Error(e);
            }
          },
          async run<T = any>() {
            try {
              const info = sqlite.prepare(query).run(...norm);
              return {
                success: true,
                meta: { changes: info.changes, last_insert_id: Number(info.lastInsertRowid) },
                results: [],
              };
            } catch (e) {
              throw d1Error(e);
            }
          },
          __exec: execSync,
        };
      },
    };
  }

  /** D1 batch semantics: statements run in one atomic transaction. */
  async batch(statements: BoundStatement[]): Promise<any[]> {
    try {
      const tx = this.sqlite.transaction(() => {
        for (const st of statements) st.__exec(this.sqlite);
      });
      tx();
      return statements.map(() => ({ success: true, meta: {} }));
    } catch (e) {
      throw d1Error(e);
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
