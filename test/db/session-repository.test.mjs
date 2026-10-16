import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";

test("maps agent contacts to private and task Pi sessions with scoped IDs", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  seedContact(db, "contact-2");
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const groupTasks = createGroupTaskRepository(db);
  groupTasks.addTaskMember(task.id, "contact-1");
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
  const repository = createSessionRepository(db);
  const mapping = repository.createSessionMapping({
    id: "mapping-1",
    contactId: "contact-1",
    taskId: task.id,
    conversationId: "conversation-1",
    kind: "task",
    piSessionId: "pi-session-1",
    sessionFile: "/sessions/session.jsonl",
  });

  assert.deepEqual(repository.getSessionMappingByPiSessionId("pi-session-1"), mapping);
  assert.throws(() => createMessageRepository(db).createConversation({
    id: "private-conversation-without-owner",
    groupId: null,
    taskId: null,
    contactId: null,
    kind: "private",
  }), /owner|constraint/i);
  assert.throws(() => repository.createSessionMapping({
    ...mapping,
    id: "mapping-other",
    piSessionId: "pi-session-2",
    taskId: "missing-task",
  }), /foreign key|constraint|scope/i);
  assert.throws(() => repository.createSessionMapping({
    ...mapping,
    id: "mapping-duplicate",
    conversationId: "conversation-2",
    piSessionId: "pi-session-duplicate",
  }), /unique|constraint/i);
  assert.throws(() => repository.createSessionMapping({
    ...mapping,
    id: "mapping-non-member",
    contactId: "contact-2",
    conversationId: "conversation-2",
    piSessionId: "pi-session-non-member",
  }), /foreign key|constraint|member/i);
  createMessageRepository(db).createConversation({
    id: "private-conversation",
    groupId: null,
    taskId: null,
    contactId: "contact-1",
    kind: "private",
  });
  assert.equal(repository.createSessionMapping({
    id: "private-mapping",
    contactId: "contact-1",
    taskId: null,
    conversationId: "private-conversation",
    kind: "private",
    piSessionId: "private-session",
    sessionFile: "/sessions/private.jsonl",
  }).taskId, null);
  assert.throws(() => repository.createSessionMapping({
    id: "private-other-owner",
    contactId: "contact-2",
    taskId: null,
    conversationId: "private-conversation",
    kind: "private",
    piSessionId: "private-other-owner-session",
    sessionFile: "/sessions/private-other.jsonl",
  }), /owner|scope|constraint/i);
  assert.throws(() => db.prepare(`
    UPDATE conversations SET contact_id = 'contact-2'
    WHERE id = 'private-conversation'
  `).run(), /owner|immutable|scope|constraint/i);
});
