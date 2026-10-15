import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";

test("stores ordered application events and scopes idempotency keys by entity", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const repository = createEventRepository(db);
  repository.appendEvent({
    id: "event-1",
    entityType: "task",
    entityId: task.id,
    type: "task.created",
    payload: { value: 1 },
    idempotencyKey: "same-key",
    createdAt: "2026-10-15T10:00:00.000Z",
  });
  repository.appendEvent({
    id: "event-2",
    entityType: "task",
    entityId: "task-other",
    type: "task.updated",
    payload: { value: 2 },
    idempotencyKey: "same-key",
    createdAt: "2026-10-15T10:00:00.000Z",
  });

  assert.deepEqual(repository.listEventsForEntity("task", task.id).map(({ id }) => id), ["event-1"]);
  assert.throws(() => repository.appendEvent({
    id: "event-replay-conflict",
    entityType: "task",
    entityId: task.id,
    type: "task.updated",
    payload: { value: 3 },
    idempotencyKey: "same-key",
  }), /idempotency|conflict/i);
  assert.throws(() => db.prepare(
    "UPDATE events SET type = 'changed' WHERE id = 'event-1'",
  ).run(), /append.only|immutable/i);

  const taskEvent = repository.appendTaskEvent({
    id: "task-event-1",
    taskId: task.id,
    type: "task.ready",
    payload: { value: 4 },
    idempotencyKey: "task-ready-1",
  });
  assert.equal(taskEvent.taskId, task.id);
});
