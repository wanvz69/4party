import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const migrations = [
    { version: 1, sql: fs.readFileSync(schemaPath, 'utf8') },
    ...fs.readdirSync(migrationsDirectory)
      .filter((name) => /^\d+-.+\.sql$/.test(name))
      .sort()
      .map((name) => ({
        version: Number(name.slice(0, name.indexOf('-'))),
        sql: fs.readFileSync(path.join(migrationsDirectory, name), 'utf8'),
      })),
  ];
  try {
    for (const migration of migrations) {
      const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
      if (applied) continue;
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(migration.version);
      }).immediate();
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
