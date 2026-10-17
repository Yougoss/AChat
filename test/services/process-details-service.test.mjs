import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createTraceExtension } from "../../src/server/pi/trace-extension.ts";
import { createExecutionFixture } from "../pi/task-execution-fixtures.mjs";
import { createProcessDetailsService } from "../../src/server/services/process-details-service.ts";

function seedPrivateSession(db, {
  contactId = "contact-1",
  conversationId = `private-${contactId}`,
  mappingId = `mapping-${contactId}`,
  piSessionId = `pi-${contactId}`,
} = {}) {
  const messages = createMessageRepository(db);
  const existing = db.prepare("SELECT id FROM conversations WHERE id = ?").get(conversationId);
  if (!existing) {
    messages.createConversation({
      id: conversationId,
      groupId: null,
      taskId: null,
      contactId,
      kind: "private",
    });
  }
  return createSessionRepository(db).createSessionMapping({
    id: mappingId,
    contactId,
    taskId: null,
    conversationId,
    kind: "private",
    piSessionId,
    sessionFile: `sessions/${contactId}/private.jsonl`,
  });
}

function appendRunEvent(db, {
  id,
  runId = "developer-run",
  type,
  eventSequence,
  createdAt,
  payload = {},
}) {
  return createEventRepository(db).appendEvent({
    id,
    entityType: "run",
    entityId: runId,
    type,
    payload: {
      runId,
      taskId: "task-1",
      contactId: "developer",
      piSessionId: "pi-developer-task",
      eventSequence,
      ...payload,
    },
    idempotencyKey: id,
    createdAt,
  });
}

function traceRunEvent(trace, mapping, {
  eventId,
  type,
  runId = "developer-run",
  eventSequence,
  callId,
  toolCallId,
  payload = {},
}) {
  return trace.recordAchatEvent(mapping, type, {
    eventId,
    runId,
    taskId: "task-1",
    contactId: mapping.contactId,
    piSessionId: mapping.piSessionId,
    eventSequence,
    ...(toolCallId ? { toolCallId } : {}),
    ...payload,
  }, callId);
}

