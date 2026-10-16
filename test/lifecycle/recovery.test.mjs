import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "../pi/task-execution-fixtures.mjs";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createWorkQueue } from "../../src/server/scheduler/work-queue.ts";
import { createTraceExtension } from "../../src/server/pi/trace-extension.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";
import { createAppRuntime } from "../../src/server/app-runtime.ts";
import { registerAchatRuntimeLifecycles } from "../../src/server/runtime-bootstrap.ts";

const recoveryModule = await import("../../src/server/lifecycle/recovery.ts")
  .catch(() => ({}));

function createRecoveryService(db, options = {}) {
  assert.equal(typeof recoveryModule.createRecoveryService, "function",
    "recovery service must reconcile interrupted work and retry it only on request");
  return recoveryModule.createRecoveryService(db, options);
}

function markInterrupted(fixture, workItem = fixture.sourceWorkItem, run = fixture.sourceRun) {
  createRunRepository(fixture.db).updateRunStatus(run.id, "interrupted", "2026-10-16T02:00:00.000Z");
  createWorkItemRepository(fixture.db).updateWorkItemStatus(
    workItem.id,
    "interrupted",
    "2026-10-16T02:00:00.000Z",
  );
}

function addInterruptedWorkItem(fixture, id, contactId = "tester") {
  const workItem = createWorkItemRepository(fixture.db).createWorkItem({
    id,
    taskId: fixture.task.id,
    contactId,
    title: `Retry ${id}`,
    status: "interrupted",
  });
  const run = createRunRepository(fixture.db).createRun({
    id: `${id}-run-1`,
    taskId: fixture.task.id,
    workItemId: workItem.id,
    contactId,
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T01:00:00.000Z",
  });
  createRunRepository(fixture.db).updateRunStatus(run.id, "interrupted", "2026-10-16T02:00:00.000Z");
  return { workItem, run: createRunRepository(fixture.db).getRun(run.id) };
}

function fakePiSession({ abort = false } = {}) {
  const listeners = new Set();
  const prompts = [];
  return {
    prompts,
    messages: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(prompt) {
      prompts.push(prompt);
      const assistant = {
        role: "assistant",
        content: [{ type: "text", text: "Continued from the existing session." }],
      };
      this.messages.push(assistant);
      for (const listener of listeners) {
        listener({ type: "message_end", message: assistant });
        listener({ type: "agent_end", aborted: abort });
      }
    },
    abort() {},
    dispose() {},
  };
}

test("registers recovery after database and Pi startup but before the work queue", async () => {
  const calls = [];
  const registered = [];
  registerAchatRuntimeLifecycles({
    registerLifecycle: (lifecycle) => registered.push(lifecycle),
    databaseLifecycle: { async start() { calls.push("database"); } },
    piRuntimeLifecycle: { async start() { calls.push("pi-runtime"); } },
    recoveryLifecycle: { async start() { calls.push("recovery"); } },
    workQueueLifecycle: { async start() { calls.push("work-queue"); } },
  });

  await createAppRuntime(registered).start();

  assert.deepEqual(calls, ["database", "pi-runtime", "recovery", "work-queue"]);
});

test("reconciles a hard interruption against its mapped Pi session without replaying work", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const secondWorkItem = createWorkItemRepository(fixture.db).createWorkItem({
    id: "second-hard-interruption",
    taskId: fixture.task.id,
    contactId: "developer",
    title: "Another interrupted item in the same session",
    status: "running",
  });
  const secondRun = createRunRepository(fixture.db).createRun({
    id: "second-hard-run",
    taskId: fixture.task.id,
    workItemId: secondWorkItem.id,
    contactId: "developer",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T01:30:00.000Z",
  });
  let workItemExecutions = 0;
  const recovery = createRecoveryService(fixture.db, {
    idFactory: (() => {
      let id = 0;
      return () => `recovery-event-${++id}`;
    })(),
    now: () => "2026-10-16T03:00:00.000Z",
    runWorkItem: async () => {
      workItemExecutions += 1;
      throw new Error("startup must not run work");
    },
  });

  const summary = await recovery.reconcileInterruptedWork();

  assert.equal(createRunRepository(fixture.db).getRun(fixture.sourceRun.id).status, "interrupted");
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(fixture.sourceWorkItem.id).status, "interrupted");
  assert.equal(createRunRepository(fixture.db).getRun(secondRun.id).status, "interrupted");
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(secondWorkItem.id).status, "interrupted");
  assert.equal(summary.interruptedRuns, 2);
  assert.equal(summary.associatedSessions, 1);
  assert.equal(workItemExecutions, 0);
  const interruptedEvent = createEventRepository(fixture.db)
    .listEventsForEntity("run", fixture.sourceRun.id)
    .find((event) => event.type === "run.interrupted");
  assert.equal(interruptedEvent.payload.piSessionId, fixture.sourceMapping.piSessionId);
  const trace = await createTraceQueryService(fixture.db)
    .readContactSession("developer", fixture.sourceMapping.piSessionId);
  assert.ok(trace.items.some((item) =>
    item.type === "achat_event"
      && item.payload.type === "run.interrupted"
      && item.payload.payload.runId === fixture.sourceRun.id));

  await recovery.reconcileInterruptedWork();
  assert.equal(createEventRepository(fixture.db)
    .listEventsForEntity("run", fixture.sourceRun.id)
    .filter((event) => event.type === "run.interrupted").length, 1);
  assert.equal(workItemExecutions, 0);
});

