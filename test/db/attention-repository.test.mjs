import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createAttentionRepository } from "../../src/server/db/repositories/attention-repository.ts";

test("keeps attention requests open/resolvable independently of run and task status", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const item = createWorkItemRepository(db).createWorkItem({
    id: "item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Need a decision",
    status: "pending",
  });
  const runs = createRunRepository(db);
  const run = runs.createRun({
    id: "run-1",
    taskId: task.id,
    workItemId: item.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-15T10:00:00.000Z",
  });
  const repository = createAttentionRepository(db);
  const request = repository.createAttentionRequest({
    id: "attention-1",
    taskId: task.id,
    workItemId: item.id,
    runId: run.id,
    approvalId: null,
    kind: "input",
  });

  runs.updateRunStatus(run.id, "failed", "2026-10-15T10:01:00.000Z");
  assert.equal(repository.getAttentionRequest(request.id).status, "open");
  assert.equal(createGroupTaskRepository(db).getTask(task.id).status, "open");
  assert.equal(createWorkItemRepository(db).getWorkItem(item.id).status, "pending");

  const resolved = repository.resolveAttentionRequest(request.id, "resolved");
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolvedAt);
  assert.throws(
    () => repository.resolveAttentionRequest(request.id, "cancelled"),
    /open|not found|resolved/i,
  );
});

test("requires an approval ID only for approval-kind attention requests", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const item = createWorkItemRepository(db).createWorkItem({
    id: "item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Input",
    status: "pending",
  });

  assert.throws(() => createAttentionRepository(db).createAttentionRequest({
    id: "invalid-approval",
    taskId: task.id,
    workItemId: item.id,
    runId: null,
    approvalId: null,
    kind: "approval",
  }), /approval|constraint/i);
});

test("rejects an attention request pairing a work item with another member's run", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  seedContact(db, "contact-2");
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const workItems = createWorkItemRepository(db);
  const firstItem = workItems.createWorkItem({
    id: "item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "First member's work",
    status: "pending",
  });
  const secondItem = workItems.createWorkItem({
    id: "item-2",
    taskId: task.id,
    contactId: "contact-2",
    title: "Second member's work",
    status: "pending",
  });
  const runs = createRunRepository(db);
  const otherMemberRun = runs.createRun({
    id: "run-2",
    taskId: task.id,
    workItemId: secondItem.id,
    contactId: "contact-2",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-15T10:00:00.000Z",
  });

  assert.throws(() => createAttentionRepository(db).createAttentionRequest({
    id: "cross-member-attention",
    taskId: task.id,
    workItemId: firstItem.id,
    runId: otherMemberRun.id,
    approvalId: null,
    kind: "input",
  }), /foreign key|work item|scope|constraint/i);
});
