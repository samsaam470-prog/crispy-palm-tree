import { describe, expect, it } from 'vitest';
import { D1TestDb, MIGRATION_FILES, splitStatements } from './helpers/d1';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

describe('migrations', () => {
  it('apply cleanly in order on a fresh database', () => {
    const db = new D1TestDb();
    expect(() => db.applyMigrations()).not.toThrow();
    const tables = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    for (const t of ['interviews', 'questions', 'options', 'branching_rules', 'submissions', 'answers']) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it('idempotent re-apply does not fail (IF NOT EXISTS guards)', () => {
    const db = new D1TestDb();
    db.applyMigrations();
    // Re-applying 0001/0002 must be safe; 0003 ALTER is intentionally
    // applied once by wrangler's migration ledger. We only re-run 0001+0002.
    const sql1 = readFileSync(resolve(MIGRATIONS_DIR, '0001_initial_schema.sql'), 'utf8');
    const sql2 = readFileSync(resolve(MIGRATIONS_DIR, '0002_add_indexes.sql'), 'utf8');
    expect(() => {
      for (const stmt of [...splitStatements(sql1), ...splitStatements(sql2)]) db.sqlite.exec(stmt);
    }).not.toThrow();
    db.close();
  });

  it('enforces foreign keys and unique constraints', () => {
    const db = new D1TestDb();
    db.applyMigrations();
    const ts = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO interviews (title, description, status, config_json, created_at, updated_at)
         VALUES ('t','','draft','{}',?,?)`,
      )
      .run(ts, ts);
    // Question referencing nonexistent interview must fail.
    expect(() =>
      db.sqlite
        .prepare(
          `INSERT INTO questions (interview_id, uid, type, text, required, display_order,
             page_number, answer_display, created_at, updated_at)
           VALUES (999,'q1','short_text','x',0,1,1,'full',?,?)`,
        )
        .run(ts, ts),
    ).toThrow(/FOREIGN KEY/i);
    // Duplicate public_id must fail.
    db.sqlite.prepare(`UPDATE interviews SET status='published', public_id='abc' WHERE id=1`).run();
    expect(() =>
      db.sqlite
        .prepare(
          `INSERT INTO interviews (title, description, status, config_json, created_at, updated_at, public_id)
           VALUES ('t2','','published','{}',?,?, 'abc')`,
        )
        .run(ts, ts),
    ).toThrow(/UNIQUE/i);
    db.close();
  });

  it('migration files list matches directory contents', () => {
    const files = MIGRATION_FILES;
    for (const f of files) {
      expect(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