test("associates graceful interruptions without changing their run or trace history", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  createRunRepository(fixture.db).updateRunStatus(
    fixture.sourceRun.id,
    "failed",
    "2026-10-16T02:00:00.000Z",
  );
  createWorkItemRepository(fixture.db).updateWorkItemStatus(
    fixture.sourceWorkItem.id,
    "failed",
    "2026-10-16T02:00:00.000Z",
  );
  const workItem = createWorkItemRepository(fixture.db).createWorkItem({
    id: "graceful-work-item",
    taskId: fixture.task.id,
    contactId: "developer",
    title: "Gracefully interrupted work",
    status: "pending",
  });
  const queue = createWorkQueue({
    db: fixture.db,
    createContactSession: async () => fakePiSession({ abort: true }),
    idFactory: (() => {
      let id = 0;
      return () => id++ === 0 ? "graceful-run" : `graceful-event-${id}`;
    })(),
    now: () => "2026-10-16T02:00:00.000Z",
  });
  const gracefulRun = await queue.runTaskWorkItem(workItem.id);
  const event = createEventRepository(fixture.db)
    .listEventsForEntity("run", gracefulRun.id)
    .find((entry) => entry.type === "run.interrupted");
  assert.ok(event);
  assert.equal(gracefulRun.status, "interrupted");
  const trace = createTraceExtension(fixture.db);
  await trace.recordAchatEvent({
    id: fixture.sourceMapping.id,
    contactId: fixture.sourceMapping.contactId,
    taskId: fixture.task.id,
    kind: "task",
    piSessionId: fixture.sourceMapping.piSessionId,
  }, "prior-run-evidence", { eventId: "before-reconcile" });

  const summary = await createRecoveryService(fixture.db).reconcileInterruptedWork();

  assert.equal(summary.interruptedRuns, 0);
  assert.equal(summary.associatedSessions, 1);
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(workItem.id).status, "interrupted");
  assert.equal(createRunRepository(fixture.db).getRun(gracefulRun.id).completedAt,
    "2026-10-16T02:00:00.000Z");
  const events = createEventRepository(fixture.db).listEventsForEntity("run", gracefulRun.id);
  assert.equal(events.filter((entry) => entry.type === "run.interrupted").length, 1);
  assert.equal(events.find((entry) => entry.id === event.id).payload.piSessionId,
    fixture.sourceMapping.piSessionId);
  const sessionTrace = await createTraceQueryService(fixture.db)
    .readContactSession("developer", fixture.sourceMapping.piSessionId);
  assert.ok(sessionTrace.items.some((entry) =>
    entry.type === "achat_event" && entry.payload.payload.eventId === "before-reconcile"));
  assert.ok(sessionTrace.items.some((entry) =>
    entry.type === "achat_event" && entry.payload.payload.eventId === event.id));
});

test("manual retry creates a new run on the existing session and retains original trace", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  markInterrupted(fixture);
  const trace = createTraceExtension(fixture.db);
  await trace.recordAchatEvent({
    id: fixture.sourceMapping.id,
    contactId: fixture.sourceMapping.contactId,
    taskId: fixture.task.id,
    kind: "task",
    piSessionId: fixture.sourceMapping.piSessionId,
  }, "historical-run-evidence", { eventId: "original-trace" });
  const session = fakePiSession();
  const requestedSessions = [];
  const queue = createWorkQueue({
    db: fixture.db,
    createContactSession: async (contactId, options) => {
      requestedSessions.push({ contactId, options });
      return session;
    },
    idFactory: (() => {
      let id = 0;
      return () => id++ === 0 ? "retry-run-2" : `retry-event-${id}`;
    })(),
    now: () => "2026-10-16T03:00:00.000Z",
  });
  const recovery = createRecoveryService(fixture.db, {
    runWorkItem: (id) => queue.runTaskWorkItem(id),
  });

  const retriedRuns = await recovery.retryInterruptedWork(fixture.task.id, [fixture.sourceWorkItem.id]);

  assert.equal(retriedRuns.length, 1);
  assert.equal(retriedRuns[0].id, "retry-run-2");
  assert.equal(retriedRuns[0].attempt, 2);
  assert.equal(retriedRuns[0].status, "completed");
  assert.equal(session.prompts.length, 1);
  assert.deepEqual(requestedSessions.map(({ contactId, options }) => ({
    contactId,
    taskId: options.taskId,
    sessionKind: options.sessionKind,
    workItemId: options.workItemId,
    runId: options.runId,
  })), [{
    contactId: "developer",
    taskId: fixture.task.id,
    sessionKind: "task",
    workItemId: fixture.sourceWorkItem.id,
    runId: "retry-run-2",
  }]);
  const retainedTrace = await createTraceQueryService(fixture.db)
    .readContactSession("developer", fixture.sourceMapping.piSessionId);
  assert.ok(retainedTrace.items.some((entry) =>
    entry.type === "achat_event" && entry.payload.payload.eventId === "original-trace"));
  assert.ok(retainedTrace.items.some((entry) =>
    entry.type === "achat_event" && entry.payload.payload.runId === "retry-run-2"));
});

