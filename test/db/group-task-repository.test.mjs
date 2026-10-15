import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestDatabase,
  seedContact,
  seedProject,
} from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";

test("creates a group and its project-backed task atomically", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  const repository = createGroupTaskRepository(db);

  const result = repository.createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: {
      id: "task-1",
      projectId: "project-1",
      description: "Implement schema",
      status: "open",
    },
  });

  assert.deepEqual(result, {
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: {
      id: "task-1",
      groupId: "group-1",
      projectId: "project-1",
      description: "Implement schema",
      status: "open",
    },
  });
  assert.equal(repository.getTaskByGroupId("group-1").id, "task-1");
});

test("rolls back the group when task creation fails its project constraint", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const repository = createGroupTaskRepository(db);

  assert.throws(() => repository.createGroupWithTask({
    group: { id: "group-failed", name: "Orphan", description: "Will roll back" },
    task: {
      id: "task-failed",
      projectId: "missing-project",
      description: "Invalid project",
      status: "open",
    },
  }), /foreign key|constraint/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM groups").get().count, 0);
});

test("enforces one task per group and persists group membership", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const repository = createGroupTaskRepository(db);
  repository.createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });

  repository.addGroupMember("group-1", "contact-1");
  assert.deepEqual(repository.listGroupMembers("group-1"), ["contact-1"]);
  assert.throws(() => db.prepare(
    "INSERT INTO tasks (id, group_id, project_id, description, status) VALUES (?, ?, ?, ?, ?)",
  ).run("task-2", "group-1", "project-1", "Second task", "open"), /unique|constraint/i);
  assert.throws(() => db.prepare(
    "INSERT INTO tasks (id, group_id, project_id, description, status) VALUES (?, ?, ?, ?, ?)",
  ).run("task-no-group", null, "project-1", "Task without group", "open"), /not null|constraint/i);
});

test("appends task events idempotently and preserves append-only ordering", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const repository = createGroupTaskRepository(db);
  const first = repository.appendTaskEvent({
    id: "event-1",
    taskId: task.id,
    type: "task.created",
    payload: { status: "open" },
    idempotencyKey: "create-1",
    createdAt: "2026-10-15T10:00:00.000Z",
  });
  const replay = repository.appendTaskEvent({
    id: "different-event-id",
    taskId: task.id,
    type: "task.created",
    payload: { status: "open" },
    idempotencyKey: "create-1",
    createdAt: "2026-10-15T10:00:01.000Z",
  });
  repository.appendTaskEvent({
    id: "event-2",
    taskId: task.id,
    type: "task.updated",
    payload: { status: "working" },
    idempotencyKey: "update-1",
    createdAt: "2026-10-15T10:00:02.000Z",
  });

  assert.deepEqual(replay, first);
  assert.deepEqual(repository.listTaskEvents(task.id).map(({ id }) => id), ["event-1", "event-2"]);
  assert.throws(() => db.prepare("UPDATE task_events SET type = 'changed' WHERE id = 'event-1'").run(), /append.only|immutable|trigger/i);
});