test("projects task-run events in event-sequence order and aggregates only linked assistant usage", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const { db, conversation, sourceRun, sourceMapping, messages } = fixture;
  messages.appendMessage({
    id: "source-task-input",
    conversationId: conversation.id,
    role: "user",
    content: "Please implement the feature.",
    createdAt: "2026-10-16T00:59:00.000Z",
  });
  db.prepare("UPDATE work_items SET source_message_id = ? WHERE id = ?")
    .run("source-task-input", sourceRun.workItemId);
  const trace = createTraceExtension(db);
  await trace.recordProviderRequest(sourceMapping, "provider-call-1", { prompt: "private request" });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "tool-start",
    type: "tool.started",
    eventSequence: 1,
    callId: "provider-call-1",
    toolCallId: "tool-call-1",
    payload: { toolName: "shell", args: { command: "echo ready" } },
  });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "tool-end",
    type: "tool.completed",
    eventSequence: 2,
    callId: "provider-call-1",
    toolCallId: "tool-call-1",
    payload: { toolName: "shell", result: "ready", isError: false },
  });
  await trace.recordSessionEvent(sourceMapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "model-one",
      content: [{ type: "text", text: "First answer" }, { type: "thinking", text: "hidden reasoning" }],
      usage: { input: 4, output: 2, cacheRead: 1, cost: { total: 0.01 } },
      durationMs: 15,
    },
  });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "final-one",
    type: "final_message",
    eventSequence: 3,
    callId: "provider-call-1",
    payload: { text: "First answer" },
  });

  await trace.recordProviderRequest(sourceMapping, "provider-call-2", { prompt: "another request" });
  await trace.recordSessionEvent(sourceMapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "model-two",
      content: "Second answer",
      usage: { input: 6, output: 3, cacheRead: 2, cacheWrite: 5, cost: { total: 0.02 } },
    },
  });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "final-two",
    type: "final_message",
    eventSequence: 4,
    callId: "provider-call-2",
    payload: { text: "Second answer" },
  });

  await trace.recordProviderRequest(sourceMapping, "mismatched-session-call", { prompt: "other mapping" });
  await trace.recordSessionEvent(sourceMapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "wrong-session-model",
      content: "Do not include mismatched session",
      usage: { input: 500, output: 500, cost: { total: 50 } },
    },
  });
  await trace.recordAchatEvent(sourceMapping, "tool.started", {
    eventId: "mismatched-session-event",
    runId: "developer-run",
    taskId: "task-1",
    contactId: "developer",
    piSessionId: "pi-other-session",
    eventSequence: 5,
    toolCallId: "wrong-session-tool",
    toolName: "shell",
    args: { command: "should not appear" },
  }, "mismatched-session-call");

  await trace.recordProviderRequest(sourceMapping, "another-run-call", { prompt: "out of scope" });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "stale-run-start",
    type: "run.started",
    eventSequence: 0,
    callId: "another-run-call",
  });
  await trace.recordSessionEvent(sourceMapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "private-other-run",
      content: "Do not include this answer",
      usage: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999, cost: { total: 99 } },
    },
  });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "other-run-final",
    type: "final_message",
    runId: "different-run",
    eventSequence: 1,
    callId: "another-run-call",
    payload: { text: "Do not include this answer" },
  });

  const at = "2026-10-16T02:00:00.000Z";
  appendRunEvent(db, {
    id: "stale-run-start",
    type: "run.started",
    eventSequence: 0,
    createdAt: at,
  });
  appendRunEvent(db, {
    id: "tool-start",
    type: "tool.started",
    eventSequence: 1,
    createdAt: at,
    payload: { toolName: "shell", toolCallId: "tool-call-1", args: { command: "echo ready" } },
  });
  appendRunEvent(db, {
    id: "tool-end",
    type: "tool.completed",
    eventSequence: 2,
    createdAt: at,
    payload: { toolName: "shell", toolCallId: "tool-call-1", result: "ready", isError: false },
  });
  appendRunEvent(db, {
    id: "final-one",
    type: "final_message",
    eventSequence: 3,
    createdAt: at,
    payload: { text: "First answer" },
  });
  appendRunEvent(db, {
    id: "final-two",
    type: "final_message",
    eventSequence: 4,
    createdAt: at,
    payload: { text: "Second answer" },
  });
  appendRunEvent(db, {
    id: "mismatched-session-event",
    type: "tool.started",
    eventSequence: 5,
    createdAt: at,
    payload: {
      piSessionId: "pi-other-session",
      toolCallId: "wrong-session-tool",
      toolName: "shell",
      args: { command: "should not appear" },
    },
  });
  messages.appendMessage({
    id: "assistant-one",
    conversationId: conversation.id,
    role: "assistant",
    content: "First answer",
    metadata: { runId: sourceRun.id, eventId: "final-one" },
    createdAt: at,
  });
  messages.appendMessage({
    id: "assistant-two",
    conversationId: conversation.id,
    role: "assistant",
    content: "Second answer",
    metadata: { runId: sourceRun.id, eventId: "final-two" },
    createdAt: "2026-10-16T02:00:01.000Z",
  });

  const service = createProcessDetailsService(db);
  const details = await service.getGroupRunProcessDetails("group-1", sourceRun.id);

  assert.deepEqual(details.events.map(({ id }) => id), [
    `run:${sourceRun.id}:instructions`,
    "message:source-task-input",
    "tool-start",
    "tool-end",
    "final-one",
    "final-two",
  ]);
  assert.deepEqual(details.events.map(({ kind }) => kind), [
    "context",
    "input",
    "tool_call",
    "tool_result",
    "assistant_message",
    "assistant_message",
  ]);
  assert.match(details.events[0].detail, /Implement the shared feature[\s\S]*Original task/);
  assert.equal(details.events[1].detail, "Please implement the feature.");
  assert.deepEqual(details.summary, {
    messageCount: 2,
    models: ["model-one", "model-two"],
    usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 5, cost: 0.03 },
  });
  assert.deepEqual(service.listGroupRunProcessSummaries("group-1"), {
    [sourceRun.id]: details.summary,
  });
  assert.doesNotMatch(JSON.stringify(details), /private-other-run|wrong-session-model|hidden reasoning|private request|another request|should not appear/);
});

