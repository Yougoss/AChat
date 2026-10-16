import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createExecutionFixture } from "./task-execution-fixtures.mjs";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";
import { createAppRuntime } from "../../src/server/app-runtime.ts";
import { createDatabaseLifecycle } from "../../src/server/db/client.ts";
import { createPiRuntimeLifecycle } from "../../src/server/pi/model-runtime.ts";
import { createWorkQueueLifecycle } from "../../src/server/scheduler/work-queue.ts";

const workQueueModule = await import("../../src/server/scheduler/work-queue.ts")
  .catch(() => ({}));
const handoffModule = await import("../../src/server/services/handoff-service.ts")
  .catch(() => ({}));
const runtimeBootstrapModule = await import("../../src/server/runtime-bootstrap.ts")
  .catch(() => ({}));
const conversationModule = await import("../../src/components/GroupConversation.tsx")
  .catch(() => ({}));

function requireWorkQueue() {
  assert.equal(typeof workQueueModule.createWorkQueue, "function",
    "createWorkQueue must execute committed items in recipient task sessions");
  return workQueueModule.createWorkQueue;
}

function addWorkItem(fixture, id, contactId, options = {}) {
  return createWorkItemRepository(fixture.db).createWorkItem({
    id,
    taskId: fixture.task.id,
    contactId,
    title: options.title ?? "Implement the task",
    status: "pending",
    ...(options.handoffDepth === undefined ? {} : { handoffDepth: options.handoffDepth }),
    ...(options.sourceMessageId === undefined ? {} : { sourceMessageId: options.sourceMessageId }),
  });
}

function fakePiSession({ abort = false, fail = false } = {}) {
  const listeners = new Set();
  const prompts = [];
  const session = {
    messages: [],
    prompts,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(prompt) {
      prompts.push(prompt);
      const emit = (event) => {
        for (const listener of listeners) listener(event);
      };
      emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Inspecting the failing path." },
      });
      emit({
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "pi-tool-1",
        args: { path: "src/index.ts" },
      });
      emit({
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "pi-tool-1",
        result: [{ type: "text", text: "The file is present." }],
        isError: false,
      });
      if (fail) {
        emit({ type: "agent_error", error: new Error("synthetic provider failure") });
        throw new Error("synthetic provider failure");
      }
      session.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "The focused test passes." }],
      });
      emit({
        type: "message_end",
        message: session.messages.at(-1),
      });
      emit({ type: "agent_end", aborted: abort });
    },
    abort() {},
    dispose() {},
  };
  return session;
}

