import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { migrate, openDatabase } from "../../src/server/db/client.ts";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createTraceExtension } from "../../src/server/pi/trace-extension.ts";

function addPrivateConversation(db, contactId, suffix, content) {
  const messages = createMessageRepository(db);
  const conversation = messages.createConversation({
    id: `private-${suffix}`,
    groupId: null,
    taskId: null,
    contactId,
    kind: "private",
  });
  const mapping = createSessionRepository(db).createSessionMapping({
    id: `private-mapping-${suffix}`,
    contactId,
    taskId: null,
    conversationId: conversation.id,
    kind: "private",
    piSessionId: `pi-private-${suffix}`,
    sessionFile: `sessions/${contactId}/private.jsonl`,
  });
  const trace = createTraceExtension(db);
  const afterSequence = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM trace_records")
    .get().value;
  return trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "private-model",
      content,
      usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
    },
  }).then(() => {
    const throughSequence = db.prepare("SELECT MAX(sequence) AS value FROM trace_records").get().value;
    const message = messages.appendMessage({
      id: `private-message-${suffix}`,
      conversationId: conversation.id,
      role: "assistant",
      content,
      metadata: { processTraceRange: { afterSequence, throughSequence } },
      createdAt: "2026-10-16T03:00:00.000Z",
    });
    return message;
  });
}

function addTaskRun(db, {
  groupId,
  taskId,
  contactId,
  runId,
  workItemId,
  conversationId,
  mappingId,
  piSessionId,
  assistantText,
}) {
  const messages = createMessageRepository(db);
  const conversation = messages.createConversation({
    id: conversationId,
    groupId,
    taskId,
    contactId: null,
    kind: "task",
  });
  const mapping = createSessionRepository(db).createSessionMapping({
    id: mappingId,
    contactId,
    taskId,
    conversationId: conversation.id,
    kind: "task",
    piSessionId,
    sessionFile: `sessions/${contactId}/task.jsonl`,
  });
  const workItem = createWorkItemRepository(db).createWorkItem({
    id: workItemId,
    taskId,
    contactId,
    title: "Review the implementation",
    status: "running",
  });
  const run = createRunRepository(db).createRun({
    id: runId,
    taskId,
    workItemId: workItem.id,
    contactId,
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T03:00:00.000Z",
  });
  if (!assistantText) return { run, mapping };
  const trace = createTraceExtension(db);
  const callId = `call-${runId}`;
  trace.recordProviderRequest(mapping, callId, { prompt: "not user-visible" });
  trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "task-model",
      content: assistantText,
      usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, cost: { total: 0.02 } },
    },
  });
  const event = createEventRepository(db).appendEvent({
    id: `final-${runId}`,
    entityType: "run",
    entityId: runId,
    type: "final_message",
    payload: {
      runId,
      taskId,
      contactId,
      piSessionId,
      eventSequence: 1,
      text: assistantText,
    },
    idempotencyKey: `final-${runId}`,
    createdAt: "2026-10-16T03:00:01.000Z",
  });
  trace.recordAchatEvent(mapping, event.type, {
    eventId: event.id,
    ...(event.payload),
  }, callId);
  messages.appendMessage({
    id: `assistant-${runId}`,
    conversationId: conversation.id,
    role: "assistant",
    content: assistantText,
    metadata: { runId, eventId: event.id, workItemId },
    createdAt: "2026-10-16T03:00:01.000Z",
  });
  return { run, mapping };
}

