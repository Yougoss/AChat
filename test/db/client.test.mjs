import assert from "node:assert/strict";
import Database from "better-sqlite3";
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
  assert.equal(db.prepare("SELECT version FROM schema_migrations").get().version, 1);

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
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 1);
});

test("database module imports without opening a database", async () => {
  const clientModule = await import("../../src/server/db/client.ts");
  assert.equal(typeof clientModule.createDatabaseLifecycle, "function");
  assert.ok(Database);
});
