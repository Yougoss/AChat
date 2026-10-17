import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { migrate, openDatabase } from "../../src/server/db/client.ts";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { GET } from "../../src/app/api/conversations/route.ts";

test("GET /api/conversations returns the scoped conversation item contract", async (t) => {
  const previousDataDir = process.env.ACHAT_DATA_DIR;
  const dataDir = path.join(process.cwd(), ".test-support", `conversation-route-${process.pid}`);
  mkdirSync(dataDir, { recursive: true });
  process.env.ACHAT_DATA_DIR = dataDir;
  t.after(() => {
    if (previousDataDir === undefined) delete process.env.ACHAT_DATA_DIR;
    else process.env.ACHAT_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const db = openDatabase(path.join(dataDir, "achat.sqlite"));
  migrate(db);
  seedProject(db);
  seedContact(db, "contact-1");
  seedContact(db, "contact-2");
  db.prepare("UPDATE agents SET created_at = '2026-10-16T07:00:00.000Z' WHERE id = 'contact-2'").run();
  const messages = createMessageRepository(db);
  const privateConversation = messages.createConversation({
    id: "private-1",
    groupId: null,
    taskId: null,
    contactId: "contact-1",
    kind: "private",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  messages.appendMessage({
    id: "private-message",
    conversationId: privateConversation.id,
    role: "assistant",
    content: "Private preview",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  const { group, task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-1");
  const taskConversation = messages.createConversation({
    id: "task-conversation",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
  });
  messages.appendMessage({
    id: "task-message",
    conversationId: taskConversation.id,
    role: "assistant",
    content: "Task preview",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
  db.close();

  const response = await GET(new Request("http://localhost/api/conversations"));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items.map(({ kind, id, href, preview }) => ({
    kind,
    id,
    href,
    preview,
  })), [
    {
      kind: "task",
      id: "group-1",
      href: "/groups/group-1",
      preview: "Task preview",
    },
    {
      kind: "contact",
      id: "contact-1",
      href: "/contacts/contact-1",
      preview: "Private preview",
    },
    {
      kind: "contact",
      id: "contact-2",
      href: "/contacts/contact-2",
      preview: "",
    },
  ]);
  for (const item of body.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "avatarText",
      "href",
      "id",
      "kind",
      "preview",
      "title",
      "unreadCount",
      "updatedAt",
    ]);
  }
  assert.doesNotMatch(JSON.stringify(body), /task-1|Build persistence/);
});
