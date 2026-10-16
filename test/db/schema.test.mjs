import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";

test("migration creates the project and task persistence tables", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  let clientModule;
  try {
    clientModule = await import("../../src/server/db/client.ts");
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    assert.doesNotThrow(() => db.prepare("SELECT * FROM projects").all());
    return;
  }
  clientModule.migrate(db);
  assert.doesNotThrow(() => db.prepare("SELECT * FROM projects").all());
  assert.doesNotThrow(() => db.prepare("SELECT * FROM tasks").all());
  assert.doesNotThrow(() => db.prepare("SELECT * FROM run_completions").all());
  assert.doesNotThrow(() => db.prepare("SELECT * FROM attention_requests").all());
  assert.doesNotThrow(() => db.prepare("SELECT * FROM achat_event_cursors").all());
});