test("default retry selects all and only eligible interrupted items in the task", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  markInterrupted(fixture);
  const second = addInterruptedWorkItem(fixture, "second-interrupted-item");
  const completed = createWorkItemRepository(fixture.db).createWorkItem({
    id: "completed-item",
    taskId: fixture.task.id,
    contactId: "tester",
    title: "Already completed",
    status: "running",
  });
  const completedRun = createRunRepository(fixture.db).createRun({
    id: "completed-item-run",
    taskId: fixture.task.id,
    workItemId: completed.id,
    contactId: "tester",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T01:00:00.000Z",
  });
  createRunRepository(fixture.db).completeRun(completedRun.id, "2026-10-16T02:00:00.000Z");
  createWorkItemRepository(fixture.db).updateWorkItemStatus(completed.id, "completed");
  const otherTask = createGroupTaskRepository(fixture.db).createGroupWithTask({
    group: { id: "foreign-group", name: "Other task", description: "Foreign" },
    task: { id: "foreign-task", projectId: "project-1", description: "Foreign task", status: "open" },
  }).task;
  const foreignItem = createWorkItemRepository(fixture.db).createWorkItem({
    id: "foreign-item",
    taskId: otherTask.id,
    contactId: "tester",
    title: "Foreign interrupted work",
    status: "interrupted",
  });
  const foreignRun = createRunRepository(fixture.db).createRun({
    id: "foreign-item-run",
    taskId: otherTask.id,
    workItemId: foreignItem.id,
    contactId: "tester",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T01:00:00.000Z",
  });
  createRunRepository(fixture.db).updateRunStatus(
    foreignRun.id,
    "interrupted",
    "2026-10-16T02:00:00.000Z",
  );
  const retried = [];
  const recovery = createRecoveryService(fixture.db, {
    runWorkItem: async (id) => {
      retried.push(id);
      return createRunRepository(fixture.db).createRun({
        id: `new-${id}`,
        taskId: fixture.task.id,
        workItemId: id,
        contactId: id === second.workItem.id ? "tester" : "developer",
        attempt: 2,
        status: "running",
        startedAt: "2026-10-16T03:00:00.000Z",
      });
    },
  });

  const runs = await recovery.retryInterruptedWork(fixture.task.id);

  assert.deepEqual(retried.sort(), [fixture.sourceWorkItem.id, second.workItem.id].sort());
  assert.equal(runs.length, 2);
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(completed.id).status, "completed");
  assert.equal(createRunRepository(fixture.db).listRunsForWorkItem(completed.id).length, 1);
});

test("rejects selected completed and foreign-task work items before execution", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  markInterrupted(fixture);
  const completed = createWorkItemRepository(fixture.db).createWorkItem({
    id: "done-item",
    taskId: fixture.task.id,
    contactId: "tester",
    title: "Done",
    status: "completed",
  });
  const foreignTask = createGroupTaskRepository(fixture.db).createGroupWithTask({
    group: { id: "another-group", name: "Another", description: "Another" },
    task: { id: "another-task", projectId: "project-1", description: "Another task", status: "open" },
  }).task;
  const foreign = createWorkItemRepository(fixture.db).createWorkItem({
    id: "foreign-done-item",
    taskId: foreignTask.id,
    contactId: "tester",
    title: "Foreign",
    status: "interrupted",
  });
  const calls = [];
  const recovery = createRecoveryService(fixture.db, {
    runWorkItem: async (id) => {
      calls.push(id);
      return {};
    },
  });

  await assert.rejects(
    recovery.retryInterruptedWork(fixture.task.id, [completed.id]),
    /completed|eligible|interrupted/i,
  );
  await assert.rejects(
    recovery.retryInterruptedWork(fixture.task.id, [foreign.id]),
    /task|belong/i,
  );
  assert.deepEqual(calls, []);
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(fixture.sourceWorkItem.id).status,
    "interrupted");
});

test("refuses retry when the mapped Pi JSONL is missing instead of creating a new session", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  markInterrupted(fixture);
  let executed = false;
  const recovery = createRecoveryService(fixture.db, {
    hasSessionFile: () => false,
    runWorkItem: async () => {
      executed = true;
      throw new Error("must not execute without the existing JSONL");
    },
  });

  await assert.rejects(
    recovery.retryInterruptedWork(fixture.task.id, [fixture.sourceWorkItem.id]),
    /mapped pi session file is missing/i,
  );
  assert.equal(executed, false);
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem(fixture.sourceWorkItem.id).status,
    "interrupted");
});
