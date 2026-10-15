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
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  createMessageRepository(db).createConversation({
    id: "conversation-1",
    groupId: "group-1",
    taskId: task.id,
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
  assert.throws(() => repository.createSessionMapping({
    ...mapping,
    id: "mapping-other",
    piSessionId: "pi-session-2",
    taskId: "missing-task",
  }), /foreign key|constraint|scope/i);
  assert.throws(() => repository.createSessionMapping({
    ...mapping,
    id: "mapping-duplicate",
  }), /unique|constraint/i);
  createMessageRepository(db).createConversation({
    id: "private-conversation",
    groupId: null,
    taskId: null,
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
});
