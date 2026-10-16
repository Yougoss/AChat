import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createDatabaseLifecycle,
  migrate,
  openDatabase,
} from "../../src/server/db/client.ts";

test("database lifecycle defers opening until start and closes on stop", async () => {
  const lifecycle = createDatabaseLifecycle(":memory:");
  assert.throws(() => lifecycle.getDatabase(), /start/i);

  const startResult = lifecycle.start();
  assert.ok(startResult instanceof Promise);
  await startResult;
  const db = lifecycle.getDatabase();
  assert.equal(
    db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get().version,
    7,
  );

  await lifecycle.stop();
  assert.equal(db.open, false);
  assert.throws(() => lifecycle.getDatabase(), /start/i);
});

test("openDatabase enables foreign keys and migrations are repeatable", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());

  migrate(db);
  migrate(db);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
      .map(({ version }) => version),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

test("migration 007 indexes existing and future visible rows but not provider traces", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  for (const version of [1, 2, 3, 4, 5, 6]) {
    const migration = String(version).padStart(3, "0");
    db.exec(readFileSync(
      new URL(`../../src/server/db/migrations/${migration}_${
        [
          "initial",
          "contact_unread_boundaries",
          "attention_run_work_item_scope",
          "trace_capture",
          "task_execution",
          "status_approvals",
        ][version - 1]
      }.sql`, import.meta.url),
      "utf8",
    ));
  }
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO schema_migrations (version) VALUES (1), (2), (3), (4), (5), (6);
    INSERT INTO agents (id, model_provider, model_id) VALUES ('agent-search', 'test', 'model');
    INSERT INTO contacts (id, agent_id, name, description)
      VALUES ('contact-search', 'agent-search', 'Legacy name token', 'Legacy description token');
    INSERT INTO projects (id, name, root_path) VALUES ('project-search', 'Search', '/legacy-search');
    INSERT INTO groups (id, name, description)
      VALUES ('group-search', 'Legacy group token', 'Legacy group description');
    INSERT INTO tasks (id, group_id, project_id, description, status)
      VALUES ('task-search', 'group-search', 'project-search', 'Legacy task token', 'open');
    INSERT INTO task_members (task_id, contact_id) VALUES ('task-search', 'contact-search');
    INSERT INTO conversations (id, group_id, task_id, kind)
      VALUES ('task-conversation', 'group-search', 'task-search', 'task');
    INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES ('legacy-message', 'task-conversation', 'user', 'Legacy visible body token',
        '2026-10-16T10:00:00.000Z');
    INSERT INTO conversations (id, contact_id, kind)
      VALUES ('private-conversation', 'contact-search', 'private');
    INSERT INTO pi_session_mappings (
      id, contact_id, task_id, conversation_id, kind, pi_session_id, session_file
    ) VALUES (
      'mapping-search', 'contact-search', NULL, 'private-conversation', 'private',
      'pi-session-search', '/sessions/search.jsonl'
    );
    INSERT INTO trace_records (id, mapping_id, type, payload_json)
      VALUES ('provider-trace', 'mapping-search', 'provider_event',
        '{"content":"provider-only secret token"}');
  `);

  const { migrate } = await import("../../src/server/db/client.ts");
  migrate(db);

  const indexMatches = (term) => db.prepare(`
    SELECT COUNT(*) AS count FROM search_documents_fts WHERE search_documents_fts MATCH ?
  `).get(term).count;
  assert.equal(indexMatches('"Legacy"'), 3);
  assert.equal(indexMatches('"visible"'), 1);
  assert.equal(indexMatches('"provider-only"'), 0);
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at)
    VALUES ('future-message', 'task-conversation', 'assistant', 'Future visible body token',
      '2026-10-16T10:01:00.000Z')
  `).run();
  assert.equal(indexMatches('"Future"'), 1);
});

test("stores trace-capable database files under owner-only directory and file permissions", (t) => {
  const directory = path.join(process.cwd(), "test", `.trace-permissions-${process.pid}`);
  const databasePath = path.join(directory, "achat.sqlite");
  rmSync(directory, { recursive: true, force: true });
  const db = openDatabase(databasePath);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(databasePath).mode & 0o777, 0o600);
});