test("runs a handoff in the recipient's existing task session with durable run and trace linkage", async (t) => {
  const createWorkQueue = requireWorkQueue();
  assert.equal(typeof handoffModule.createHandoffService, "function");
  assert.equal(typeof conversationModule.GroupConversation, "function",
    "the group conversation must render sender and recipient handoff messages");
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const handoffService = handoffModule.createHandoffService(fixture.db, {
    idFactory: (() => {
      const ids = ["handoff-1", "handoff-message", "tester-work-item", "handoff-event"];
      return () => ids.shift();
    })(),
    now: () => "2026-10-16T02:00:00.000Z",
  });
  const handoff = await handoffService.enqueueHandoff(fixture.context, {
    recipientAgentId: "tester",
    instruction: "Run the integration suite",
    expectedOutput: "A passing test report",
    toolCallId: "integration-tool-call",
  });
  const workItem = createWorkItemRepository(fixture.db).getWorkItem("tester-work-item");
  assert.deepEqual(handoff, { handoffId: "handoff-1", status: "queued" });
  const session = fakePiSession();
  const sessionCalls = [];
  const queue = createWorkQueue({
    db: fixture.db,
    createContactSession: async (contactId, options) => {
      sessionCalls.push({ contactId, options });
      return session;
    },
    idFactory: (() => {
      let id = 0;
      return () => id++ === 0 ? "tester-run" : `tester-event-${id}`;
    })(),
    now: () => "2026-10-16T02:01:00.000Z",
  });

  const run = await queue.runTaskWorkItem(workItem.id);

  assert.equal(run.status, "completed");
  assert.deepEqual(sessionCalls.map(({ contactId, options }) => ({
    contactId,
    sessionKind: options.sessionKind,
    taskId: options.taskId,
    handoffDepth: options.handoffDepth,
  })), [{
    contactId: "tester",
    sessionKind: "task",
    taskId: fixture.task.id,
    handoffDepth: 1,
  }]);
  assert.match(session.prompts[0], /Implement the shared feature/);
  assert.match(session.prompts[0], /Run the integration suite/);
  assert.match(session.prompts[0], /A passing test report/);

  const persistedEvents = fixture.db.prepare(`
    SELECT id, type, payload_json AS payload
    FROM events WHERE entity_type = 'run' AND entity_id = ?
    ORDER BY created_at, id
  `).all(run.id);
  const eventTypes = persistedEvents.map(({ type }) => type);
  assert.deepEqual(eventTypes, [
    "run.started",
    "text.delta",
    "tool.started",
    "tool.completed",
    "final_message",
    "run.completed",
  ]);
  assert.ok(persistedEvents.every(({ payload }) => JSON.parse(payload).runId === run.id));

  const testerTrace = await createTraceQueryService(fixture.db)
    .readContactSession("tester", fixture.testerMapping.piSessionId);
  assert.ok(testerTrace.items.some(({ type, payload }) =>
    type === "achat_event" && payload.type === "text.delta" && payload.payload.runId === run.id));
  assert.ok(testerTrace.items.some(({ type, payload }) =>
    type === "achat_event" && payload.type === "handoff.queued"
      && payload.payload.handoffId === "handoff-1"));
  const developerTrace = await createTraceQueryService(fixture.db)
    .readContactSession("developer", fixture.sourceMapping.piSessionId);
  assert.ok(developerTrace.items.every(({ payload }) =>
    !JSON.stringify(payload).includes(run.id)));

  const markup = renderToStaticMarkup(createElement(conversationModule.GroupConversation, {
    group: fixture.group,
    task: fixture.task,
    messages: fixture.messages.listMessages(fixture.conversation.id),
    runs: [{
      ...run,
      contactName: "Tester",
      title: "Run the integration suite",
      events: persistedEvents.map(({ id, type, payload }) => ({
        id,
        type,
        payload: JSON.parse(payload),
      })),
    }],
    contacts: [
      { id: "developer", name: "Developer" },
      { id: "tester", name: "Tester" },
    ],
  }));
  assert.match(markup, /@Developer/);
  assert.match(markup, /@Tester/);
  assert.match(markup, /Run the integration suite/);
  assert.match(markup, /completed/i);
  assert.match(markup, /The focused test passes/);
  assert.match(markup, /tool.completed|read result/i);
});

test("rejects blank task descriptions before run creation or session prompting", async (t) => {
  const createWorkQueue = requireWorkQueue();
  const fixture = createExecutionFixture({ description: " \n\t " });
  t.after(() => fixture.db.close());
  const item = addWorkItem(fixture, "blank-description-item", "tester");
  let prompted = false;
  const queue = createWorkQueue({
    db: fixture.db,
    createContactSession: async () => {
      prompted = true;
      return fakePiSession();
    },
  });

  await assert.rejects(queue.runTaskWorkItem(item.id), /description.*required|blank/i);
  assert.equal(createRunRepository(fixture.db).listRunsForWorkItem(item.id).length, 0);
  assert.equal(prompted, false);
});

test("rejects blank task descriptions before a group message creates work", async (t) => {
  const createGroupMessageService = handoffModule.createGroupMessageService;
  assert.equal(typeof createGroupMessageService, "function");
  const fixture = createExecutionFixture({ description: " \n\t " });
  t.after(() => fixture.db.close());
  const beforeMessages = fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count;
  const beforeWorkItems = fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count;
  let enqueued = false;
  const service = createGroupMessageService(fixture.db, {
    enqueueWorkItem: () => { enqueued = true; },
  });

  await assert.rejects(
    service.sendGroupMessage(fixture.group.id, { content: "@Tester please start." }),
    /task description.*required/i,
  );

  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, beforeMessages);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, beforeWorkItems);
  assert.equal(enqueued, false);
});

