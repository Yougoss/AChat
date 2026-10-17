import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createConversationListService } from "../../src/server/services/conversation-list-service.ts";

function addContact(db, id, name) {
  db.prepare(
    "INSERT INTO agents (id, model_provider, model_id) VALUES (?, 'test', 'model')",
  ).run(`agent-${id}`);
  db.prepare(
    "INSERT INTO contacts (id, agent_id, name, description) VALUES (?, ?, ?, '')",
  ).run(id, `agent-${id}`, name);
}

function addPrivateConversation(db, contactId, createdAt) {
  return createMessageRepository(db).createConversation({
    id: `private-${contactId}`,
    groupId: null,
    taskId: null,
    contactId,
    kind: "private",
    createdAt,
  });
}

function addMessage(db, { id, conversationId, content, createdAt, role = "user" }) {
  return createMessageRepository(db).appendMessage({
    id,
    conversationId,
    role,
    content,
    createdAt,
  });
}

test("orders private contacts and member task groups by their latest visible activity", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-ada");
  const privateConversation = addPrivateConversation(
    db,
    "contact-ada",
    "2026-10-16T08:00:00.000Z",
  );
  addMessage(db, {
    id: "private-latest",
    conversationId: privateConversation.id,
    content: "Private reply",
    role: "assistant",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  const { group, task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-ada");
  const taskConversation = createMessageRepository(db).createConversation({
    id: "task-conversation",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
    createdAt: "2026-10-16T08:30:00.000Z",
  });
  addMessage(db, {
    id: "task-latest",
    conversationId: taskConversation.id,
    content: "Task update",
    role: "assistant",
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const items = createConversationListService(db).listConversations();

  assert.deepEqual(items.map(({ kind, id, updatedAt }) => ({ kind, id, updatedAt })), [
    { kind: "task", id: group.id, updatedAt: "2026-10-16T10:00:00.000Z" },
    { kind: "contact", id: "contact-ada", updatedAt: "2026-10-16T09:00:00.000Z" },
  ]);
  assert.deepEqual(items.map(({ href }) => href), [
    "/groups/group-1",
    "/contacts/contact-ada",
  ]);
});

test("includes empty private and task conversations with blank previews and stable timestamps", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-empty");
  const privateConversation = addPrivateConversation(
    db,
    "contact-empty",
    "2026-10-16T08:10:00.000Z",
  );
  const { group, task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-empty");
  const taskUpdatedAt = db.prepare("SELECT updated_at AS updatedAt FROM tasks WHERE id = ?")
    .get(task.id).updatedAt;
  createMessageRepository(db).createConversation({
    id: "empty-task-conversation",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
    createdAt: "2026-10-16T08:20:00.000Z",
  });

  const items = createConversationListService(db).listConversations();
  const contactItem = items.find(({ kind }) => kind === "contact");
  const taskItem = items.find(({ kind }) => kind === "task");

  assert.equal(contactItem.preview, "");
  assert.equal(contactItem.updatedAt, privateConversation.createdAt);
  assert.equal(contactItem.avatarText, "B");
  assert.equal(contactItem.unreadCount, 0);
  assert.equal(taskItem.preview, "");
  assert.equal(taskItem.updatedAt, taskUpdatedAt);
  assert.equal(taskItem.avatarText, "P");
  assert.equal(taskItem.unreadCount, 0);
});

test("uses the latest message as each item's preview without crossing conversation scope", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-one");
  addContact(db, "contact-two", "Contact Two");
  const one = addPrivateConversation(db, "contact-one", "2026-10-16T08:00:00.000Z");
  const two = addPrivateConversation(db, "contact-two", "2026-10-16T08:00:00.000Z");
  addMessage(db, {
    id: "one-old",
    conversationId: one.id,
    content: "Old contact one message",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  addMessage(db, {
    id: "one-latest",
    conversationId: one.id,
    content: "Latest contact one reply",
    role: "assistant",
    createdAt: "2026-10-16T09:30:00.000Z",
  });
  addMessage(db, {
    id: "two-secret",
    conversationId: two.id,
    content: "Private message for contact two",
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const items = createConversationListService(db).listConversations();
  const contactOne = items.find(({ id }) => id === "contact-one");
  const contactTwo = items.find(({ id }) => id === "contact-two");

  assert.equal(contactOne.preview, "Latest contact one reply");
  assert.equal(contactOne.updatedAt, "2026-10-16T09:30:00.000Z");
  assert.equal(contactTwo.preview, "Private message for contact two");
  assert.doesNotMatch(contactOne.preview, /contact two/i);
});

test("uses only the private and task conversations selected by their existing routes", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-scoped");
  const messages = createMessageRepository(db);
  const privatePrimary = messages.createConversation({
    id: "private-a",
    groupId: null,
    taskId: null,
    contactId: "contact-scoped",
    kind: "private",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  const privateOther = messages.createConversation({
    id: "private-z",
    groupId: null,
    taskId: null,
    contactId: "contact-scoped",
    kind: "private",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  addMessage(db, {
    id: "primary-private-message",
    conversationId: privatePrimary.id,
    content: "Visible private conversation",
    createdAt: "2026-10-16T08:10:00.000Z",
  });
  addMessage(db, {
    id: "other-private-message",
    conversationId: privateOther.id,
    content: "Do not leak the alternate private conversation",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
  const { group, task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-scoped");
  const taskPrimary = messages.createConversation({
    id: "task-conversation-primary",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  const taskOther = messages.createConversation({
    id: "task-conversation-other",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  addMessage(db, {
    id: "primary-task-message",
    conversationId: taskPrimary.id,
    content: "Visible task conversation",
    createdAt: "2026-10-16T08:10:00.000Z",
  });
  addMessage(db, {
    id: "other-task-message",
    conversationId: taskOther.id,
    content: "Do not leak the alternate task conversation",
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const items = createConversationListService(db).listConversations();
  const contactItem = items.find(({ kind }) => kind === "contact");
  const taskItem = items.find(({ kind }) => kind === "task");

  assert.equal(contactItem.preview, "Visible private conversation");
  assert.equal(taskItem.preview, "Visible task conversation");
  assert.doesNotMatch(JSON.stringify(items), /alternate private|alternate task/);
});

test("counts unread task completions and excludes tasks without members", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-member");
  const { group, task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-member");
  const { group: orphanGroup, task: orphanTask } =
    createGroupTaskRepository(db).createGroupWithTask({
      group: { id: "orphan-group", name: "Unassigned secret", description: "" },
      task: {
        id: "orphan-task",
        projectId: "project-1",
        description: "Only visible to task members",
        status: "open",
      },
    });
  const createdAt = "2026-10-16T10:00:00.000Z";
  db.prepare(`
    INSERT INTO work_items (id, task_id, contact_id, title, status)
    VALUES ('work-1', ?, 'contact-member', 'Review', 'running')
  `).run(task.id);
  db.prepare(`
    INSERT INTO runs (
      id, task_id, work_item_id, contact_id, attempt, status, started_at
    ) VALUES ('run-1', ?, 'work-1', 'contact-member', 1, 'running', ?)
  `).run(task.id, createdAt);
  db.prepare("UPDATE runs SET status = 'completed', completed_at = ? WHERE id = 'run-1'")
    .run(createdAt);

  const items = createConversationListService(db).listConversations();

  assert.equal(items.find(({ id }) => id === group.id).unreadCount, 1);
  assert.equal(items.some(({ id }) => id === orphanGroup.id || id === orphanTask.id), false);
  assert.doesNotMatch(JSON.stringify(items), /Only visible to task members|Unassigned secret/);
});