test("upgrades version-one ownership and run data into current schema boundaries", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(
    new URL("../../src/server/db/migrations/001_initial.sql", import.meta.url),
    "utf8",
  ));
  db.exec(`
    INSERT INTO agents (id, model_provider, model_id) VALUES ('agent-1', 'test', 'model');
    INSERT INTO contacts (id, agent_id, name) VALUES ('contact-1', 'agent-1', 'Builder');
    INSERT INTO projects (id, name, root_path) VALUES ('project-1', 'AChat', '/workspace');
    INSERT INTO groups (id, name) VALUES ('group-1', 'Planning');
    INSERT INTO tasks (id, group_id, project_id, description, status)
      VALUES ('task-1', 'group-1', 'project-1', 'Build', 'open');
    INSERT INTO work_items (id, task_id, contact_id, title, status)
      VALUES ('item-1', 'task-1', 'contact-1', 'Build', 'complete');
    INSERT INTO runs (
      id, task_id, work_item_id, contact_id, attempt, status, started_at, completed_at
    ) VALUES (
      'run-1', 'task-1', 'item-1', 'contact-1', 1, 'completed',
      '2026-10-15T10:00:00.000Z', '2026-10-15T10:01:00.000Z'
    );
    INSERT INTO conversations (id, kind) VALUES ('private-1', 'private');
    INSERT INTO pi_session_mappings (
      id, contact_id, task_id, conversation_id, kind, pi_session_id, session_file
    ) VALUES (
      'mapping-1', 'contact-1', NULL, 'private-1', 'private',
      'session-1', '/sessions/session-1.jsonl'
    );
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO schema_migrations (version) VALUES (1);
  `);

  const { migrate } = await import("../../src/server/db/client.ts");
  migrate(db);
  migrate(db);

  assert.deepEqual(
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
      .map(({ version }) => version),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(
    db.prepare("SELECT contact_id AS contactId FROM conversations WHERE id = 'private-1'").get().contactId,
    "contact-1",
  );
  assert.deepEqual(
    db.prepare(`
      SELECT run_id AS runId, task_id AS taskId, group_id AS groupId, completed_at AS completedAt
      FROM run_completions
    `).get(),
    {
      runId: "run-1",
      taskId: "task-1",
      groupId: "group-1",
      completedAt: "2026-10-15T10:01:00.000Z",
    },
  );
});

test("refuses to upgrade a v2 database with an attention request scoped to another work item's run", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(
    new URL("../../src/server/db/migrations/001_initial.sql", import.meta.url),
    "utf8",
  ));
  db.exec(readFileSync(
    new URL("../../src/server/db/migrations/002_contact_unread_boundaries.sql", import.meta.url),
    "utf8",
  ));
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO schema_migrations (version) VALUES (1), (2);
    INSERT INTO agents (id, model_provider, model_id)
      VALUES ('agent-1', 'test', 'model'), ('agent-2', 'test', 'model');
    INSERT INTO contacts (id, agent_id, name)
      VALUES ('contact-1', 'agent-1', 'Builder'), ('contact-2', 'agent-2', 'Reviewer');
    INSERT INTO projects (id, name, root_path) VALUES ('project-1', 'AChat', '/workspace');
    INSERT INTO groups (id, name) VALUES ('group-1', 'Planning');
    INSERT INTO tasks (id, group_id, project_id, description, status)
      VALUES ('task-1', 'group-1', 'project-1', 'Build', 'open');
    INSERT INTO work_items (id, task_id, contact_id, title, status)
      VALUES
        ('item-1', 'task-1', 'contact-1', 'First work', 'pending'),
        ('item-2', 'task-1', 'contact-2', 'Second work', 'pending');
    INSERT INTO runs (
      id, task_id, work_item_id, contact_id, attempt, status, started_at
    ) VALUES (
      'run-2', 'task-1', 'item-2', 'contact-2', 1, 'running', '2026-10-15T10:00:00.000Z'
    );
    INSERT INTO attention_requests (
      id, task_id, work_item_id, run_id, approval_id, kind, status, created_at, resolved_at
    ) VALUES (
      'attention-1', 'task-1', 'item-1', 'run-2', NULL, 'input', 'open',
      '2026-10-15T10:00:00.000Z', NULL
    );
  `);

  assert.throws(
    () => migrate(db),
    /attention request whose run belongs to a different work item/i,
  );
  assert.deepEqual(
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
      .map(({ version }) => version),
    [1, 2],
  );
});

test("database module imports without opening a database", async () => {
  const dataDir = path.join(process.cwd(), "test", "db", `.import-side-effect-${process.pid}`);
  assert.equal(existsSync(dataDir), false);
  const previousDataDir = process.env.ACHAT_DATA_DIR;
  process.env.ACHAT_DATA_DIR = dataDir;
  try {
    const clientModule = await import(
      `../../src/server/db/client.ts?no-import-io=${process.pid}`
    );
    assert.equal(typeof clientModule.createDatabaseLifecycle, "function");
    assert.ok(Database);
    assert.equal(existsSync(dataDir), false);
  } finally {
    if (previousDataDir === undefined) delete process.env.ACHAT_DATA_DIR;
    else process.env.ACHAT_DATA_DIR = previousDataDir;
  }
});

test("database migrations do not depend on the global URL constructor", async () => {
  const NativeURL = globalThis.URL;
  globalThis.URL = class BundledURL {
    constructor(url, base) {
      this.href = new NativeURL(url, base).href;
    }
  };
  let clientModule;
  try {
    clientModule = await import(
      `../../src/server/db/client.ts?url-constructor=${process.pid}`
    );
  } finally {
    globalThis.URL = NativeURL;
  }
  const db = new Database(":memory:");
  try {
    clientModule.migrate(db);
    assert.equal(
      db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
      7,
    );
  } finally {
    db.close();
  }
});
