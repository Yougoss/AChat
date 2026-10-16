import assert from "node:assert/strict";
import test from "node:test";
import { createTraceExtension } from "../../src/server/pi/trace-extension.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";
import { createTestDatabase, seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";

function seedTaskSession(db, { contactId, suffix, createdAt, taskId = "task-1" }) {
  const groupId = taskId === "task-1" ? "group-1" : "group-2";
  createMessageRepository(db).createConversation({
    id: `conversation-${suffix}`,
    groupId,
    taskId,
    contactId: null,
    kind: "task",
  });
  return createSessionRepository(db).createSessionMapping({
    id: `mapping-${suffix}`,
    contactId,
    taskId,
    conversationId: `conversation-${suffix}`,
    kind: "task",
    piSessionId: `pi-${suffix}`,
    sessionFile: `/private/${suffix}.jsonl`,
    createdAt,
  });
}

function seedTasksAndContacts(db) {
  seedProject(db);
  seedContact(db);
  seedContact(db, "contact-2");
  const { task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-1");
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-2");
  const { task: secondTask } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-2", name: "Later", description: "Later group" },
    task: { id: "task-2", projectId: "project-1", description: "Later task", status: "open" },
  });
  createGroupTaskRepository(db).addTaskMember(secondTask.id, "contact-1");
}

test("lists contact-owned private and group sessions newest first with cursor pagination", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedTasksAndContacts(db);
  createMessageRepository(db).createConversation({
    id: "private-contact-1",
    groupId: null,
    taskId: null,
    contactId: "contact-1",
    kind: "private",
  });
  createSessionRepository(db).createSessionMapping({
    id: "mapping-private-1",
    contactId: "contact-1",
    taskId: null,
    conversationId: "private-contact-1",
    kind: "private",
    piSessionId: "pi-private-1",
    sessionFile: "/private/contact-1.jsonl",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  seedTaskSession(db, {
    contactId: "contact-1",
    suffix: "newer-task",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  seedTaskSession(db, {
    contactId: "contact-2",
    suffix: "other-contact",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
  seedTaskSession(db, {
    contactId: "contact-1",
    suffix: "old-task",
    createdAt: "2026-10-16T07:00:00.000Z",
    taskId: "task-2",
  });

  const query = createTraceQueryService(db);
  const first = await query.listContactSessions("contact-1", { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.sessionRef), ["pi-newer-task", "pi-private-1"]);
  assert.ok(first.nextCursor);
  const second = await query.listContactSessions("contact-1", { cursor: first.nextCursor, limit: 2 });
  assert.deepEqual(second.items.map((item) => item.sessionRef), ["pi-old-task"]);
  assert.equal(second.nextCursor, null);
});

test("lists newest task summaries and maps only the requesting contact's task sessions", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedTasksAndContacts(db);
  seedTaskSession(db, { contactId: "contact-1", suffix: "contact-1-task-1", createdAt: "2026-10-16T08:00:00.000Z" });
  seedTaskSession(db, { contactId: "contact-2", suffix: "contact-2-task-1", createdAt: "2026-10-16T10:00:00.000Z" });
  seedTaskSession(db, { contactId: "contact-1", suffix: "contact-1-task-2", createdAt: "2026-10-16T09:00:00.000Z", taskId: "task-2" });

  const query = createTraceQueryService(db);
  const firstPage = await query.listContactTasks("contact-1", { limit: 1 });
  assert.deepEqual(firstPage.items.map((item) => item.taskId), ["task-2"]);
  assert.ok(firstPage.nextCursor);
  const secondPage = await query.listContactTasks("contact-1", { cursor: firstPage.nextCursor, limit: 1 });
  assert.deepEqual(secondPage.items.map((item) => item.taskId), ["task-1"]);
  const result = await query.listContactTasks("contact-1", { limit: 5 });
  assert.deepEqual(result.items.map((item) => item.taskId), ["task-2", "task-1"]);
  assert.deepEqual(result.items[1].sessionRefs, ["pi-contact-1-task-1"]);
  assert.equal(result.items[1].groupId, "group-1");
  assert.equal(result.items[1].title, "Build persistence");
  assert.equal(result.items[1].status, "open");
  assert.deepEqual(
    (await query.listContactTasks("contact-1", { taskId: "task-1" })).items.map((item) => item.taskId),
    ["task-1"],
  );
  await assert.rejects(
    query.listContactTasks("contact-2", { taskId: "task-2" }),
    /not authorized/i,
  );
});

test("rejects a read of another contact's mapped Pi session instead of hiding it", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedTasksAndContacts(db);
  seedTaskSession(db, { contactId: "contact-2", suffix: "private-to-contact-2", createdAt: "2026-10-16T10:00:00.000Z" });

  await assert.rejects(
    createTraceQueryService(db).readContactSession("contact-1", "pi-private-to-contact-2"),
    /not authorized|does not belong|ownership/i,
  );
});

test("task-scoped reads require both the server contact and task identity", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedTasksAndContacts(db);
  const own = seedTaskSession(db, {
    contactId: "contact-1",
    suffix: "own-task",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  seedTaskSession(db, {
    contactId: "contact-2",
    suffix: "peer-task",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  const trace = createTraceExtension(db);
  await trace.recordSessionEvent(own, { type: "message_end", message: { role: "assistant", content: "own evidence" } });

  const page = await createTraceQueryService(db)
    .readContactSession("contact-1", "pi-own-task", { taskId: "task-1" });
  assert.match(JSON.stringify(page.items), /own evidence/);
  assert.doesNotMatch(JSON.stringify(page.items), /peer evidence/);
  await assert.rejects(
    createTraceQueryService(db).readContactSession("contact-1", "pi-peer-task", { taskId: "task-1" }),
    /not authorized|does not belong|ownership/i,
  );
  assert.ok(own);
});

test("paginates session trace records in append order", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedTasksAndContacts(db);
  const mapping = seedTaskSession(db, {
    contactId: "contact-1",
    suffix: "paged",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  const trace = createTraceExtension(db);
  await trace.recordProviderRequest(mapping, "call-1", { n: 1 });
  await trace.recordProviderEvent(mapping, "call-1", { n: 2 });
  await trace.recordSessionEvent(mapping, { type: "agent_settled", n: 3 });

  const query = createTraceQueryService(db);
  const first = await query.readContactSession("contact-1", "pi-paged", { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.type), ["provider_request", "provider_event"]);
  assert.ok(first.nextCursor);
  const second = await query.readContactSession("contact-1", "pi-paged", {
    cursor: first.nextCursor,
    limit: 2,
  });
  assert.deepEqual(second.items.map((item) => item.type), ["pi_event"]);
  assert.equal(second.nextCursor, null);
});