test("keeps failed and aborted Pi events attached to their durable run", async (t) => {
  const createWorkQueue = requireWorkQueue();
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const failedItem = addWorkItem(fixture, "failed-item", "tester");
  const failedQueue = createWorkQueue({
    db: fixture.db,
    createContactSession: async () => fakePiSession({ fail: true }),
    idFactory: (() => {
      let id = 0;
      return () => id++ === 0 ? "failed-run" : `failed-event-${id}`;
    })(),
  });
  await assert.rejects(failedQueue.runTaskWorkItem(failedItem.id), /synthetic provider failure/);
  assert.equal(createRunRepository(fixture.db).getRun("failed-run").status, "failed");
  assert.ok(fixture.db.prepare(`
    SELECT 1 FROM events WHERE entity_type = 'run' AND entity_id = 'failed-run'
      AND type = 'run.error'
  `).get());
  assert.ok(fixture.db.prepare(`
    SELECT 1 FROM events WHERE entity_type = 'run' AND entity_id = 'failed-run'
      AND type = 'run.failed'
  `).get());

  const abortedItem = addWorkItem(fixture, "aborted-item", "tester");
  const abortedQueue = createWorkQueue({
    db: fixture.db,
    createContactSession: async () => fakePiSession({ abort: true }),
    idFactory: (() => {
      let id = 0;
      return () => id++ === 0 ? "aborted-run" : `aborted-event-${id}`;
    })(),
  });
  const abortedRun = await abortedQueue.runTaskWorkItem(abortedItem.id);
  assert.equal(abortedRun.status, "interrupted");
  assert.ok(fixture.db.prepare(`
    SELECT 1 FROM events WHERE entity_type = 'run' AND entity_id = 'aborted-run'
      AND type = 'run.aborted'
  `).get());
  assert.ok(fixture.db.prepare(`
    SELECT 1 FROM events WHERE entity_type = 'run' AND entity_id = 'aborted-run'
      AND type = 'run.interrupted'
  `).get());
});

test("routes an explicit @all message once to every task member and no one else", async (t) => {
  const createGroupMessageService = handoffModule.createGroupMessageService;
  assert.equal(typeof createGroupMessageService, "function",
    "group messages must route explicit mentions to committed work items");
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const enqueued = [];
  const service = createGroupMessageService(fixture.db, {
    idFactory: (() => {
      let id = 0;
      return () => `group-message-${++id}`;
    })(),
    enqueueWorkItem: (workItemId) => enqueued.push(workItemId),
  });

  const result = await service.sendGroupMessage(fixture.group.id, {
    content: "Please help, @all.",
  });

  assert.deepEqual(result.routedTo.sort(), ["developer", "reviewer", "tester"]);
  assert.equal(new Set(enqueued).size, 3);
  assert.equal(enqueued.length, 3);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 1);
  assert.deepEqual(
    fixture.db.prepare(`
      SELECT contact_id FROM work_items WHERE title LIKE 'Please help%'
      ORDER BY contact_id
    `).all().map(({ contact_id }) => contact_id),
    ["developer", "reviewer", "tester"],
  );
  assert.equal(fixture.db.prepare(`
    SELECT COUNT(*) AS count FROM work_items
    WHERE title LIKE 'Please help%' AND handoff_depth = 0
  `).get().count, 3);
});

test("does not route unmentioned contacts from a group message", async (t) => {
  assert.equal(typeof handoffModule.createGroupMessageService, "function");
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const enqueued = [];
  const service = handoffModule.createGroupMessageService(fixture.db, {
    enqueueWorkItem: (workItemId) => enqueued.push(workItemId),
  });

  const result = await service.sendGroupMessage(fixture.group.id, {
    content: "Tester, please inspect only this failure.",
  });

  assert.deepEqual(result.routedTo, []);
  assert.deepEqual(enqueued, []);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 1);
});