test("contact and task process routes return scoped details and hide unknown or cross-scope IDs", async (t) => {
  const previousDataDir = process.env.ACHAT_DATA_DIR;
  const dataDir = path.join(process.cwd(), ".test-support", `process-details-routes-${process.pid}`);
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
  seedContact(db, "task-contact-1");
  seedContact(db, "task-contact-2");
  const ownPrivateMessage = await addPrivateConversation(db, "contact-1", "own", "Private reply");
  const otherPrivateMessage = await addPrivateConversation(db, "contact-2", "other", "Do not disclose");

  const taskRepo = createGroupTaskRepository(db);
  const { task: ownTask } = seedGroupTask(db);
  const { group: otherGroup, task: otherTask } = taskRepo.createGroupWithTask({
    group: { id: "group-2", name: "Other group", description: "Other task" },
    task: { id: "task-2", projectId: "project-1", description: "Other task", status: "open" },
  });
  taskRepo.addTaskMember(ownTask.id, "task-contact-1");
  taskRepo.addTaskMember(otherTask.id, "task-contact-2");
  const ownRun = addTaskRun(db, {
    groupId: "group-1",
    taskId: "task-1",
    contactId: "task-contact-1",
    runId: "run-1",
    workItemId: "work-1",
    conversationId: "task-conversation-1",
    mappingId: "task-mapping-1",
    piSessionId: "pi-task-1",
    assistantText: "Task reply",
  }).run;
  const otherRun = addTaskRun(db, {
    groupId: otherGroup.id,
    taskId: otherTask.id,
    contactId: "task-contact-2",
    runId: "run-2",
    workItemId: "work-2",
    conversationId: "task-conversation-2",
    mappingId: "task-mapping-2",
    piSessionId: "pi-task-2",
  }).run;
  db.close();

  const [{ GET: getContactProcess }, { GET: getTaskRunProcess }] = await Promise.all([
    import("../../src/app/api/contacts/[contactId]/messages/[messageId]/process/route.ts"),
    import("../../src/app/api/groups/[groupId]/runs/[runId]/process/route.ts"),
  ]);

  await t.test("returns contact reply details", async () => {
    const response = await getContactProcess(
      new Request("http://localhost/api/contacts/contact-1/messages/private-message-own/process"),
      { params: Promise.resolve({ contactId: "contact-1", messageId: ownPrivateMessage.id }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.messageCount, 1);
    assert.deepEqual(body.summary.models, ["private-model"]);
    assert.equal(body.events[0].detail, "Private reply");
    assert.doesNotMatch(JSON.stringify(body), /Do not disclose/);
  });

  await t.test("returns not-found for unknown private messages", async () => {
    const response = await getContactProcess(
      new Request("http://localhost/api/contacts/contact-1/messages/missing/process"),
      { params: Promise.resolve({ contactId: "contact-1", messageId: "missing" }) },
    );
    assert.equal(response.status, 404);
  });

  await t.test("returns not-found when a private message belongs to another contact", async () => {
    const response = await getContactProcess(
      new Request("http://localhost/api/contacts/contact-1/messages/private-message-other/process"),
      { params: Promise.resolve({ contactId: "contact-1", messageId: otherPrivateMessage.id }) },
    );
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Do not disclose/);
  });

  await t.test("returns run details for the requested group", async () => {
    const response = await getTaskRunProcess(
      new Request("http://localhost/api/groups/group-1/runs/run-1/process"),
      { params: Promise.resolve({ groupId: "group-1", runId: ownRun.id }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.messageCount, 1);
    assert.deepEqual(body.summary.models, ["task-model"]);
    assert.equal(body.events.find(({ kind }) => kind === "assistant_message").detail, "Task reply");
  });

  await t.test("returns not-found for unknown runs", async () => {
    const response = await getTaskRunProcess(
      new Request("http://localhost/api/groups/group-1/runs/missing/process"),
      { params: Promise.resolve({ groupId: "group-1", runId: "missing" }) },
    );
    assert.equal(response.status, 404);
  });

  await t.test("returns not-found when a run belongs to another group's task", async () => {
    const response = await getTaskRunProcess(
      new Request("http://localhost/api/groups/group-1/runs/run-2/process"),
      { params: Promise.resolve({ groupId: "group-1", runId: otherRun.id }) },
    );
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Task reply/);
  });
});