test("links a private reply only to its persisted trace sequence range, even when reply text repeats", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db);
  const mapping = seedPrivateSession(db);
  const messages = createMessageRepository(db);
  const trace = createTraceExtension(db);
  await trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "older-model",
      content: "Same visible reply",
      usage: { input: 800, output: 400, cacheRead: 0, cacheWrite: 0, cost: { total: 8 } },
    },
  });
  const afterSequence = db.prepare("SELECT MAX(sequence) AS value FROM trace_records").get().value;
  await trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "current-model",
      content: [{ type: "text", text: "Same visible reply" }, { type: "thinking", text: "do not expose" }],
      usage: { input: 3, output: 2, cacheRead: 1, cost: { total: 0.03 } },
    },
  });
  const throughSequence = db.prepare("SELECT MAX(sequence) AS value FROM trace_records").get().value;
  await trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "newer-unrelated-model",
      content: "Same visible reply",
      usage: { input: 600, output: 300, cacheRead: 0, cacheWrite: 0, cost: { total: 6 } },
    },
  });
  const conversation = messages.getConversation(mapping.conversationId);
  messages.appendMessage({
    id: "private-assistant",
    conversationId: conversation.id,
    role: "assistant",
    content: "Same visible reply",
    metadata: { processTraceRange: { afterSequence, throughSequence } },
    createdAt: "2026-10-16T02:00:00.000Z",
  });

  const service = createProcessDetailsService(db);
  const details = await service.getContactMessageProcessDetails("contact-1", "private-assistant");

  assert.deepEqual(details.summary, {
    messageCount: 1,
    models: ["current-model"],
    usage: { input: 3, output: 2, cacheRead: 1, cost: 0.03 },
  });
  assert.equal(details.events.length, 1);
  assert.equal(details.events[0].detail, "Same visible reply");
  assert.doesNotMatch(JSON.stringify(details), /older-model|newer-unrelated-model|do not expose/);
  assert.deepEqual(service.listContactMessageProcessSummaries(
    "contact-1",
    ["private-assistant", "unowned-message"],
  ), {
    "private-assistant": details.summary,
  });
});

test("omits unavailable usage instead of inventing zeroes", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db);
  const mapping = seedPrivateSession(db);
  const messages = createMessageRepository(db);
  const trace = createTraceExtension(db);
  await trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "partial-model",
      content: "Partial data",
      usage: { input: 7 },
    },
  });
  const throughSequence = db.prepare("SELECT MAX(sequence) AS value FROM trace_records").get().value;
  messages.appendMessage({
    id: "partial-assistant",
    conversationId: mapping.conversationId,
    role: "assistant",
    content: "Partial data",
    metadata: { processTraceRange: { afterSequence: 0, throughSequence } },
    createdAt: "2026-10-16T02:00:00.000Z",
  });

  const service = createProcessDetailsService(db);
  const partial = await service.getContactMessageProcessDetails("contact-1", "partial-assistant");
  assert.deepEqual(partial.summary.usage, { input: 7 });

  const emptyConversation = createMessageRepository(db).createConversation({
    id: "private-without-trace",
    groupId: null,
    taskId: null,
    contactId: "contact-1",
    kind: "private",
  });
  const noTraceMessage = messages.appendMessage({
    id: "assistant-without-trace",
    conversationId: emptyConversation.id,
    role: "assistant",
    content: "No trace was captured",
    metadata: {},
    createdAt: "2026-10-16T02:00:01.000Z",
  });
  const noTrace = await service.getContactMessageProcessDetails("contact-1", noTraceMessage.id);
  assert.deepEqual(noTrace.summary, { messageCount: 1, models: [] });
  assert.deepEqual(noTrace.events, []);
});