test("routes a repeated explicit @contact mention once to that contact only", async (t) => {
  assert.equal(typeof handoffModule.createGroupMessageService, "function");
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const enqueued = [];
  const service = handoffModule.createGroupMessageService(fixture.db, {
    idFactory: (() => {
      let id = 0;
      return () => `contact-mention-${++id}`;
    })(),
    enqueueWorkItem: (workItemId) => enqueued.push(workItemId),
  });

  const result = await service.sendGroupMessage(fixture.group.id, {
    content: "Please check this, @Tester and @tester.",
  });

  assert.deepEqual(result.routedTo, ["tester"]);
  assert.equal(enqueued.length, 1);
  assert.equal(fixture.db.prepare(`
    SELECT COUNT(*) AS count FROM work_items WHERE contact_id = 'tester'
  `).get().count, 1);
  assert.equal(fixture.db.prepare(`
    SELECT COUNT(*) AS count FROM work_items WHERE contact_id IN ('developer', 'reviewer')
  `).get().count, 1);
});

test("dequeues only committed pending work and does not execute a completed item twice", async (t) => {
  const createWorkQueue = requireWorkQueue();
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const item = addWorkItem(fixture, "queued-item", "tester");
  const session = fakePiSession();
  let ids = 0;
  const queue = createWorkQueue({
    db: fixture.db,
    createContactSession: async () => session,
    idFactory: () => ids++ === 0 ? "queued-run" : `queued-event-${ids}`,
  });

  await assert.rejects(queue.enqueueWorkItem(item.id), /not running/i);
  assert.equal(createRunRepository(fixture.db).listRunsForWorkItem(item.id).length, 0);
  await queue.start();
  await Promise.all([
    queue.enqueueWorkItem(item.id),
    queue.enqueueWorkItem(item.id),
  ]);
  await queue.drain();

  assert.equal(session.prompts.length, 1);
  assert.equal(createRunRepository(fixture.db).listRunsForWorkItem(item.id).length, 1);
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(item.id).status, "completed");
  await assert.rejects(queue.runTaskWorkItem(item.id), /not pending/i);
  await queue.stop();
  await assert.rejects(queue.enqueueWorkItem(item.id), /not running/i);
});

test("registers database, Pi runtime, and queue lifecycles passively and in order", async () => {
  const registerAchatRuntimeLifecycles = runtimeBootstrapModule.registerAchatRuntimeLifecycles;
  assert.equal(typeof registerAchatRuntimeLifecycles, "function",
    "runtime lifecycle dependencies must be registered before app startup");
  const calls = [];
  const registered = [];
  const database = createDatabaseLifecycle(":memory:");
  const databaseLifecycle = {
    async start() {
      calls.push("database:start");
      await database.start();
    },
    async stop() {
      calls.push("database:stop");
      await database.stop();
    },
    getDatabase: () => database.getDatabase(),
  };
  const piRuntimeLifecycle = createPiRuntimeLifecycle({
    createRuntime: async () => {
      calls.push("pi:start");
      return { dispose() { calls.push("pi:stop"); } };
    },
  });
  const workQueueLifecycle = createWorkQueueLifecycle({
    databaseLifecycle,
    createQueue(db) {
      assert.equal(db.open, true);
      return {
        async start() { calls.push("queue:start"); },
        async stop() { calls.push("queue:stop"); },
        async enqueueWorkItem() {},
        async drain() {},
        async runTaskWorkItem() {},
      };
    },
  });
  registerAchatRuntimeLifecycles({
    registerLifecycle(value) { registered.push(value); },
    databaseLifecycle,
    piRuntimeLifecycle,
    workQueueLifecycle,
  });

  assert.deepEqual(calls, []);
  assert.equal(registered.length, 3);
  const runtime = createAppRuntime(registered);
  await Promise.all([runtime.start(), runtime.start()]);
  await runtime.start();
  assert.deepEqual(calls, ["database:start", "pi:start", "queue:start"]);
  await runtime.stop();
  assert.deepEqual(calls, [
    "database:start",
    "pi:start",
    "queue:start",
    "queue:stop",
    "pi:stop",
    "database:stop",
  ]);
});
