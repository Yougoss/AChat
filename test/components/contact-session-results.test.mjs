import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ContactSessionResults } from "../../src/components/ContactSessionResults.tsx";
import { createTestDatabase, seedContact, seedProject } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";

test("renders source-attributed task evidence and a cursor-based load-more control", () => {
  const html = renderToStaticMarkup(React.createElement(ContactSessionResults, {
    contactId: "contact-1",
    items: [{
      taskId: "task-1",
      groupId: "group-1",
      title: "Review release notes",
      status: "completed",
      lastActivity: "2026-10-16T10:00:00.000Z",
      sessionRefs: ["pi-session-1"],
    }],
    nextCursor: "next-page",
  }));

  assert.match(html, /Evidence from your sessions/);
  assert.match(html, /Review release notes/);
  assert.match(html, /Source: task task-1/);
  assert.match(html, /Load more results/);
  assert.match(html, /pi-session-1/);
});

test("loads task evidence newest first across cursor pages and excludes another contact's tasks", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-1");
  seedContact(db, "contact-2");
  const taskRepo = createGroupTaskRepository(db);
  const messageRepo = createMessageRepository(db);
  const sessionRepo = createSessionRepository(db);

  function addTask(id, contactId, createdAt) {
    const { group, task } = taskRepo.createGroupWithTask({
      group: { id: `group-${id}`, name: id, description: id },
      task: { id: `task-${id}`, projectId: "project-1", description: id, status: "completed" },
    });
    taskRepo.addTaskMember(task.id, contactId);
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(createdAt, task.id);
    const conversation = messageRepo.createConversation({
      id: `conversation-${id}`,
      groupId: group.id,
      taskId: task.id,
      contactId: null,
      kind: "task",
    });
    sessionRepo.createSessionMapping({
      id: `mapping-${id}`,
      contactId,
      taskId: task.id,
      conversationId: conversation.id,
      kind: "task",
      piSessionId: `pi-${id}`,
      sessionFile: `test/sessions/${id}.jsonl`,
      createdAt,
    });
  }

  addTask("older", "contact-1", "2026-10-15T10:00:00.000Z");
  addTask("newer", "contact-1", "2026-10-16T10:00:00.000Z");
  addTask("private-to-other", "contact-2", "2026-10-17T10:00:00.000Z");
  const service = createTraceQueryService(db);

  const firstPage = await service.listContactTasks("contact-1", { limit: 1 });
  const secondPage = await service.listContactTasks("contact-1", {
    cursor: firstPage.nextCursor,
    limit: 1,
  });

  assert.equal(firstPage.items[0].title, "newer");
  assert.equal(secondPage.items[0].title, "older");
  assert.deepEqual(firstPage.items[0].sessionRefs, ["pi-newer"]);
  assert.deepEqual(secondPage.items[0].sessionRefs, ["pi-older"]);
  assert.doesNotMatch(JSON.stringify([firstPage, secondPage]), /private-to-other|pi-private-to-other/);
});
