import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";

test("stores a distinct durable run row for each work-item attempt", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const item = createWorkItemRepository(db).createWorkItem({
    id: "work-item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Build",
    status: "pending",
  });
  const repository = createRunRepository(db);
  const run1 = repository.createRun({
    id: "run-1",
    taskId: task.id,
    workItemId: item.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-15T10:00:00.000Z",
  });
  const run2 = repository.createRun({
    id: "run-2",
    taskId: task.id,
    workItemId: item.id,
    contactId: "contact-1",
    attempt: 2,
    status: "running",
    startedAt: "2026-10-15T10:01:00.000Z",
  });

  assert.equal(run1.workItemId, run2.workItemId);
  assert.deepEqual(repository.listRunsForWorkItem(item.id).map(({ id }) => id), ["run-1", "run-2"]);
  assert.equal(createWorkItemRepository(db).getWorkItem(item.id).status, "pending");
  assert.throws(() => repository.createRun({ ...run2, id: "duplicate-attempt" }), /unique|constraint/i);
  repository.updateRunStatus(run1.id, "completed", "2026-10-15T10:00:30.000Z");
  assert.equal(repository.getRun(run1.id).status, "completed");
  assert.throws(() => db.prepare(
    "UPDATE runs SET started_at = '2026-10-15T10:00:31.000Z' WHERE id = 'run-1'",
  ).run(), /immutable|identity/i);
});