test("sanitizes credential-shaped tool output without hiding the remainder of long results", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const { db, sourceRun, sourceMapping } = fixture;
  const trace = createTraceExtension(db);
  const argumentCredential = "OPENAI_API_KEY=argument-secret-value";
  const resultCredential = "OPENAI_API_KEY=result-secret-value";
  const additionalCredentials = [
    "GITHUB_TOKEN=token-secret",
    "SERVICE_SECRET=secret-value",
    "DB_PASSWORD=password-value",
    "AUTHORIZATION=authorization-value",
  ];
  const longOutput = `Bearer private-token-123 ${"x".repeat(12000)} ?api_key=private-key-456`;
  await trace.recordProviderRequest(sourceMapping, "provider-call", { prompt: "do not expose provider request" });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "sensitive-tool-start",
    type: "tool.started",
    eventSequence: 0,
    callId: "provider-call",
    toolCallId: "tool-call-sensitive",
    payload: {
      toolName: "shell",
      args: { command: `ordinary tool invocation; ${argumentCredential}; echo ready` },
    },
  });
  appendRunEvent(db, {
    id: "sensitive-tool-start",
    type: "tool.started",
    eventSequence: 0,
    createdAt: "2026-10-16T02:00:00.000Z",
    payload: {
      toolName: "shell",
      toolCallId: "tool-call-sensitive",
      args: { command: `ordinary tool invocation; ${argumentCredential}; echo ready` },
    },
  });
  await trace.recordSessionEvent(sourceMapping, {
    type: "tool_execution_end",
    toolName: "shell",
    toolCallId: "tool-call-sensitive",
    result: { text: [longOutput, resultCredential, ...additionalCredentials, "ordinary tool output"].join("; "), apiKey: "private-key-field" },
    isError: false,
  });
  await traceRunEvent(trace, sourceMapping, {
    eventId: "sensitive-tool-end",
    type: "tool.completed",
    eventSequence: 1,
    callId: "provider-call",
    toolCallId: "tool-call-sensitive",
    payload: { toolName: "shell", result: { text: [longOutput, resultCredential, ...additionalCredentials, "ordinary tool output"].join("; "), apiKey: "private-key-field" }, isError: false },
  });
  appendRunEvent(db, {
    id: "sensitive-tool-end",
    type: "tool.completed",
    eventSequence: 1,
    createdAt: "2026-10-16T02:00:00.000Z",
    payload: {
      toolName: "shell",
      toolCallId: "tool-call-sensitive",
      result: { text: [longOutput, resultCredential, ...additionalCredentials, "ordinary tool output"].join("; "), apiKey: "private-key-field" },
      isError: false,
    },
  });

  const details = await createProcessDetailsService(db)
    .getGroupRunProcessDetails("group-1", sourceRun.id);
  const argumentDetail = details.events.find(({ kind, detail }) =>
    kind === "tool_call" && detail.includes("ordinary tool invocation"))?.detail;
  const detail = details.events.find(({ kind }) => kind === "tool_result").detail;

  assert.equal(argumentDetail?.includes(argumentCredential), false);
  assert.equal(argumentDetail?.includes("ordinary tool invocation"), true);
  assert.equal(argumentDetail?.includes("echo ready"), true);
  assert.equal(detail.includes(resultCredential), false);
  assert.equal(additionalCredentials.some((credential) => detail.includes(credential)), false);
  assert.equal(detail.includes("ordinary tool output"), true);
  assert.ok(detail.length > 12_000);
  assert.ok(detail.includes("x".repeat(12_000)));
  assert.match(detail, /\[REDACTED\]/);
  assert.doesNotMatch(detail, /private-key-456|private-key-field|apiKey|do not expose provider request/);
});

test("returns not-found for a run that does not belong to the requested group", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const { db, sourceRun } = fixture;
  const tasks = createGroupTaskRepository(db);
  tasks.createGroupWithTask({
    group: { id: "group-other", name: "Other", description: "Other task" },
    task: { id: "task-other", projectId: "project-1", description: "Other task", status: "open" },
  });

  assert.throws(
    () => createProcessDetailsService(db).getGroupRunProcessDetails("group-other", sourceRun.id),
    /Run not found/,
  );
});
