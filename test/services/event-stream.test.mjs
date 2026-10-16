import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedProject } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createEventStreamService, subscribeEvents } from "../../src/server/services/event-stream.ts";

function append(repository, id, type) {
  return repository.appendEvent({
    id,
    entityType: "run",
    entityId: "run-1",
    type,
    payload: { taskId: "task-1", runId: "run-1" },
    idempotencyKey: id,
    createdAt: "2026-10-16T02:00:00.000Z",
  });
}

test("appendAchatEvent returns its durable cursor before subscribers receive the event", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const stream = createEventStreamService(db);
  const cursor = stream.appendAchatEvent({
    id: "durable-before-delivery",
    entityType: "task",
    entityId: "task-1",
    type: "task.notice",
    payload: { taskId: "task-1" },
    idempotencyKey: "task-notice",
  });
  assert.equal(typeof cursor, "number");
  assert.equal(cursor, 1);
  const iterator = stream.subscribeEvents(0)[Symbol.asyncIterator]();
  const replayed = await iterator.next();
  assert.equal(replayed.value.cursor, cursor);
  await iterator.return();
});

test("replays persisted events after disconnect and streams later persisted events without a gap", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const events = createEventRepository(db);
  const first = append(events, "event-1", "run.started");

  const firstConnection = subscribeEvents(db, 0)[Symbol.asyncIterator]();
  assert.equal((await firstConnection.next()).value.id, "event-1");
  await firstConnection.return();

  const secondConnection = subscribeEvents(db, first.cursor)[Symbol.asyncIterator]();
  const waiting = secondConnection.next();
  const second = append(events, "event-2", "run.completed");
  const replayed = await waiting;
  assert.equal(replayed.value.id, "event-2");
  assert.ok(replayed.value.cursor > first.cursor);
  await secondConnection.return();

  const reconnect = subscribeEvents(db, first.cursor)[Symbol.asyncIterator]();
  assert.equal((await reconnect.next()).value.id, second.id);
  await reconnect.return();
});

test("aborting a subscription only unsubscribes and does not remove durable events", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const events = createEventRepository(db);
  append(events, "event-1", "run.started");
  const abort = new AbortController();
  const connection = subscribeEvents(db, 0, abort.signal)[Symbol.asyncIterator]();
  assert.equal((await connection.next()).value.id, "event-1");
  abort.abort();
  assert.equal((await connection.next()).done, true);
  assert.deepEqual(events.listEventsForEntity("run", "run-1").map(({ id }) => id), ["event-1"]);
});
