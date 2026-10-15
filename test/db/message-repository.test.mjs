import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";

test("returns conversation messages in stable creation order", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  const { group, task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const repository = createMessageRepository(db);
  const conversation = repository.createConversation({
    id: "conversation-1",
    groupId: group.id,
    taskId: task.id,
    kind: "task",
  });
  repository.appendMessage({
    id: "message-2",
    conversationId: conversation.id,
    role: "assistant",
    content: "Second",
    createdAt: "2026-10-15T10:00:02.000Z",
  });
  repository.appendMessage({
    id: "message-1",
    conversationId: conversation.id,
    role: "user",
    content: "First",
    createdAt: "2026-10-15T10:00:01.000Z",
  });

  assert.deepEqual(repository.listMessages(conversation.id).map(({ id }) => id), ["message-1", "message-2"]);
});
