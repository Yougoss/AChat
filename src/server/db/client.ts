import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { AppRuntimeLifecycle } from "../app-runtime.ts";
import { resolveDataDir } from "../app-runtime.ts";

const migrationFiles = [
  {
    version: 1,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/001_initial.sql"),
  },
  {
    version: 2,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/002_contact_unread_boundaries.sql"),
  },
  {
    version: 3,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/003_attention_run_work_item_scope.sql"),
  },
  {
    version: 4,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/004_trace_capture.sql"),
  },
  {
    version: 5,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/005_task_execution.sql"),
  },
  {
    version: 6,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/006_status_approvals.sql"),
  },
  {
    version: 7,
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/007_search_index.sql"),
  },
];
const latestMigrationVersion = migrationFiles.at(-1)!.version;

function assertVersionOneDataCanUpgrade(db: Database.Database): void {
  const unownedPrivateConversation = db.prepare(`
    SELECT conversations.id
    FROM conversations
    LEFT JOIN pi_session_mappings
      ON pi_session_mappings.conversation_id = conversations.id
     AND pi_session_mappings.kind = 'private'
    WHERE conversations.kind = 'private'
    GROUP BY conversations.id
    HAVING COUNT(DISTINCT pi_session_mappings.contact_id) != 1
    LIMIT 1
  `).get();
  if (unownedPrivateConversation) {
    throw new Error(
      "Cannot migrate an unowned or ambiguously owned private conversation; assign one contact owner first",
    );
  }

  const nonMemberSession = db.prepare(`
    SELECT pi_session_mappings.id
    FROM pi_session_mappings
    LEFT JOIN task_members
      ON task_members.task_id = pi_session_mappings.task_id
     AND task_members.contact_id = pi_session_mappings.contact_id
    WHERE pi_session_mappings.kind = 'task'
      AND task_members.contact_id IS NULL
    LIMIT 1
  `).get();
  if (nonMemberSession) {
    throw new Error(
      "Cannot migrate a task-session mapping whose contact is not a task member",
    );
  }

  const duplicateTaskSession = db.prepare(`
    SELECT task_id, contact_id
    FROM pi_session_mappings
    WHERE task_id IS NOT NULL
    GROUP BY task_id, contact_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();
  if (duplicateTaskSession) {
    throw new Error("Cannot migrate duplicate task-session mappings for one contact");
  }

  const mismatchedRun = db.prepare(`
    SELECT runs.id
    FROM runs JOIN work_items
      ON work_items.id = runs.work_item_id
     AND work_items.task_id = runs.task_id
    WHERE work_items.contact_id != runs.contact_id
    LIMIT 1
  `).get();
  if (mismatchedRun) {
    throw new Error("Cannot migrate a run whose contact differs from its work item");
  }

  const mismatchedApproval = db.prepare(`
    SELECT approvals.id
    FROM approvals
    JOIN work_items
      ON work_items.id = approvals.work_item_id
     AND work_items.task_id = approvals.task_id
    JOIN pi_session_mappings
      ON pi_session_mappings.pi_session_id = approvals.pi_session_id
     AND pi_session_mappings.task_id = approvals.task_id
    WHERE work_items.contact_id != pi_session_mappings.contact_id
    LIMIT 1
  `).get();
  if (mismatchedApproval) {
    throw new Error(
      "Cannot migrate an approval whose work item and Pi session belong to different contacts",
    );
  }
}

function assertVersionTwoAttentionRequestsCanUpgrade(db: Database.Database): void {
  const mismatchedAttentionRequest = db.prepare(`
    SELECT attention_requests.id
    FROM attention_requests
    JOIN runs
      ON runs.id = attention_requests.run_id
     AND runs.task_id = attention_requests.task_id
    WHERE attention_requests.run_id IS NOT NULL
      AND runs.work_item_id != attention_requests.work_item_id
    LIMIT 1
  `).get();
  if (mismatchedAttentionRequest) {
    throw new Error(
      "Cannot migrate an attention request whose run belongs to a different work item",
    );
  }
}

export function openDatabase(databasePath: string): Database.Database {
  if (databasePath !== ":memory:" && !databasePath.startsWith("file:")) {
    const directory = path.dirname(path.resolve(databasePath));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (directory !== process.cwd()) chmodSync(directory, 0o700);
  }
  const db = new Database(databasePath);
  if (databasePath !== ":memory:" && !databasePath.startsWith("file:")) {
    chmodSync(databasePath, 0o600);
  }
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
  const latestAppliedMigration = db.prepare(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  ).get() as { version: number } | undefined;
  let currentVersion = latestAppliedMigration?.version ?? 0;
  if (currentVersion > latestMigrationVersion) {
    throw new Error(`Database schema version ${currentVersion} is newer than supported`);
  }
  for (const migration of migrationFiles) {
    if (migration.version <= currentVersion) continue;
    if (migration.version === 2 && currentVersion === 1) {
      assertVersionOneDataCanUpgrade(db);
    }
    if (migration.version === 3 && currentVersion === 2) {
      assertVersionTwoAttentionRequestsCanUpgrade(db);
    }
    const sql = readFileSync(migration.path, "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)")
        .run(migration.version);
    })();
    currentVersion = migration.version;
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
