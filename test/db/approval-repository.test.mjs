import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestDatabase,
  seedContact,
  seedProject,
} from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createApprovalRepository } from "../../src/server/db/repositories/approval-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";

test("persists approval decisions with exact task, work-item, session and tool-call scope", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  seedContact(db, "contact-2");
  const groupTasks = createGroupTaskRepository(db);
  groupTasks.addTaskMember(task.id, "contact-1");
  groupTasks.addTaskMember(task.id, "contact-2");
  const item = createWorkItemRepository(db).createWorkItem({
    id: "work-item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Build",
    status: "pending",
  });
  createMessageRepository(db).createConversation({
    id: "conversation-1",
    groupId: "group-1",
    taskId: task.id,
    contactId: null,
    kind: "task",
  });
  createMessageRepository(db).createConversation({
    id: "conversation-2",
    groupId: "group-1",
    taskId: task.id,
    contactId: null,
    kind: "task",
  });
  createSessionRepository(db).createSessionMapping({
    id: "mapping-1",
    contactId: "contact-1",
    taskId: task.id,
    conversationId: "conversation-1",
    kind: "task",
    piSessionId: "pi-session-1",
    sessionFile: "/sessions/session.jsonl",
  });
  createSessionRepository(db).createSessionMapping({
    id: "mapping-2",
    contactId: "contact-2",
    taskId: task.id,
    conversationId: "conversation-2",
    kind: "task",
    piSessionId: "pi-session-2",
    sessionFile: "/sessions/session-2.jsonl",
  });
  const repository = createApprovalRepository(db);
  const approval = repository.createApproval({
    id: "approval-1",
    taskId: task.id,
    workItemId: item.id,
    piSessionId: "pi-session-1",
    toolCallId: "tool-call-1",
    action: { tool: "write", path: "src/index.ts" },
    status: "pending",
    createdAt: "2026-10-15T10:00:00.000Z",
  });

  assert.deepEqual(repository.getApproval(approval.id), approval);
  assert.throws(() => db.prepare(`
    UPDATE work_items SET contact_id = 'contact-2'
    WHERE id = ?
  `).run(item.id), /contact|scope|immutable|constraint/i);
  assert.throws(() => repository.createApproval({
    ...approval,
    id: "wrong-task-approval",
    taskId: "another-task",
  }), /foreign key|scope|constraint|contact/i);
  assert.throws(() => repository.createApproval({
    ...approval,
    id: "wrong-contact-approval",
    piSessionId: "pi-session-2",
    toolCallId: "tool-call-2",
  }), /contact|scope|constraint/i);
  assert.throws(() => db.prepare(
    "UPDATE approvals SET action_json = '{\"tool\":\"shell\"}' WHERE id = 'approval-1'",
  ).run(), /immutable|scope/i);
  const decided = repository.updateApprovalStatus(approval.id, "approved", "2026-10-15T10:01:00.000Z");
  assert.equal(decided.status, "approved");
  assert.equal(decided.decidedAt, "2026-10-15T10:01:00.000Z");
});
