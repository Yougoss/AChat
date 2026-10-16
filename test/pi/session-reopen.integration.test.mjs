import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createTestDatabase, seedContact, seedProject } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createWorkQueue } from "../../src/server/scheduler/work-queue.ts";
import { createSessionFactory } from "../../src/server/pi/session-factory.ts";
import { createSessionRegistry } from "../../src/server/pi/session-registry.ts";

const recoveryModule = await import("../../src/server/lifecycle/recovery.ts")
  .catch(() => ({}));

function fakePiSession() {
  const listeners = new Set();
  return {
    messages: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(prompt) {
      this.messages.push({ role: "user", content: prompt });
      const assistant = {
        role: "assistant",
        content: [{ type: "text", text: "Resumed through the fake Pi session." }],
      };
      this.messages.push(assistant);
      for (const listener of listeners) {
        listener({ type: "message_end", message: assistant });
        listener({ type: "agent_end", aborted: false });
      }
    },
    abort() {},
    dispose() {},
  };
}

test("reopens the mapped Pi JSONL for explicit retry with fake runtime and no provider call", async (t) => {
  assert.equal(typeof recoveryModule.createRecoveryService, "function",
    "startup recovery must associate interrupted work with the mapped Pi session");
  const db = createTestDatabase();
  const dataDir = path.join(process.cwd(), "test", `.task8-session-reopen-${process.pid}`);
  t.after(() => {
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  seedProject(db);
  seedContact(db, "developer");
  db.prepare(`
    UPDATE agents SET model_provider = 'github-copilot', model_id = 'fake-copilot-model'
    WHERE id = 'developer'
  `).run();
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "reopen-group", name: "Session reopen", description: "Reopen test" },
    task: {
      id: "reopen-task",
      projectId: "project-1",
      description: "Continue using the existing task conversation",
      status: "open",
    },
  });
  createGroupTaskRepository(db).addTaskMember(task.id, "developer");
  const conversation = createMessageRepository(db).createConversation({
    id: "reopen-conversation",
    groupId: "reopen-group",
    taskId: task.id,
    contactId: null,
    kind: "task",
  });
  const workItem = createWorkItemRepository(db).createWorkItem({
    id: "reopen-work-item",
    taskId: task.id,
    contactId: "developer",
    title: "Finish the interrupted implementation",
    status: "running",
  });
  createRunRepository(db).createRun({
    id: "reopen-run-1",
    taskId: task.id,
    workItemId: workItem.id,
    contactId: "developer",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T01:00:00.000Z",
  });

  const sessionDir = path.join(dataDir, "sessions", "developer", "task", task.id);
  const originalPiSession = SessionManager.create(process.cwd(), sessionDir);
  originalPiSession.appendMessage({
    role: "user",
    content: "Previously persisted conversation evidence",
    timestamp: Date.parse("2026-10-16T01:00:00.000Z"),
  });
  const sessionFile = originalPiSession.getSessionFile();
  assert.ok(sessionFile);
  const mapping = createSessionRepository(db).createSessionMapping({
    id: "reopen-mapping",
    contactId: "developer",
    taskId: task.id,
    conversationId: conversation.id,
    kind: "task",
    piSessionId: originalPiSession.getSessionId(),
    sessionFile,
  });

  const runtime = {
    async getAvailable(providerId) {
      assert.equal(providerId, "github-copilot");
      return [{ provider: "github-copilot", id: "fake-copilot-model", name: "Fake Copilot" }];
    },
  };
  const resumedManagers = [];
  const session = fakePiSession();
  const sessionFactory = createSessionFactory({
    db,
    runtime,
    dataDir,
    agentDir: path.join(dataDir, "agent"),
    sessionRegistry: createSessionRegistry(),
    createResourceLoader: () => ({ async reload() {} }),
    createSession: async (options) => {
      resumedManagers.push(options.sessionManager);
      return { session };
    },
  });
  const queue = createWorkQueue({
    db,
    createContactSession: (contactId, options) => sessionFactory.createContactSession(contactId, options),
    idFactory: (() => {
      let id = 0;
      return () => id++ === 0 ? "reopen-run-2" : `reopen-event-${id}`;
    })(),
    now: () => "2026-10-16T03:00:00.000Z",
  });
  const recovery = recoveryModule.createRecoveryService(db, {
    now: () => "2026-10-16T02:00:00.000Z",
    runWorkItem: (id) => queue.runTaskWorkItem(id),
  });

  const summary = await recovery.reconcileInterruptedWork();
  const retried = await recovery.retryInterruptedWork(task.id);

  assert.equal(summary.interruptedRuns, 1);
  assert.equal(retried.length, 1);
  assert.equal(retried[0].id, "reopen-run-2");
  assert.equal(retried[0].attempt, 2);
  assert.equal(retried[0].status, "completed");
  assert.equal(resumedManagers.length, 1);
  assert.equal(resumedManagers[0].getSessionId(), mapping.piSessionId);
  assert.equal(resumedManagers[0].getSessionFile(), mapping.sessionFile);
  assert.ok(resumedManagers[0].buildSessionContext().messages.some((message) =>
    message.role === "user"
      && message.content === "Previously persisted conversation evidence"));
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].role, "user");
});
