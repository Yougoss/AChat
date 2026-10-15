import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { AppRuntimeLifecycle } from "../app-runtime.ts";
import { resolveDataDir } from "../app-runtime.ts";

const initialMigrationPath = fileURLToPath(
  new URL("./migrations/001_initial.sql", import.meta.url),
);
const initialMigrationVersion = 1;

export function openDatabase(databasePath: string): Database.Database {
  if (databasePath !== ":memory:" && !databasePath.startsWith("file:")) {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  const migrations = db.prepare(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  ).get() as { version: number } | undefined;
  const currentVersion = migrations?.version ?? 0;
  if (currentVersion > initialMigrationVersion) {
    throw new Error(`Database schema version ${currentVersion} is newer than supported`);
  }
  if (currentVersion < initialMigrationVersion) {
    const sql = readFileSync(initialMigrationPath, "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)")
        .run(initialMigrationVersion);
    })();
  }
}

export interface DatabaseLifecycle extends AppRuntimeLifecycle {
  getDatabase(): Database.Database;
}

export function createDatabaseLifecycle(
  databasePath = path.join(resolveDataDir(), "achat.sqlite"),
): DatabaseLifecycle {
  let db: Database.Database | undefined;
  return {
    async start() {
      if (db?.open) return;
      const opened = openDatabase(databasePath);
      try {
        migrate(opened);
        db = opened;
      } catch (error) {
        opened.close();
        throw error;
      }
    },
    async stop() {
      if (db?.open) db.close();
      db = undefined;
    },
    getDatabase() {
      if (!db?.open) throw new Error("Database lifecycle has not started");
      return db;
    },
  };
}
