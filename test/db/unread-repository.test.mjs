import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createUnreadRepository } from "../../src/server/db/repositories/unread-repository.ts";

test("counts completed runs after a group-only cursor, independent of message reads", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const groups = createGroupTaskRepository(db);
  const first = groups.createGroupWithTask({
    group: { id: "group-1", name: "One", description: "" },
    task: { id: "task-1", projectId: "project-1", description: "One", status: "open" },
  });
  const second = groups.createGroupWithTask({
    group: { id: "group-2", name: "Two", description: "" },
    task: { id: "task-2", projectId: "project-1", description: "Two", status: "open" },
  });
  const workItems = createWorkItemRepository(db);
  const item1 = workItems.createWorkItem({
    id: "item-1",
    taskId: first.task.id,
    contactId: "contact-1",
    title: "First",
    status: "pending",
  });
  const item2 = workItems.createWorkItem({
    id: "item-2",
    taskId: second.task.id,
    contactId: "contact-1",
    title: "Second",
    status: "pending",
  });
  const runs = createRunRepository(db);
  const run1 = runs.createRun({
    id: "run-1",
    taskId: first.task.id,
    workItemId: item1.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-15T10:00:00.000Z",
  });
  const run2 = runs.createRun({
    id: "run-2",
    taskId: second.task.id,
    workItemId: item2.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-15T10:01:00.000Z",
  });
  const failedRun = runs.createRun({
    id: "run-failed",
    taskId: first.task.id,
    workItemId: item1.id,
    contactId: "contact-1",
    attempt: 2,
    status: "running",
    startedAt: "2026-10-15T10:01:30.000Z",
  });
  runs.updateRunStatus(failedRun.id, "failed", "2026-10-15T10:01:45.000Z");
  const unread = createUnreadRepository(db);

  assert.equal(unread.countUnreadRuns(first.group.id), 0);
  assert.equal(unread.countUnreadRuns(second.group.id), 0);
  assert.equal(runs.getRun(failedRun.id).status, "failed");
  assert.equal(unread.listRunCompletions(first.group.id).length, 0);
  runs.completeRun(run1.id, "2026-10-15T10:02:00.000Z");
  assert.equal(unread.countUnreadRuns(first.group.id), 1);
  assert.equal(unread.countUnreadRuns(second.group.id), 0);
  runs.completeRun(run2.id, "2026-10-15T10:03:00.000Z");
  const completionCursors = unread.listRunCompletions()
    .map(({ cursor }) => cursor);
  assert.ok(completionCursors[1] > completionCursors[0]);

  const conversation = createMessageRepository(db).createConversation({
    id: "conversation-1",
    groupId: first.group.id,
    taskId: first.task.id,
    contactId: null,
    kind: "task",
  });
  db.prepare(`
    INSERT INTO unread_cursors (contact_id, conversation_id, updated_at)
    VALUES (?, ?, ?)
  `).run("contact-1", conversation.id, "2026-10-15T10:04:00.000Z");
  assert.equal(unread.countUnreadRuns(first.group.id), 1);

  unread.markGroupRunsRead(second.group.id);
  assert.equal(unread.countUnreadRuns(second.group.id), 0);
  assert.equal(unread.countUnreadRuns(first.group.id), 1);
  unread.markGroupRunsRead(first.group.id);
  assert.equal(unread.countUnreadRuns(first.group.id), 0);
});
