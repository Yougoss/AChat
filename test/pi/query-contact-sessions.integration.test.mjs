import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { createSessionFactory } from "../../src/server/pi/session-factory.ts";
import { createTestDatabase, seedContact, seedProject, seedGroupTask } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createAgentRepository } from "../../src/server/db/repositories/agent-repository.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";
import { createQueryContactSessionsTool } from "../../src/server/pi/tools/query-contact-sessions.ts";

function seedCopilotContact(db) {
  return createAgentRepository(db).createContact({
    id: "contact-1",
    name: "Builder",
    description: "Project builder",
    modelProvider: "github-copilot",
    modelId: "test-model",
  });
}

test("registers the read-only contact query only for contact-chat sessions", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedCopilotContact(db);
  const { task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-1");
  const sessions = [];
  const taskSessionCalls = [];
  const runtime = {
    async getAvailable() {
      return [{ provider: "github-copilot", id: "test-model" }];
    },
  };
  const registry = { get: () => undefined, set: () => {}, delete: () => false, disposeAll: () => {}, size: () => 0 };
  const dataDir = `test/.trace-query-sessions-${process.pid}`;
  const agentDir = `test/.trace-query-agent-${process.pid}`;
  t.after(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  });
  const factory = createSessionFactory({
    db,
    runtime,
    dataDir,
    agentDir,
    sessionRegistry: registry,
    createResourceLoader: () => ({ reload: async () => {} }),
    createSession: async (options) => {
      sessions.push(options);
      return {
        session: {
          dispose() {},
          subscribe() { return () => {}; },
          prompt() { taskSessionCalls.push("prompt"); },
          steer() { taskSessionCalls.push("steer"); },
          abort() { taskSessionCalls.push("abort"); },
        },
      };
    },
  });

  await factory.createContactSession("contact-1", { sessionKind: "task", taskId: task.id });
  await factory.createContactSession("contact-1", { sessionKind: "contact_chat" });

  const contactTools = sessions[1].customTools ?? [];
  const taskTools = sessions[0].customTools ?? [];
  assert.deepEqual(contactTools.map((tool) => tool.name), ["query_contact_sessions"]);
  assert.deepEqual(taskTools, []);
  assert.equal(sessions[1].noTools, "all");
  assert.doesNotMatch(JSON.stringify(contactTools[0].parameters), /contactId|sessionFile|path/);
  assert.deepEqual(taskSessionCalls, []);
});

test("contact query reads do not invoke task-session controls or mutate task/run state", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedCopilotContact(db);
  const { task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-1");
  const sessionOptions = [];
  const taskSessionCalls = [];
  const dataDir = `test/.trace-query-readonly-${process.pid}`;
  const agentDir = `test/.trace-query-agent-readonly-${process.pid}`;
  t.after(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  });
  const factory = createSessionFactory({
    db,
    runtime: { async getAvailable() { return [{ provider: "github-copilot", id: "test-model" }]; } },
    dataDir,
    agentDir,
    sessionRegistry: { get: () => undefined, set: () => {}, delete: () => false, disposeAll: () => {}, size: () => 0 },
    createResourceLoader: () => ({ reload: async () => {} }),
    createSession: async (options) => {
      sessionOptions.push(options);
      const session = {
        dispose() {},
        subscribe() { return () => {}; },
        prompt() { taskSessionCalls.push("prompt"); },
        steer() { taskSessionCalls.push("steer"); },
        abort() { taskSessionCalls.push("abort"); },
      };
      return { session };
    },
  });
  await factory.createContactSession("contact-1", { sessionKind: "task", taskId: task.id });
  await factory.createContactSession("contact-1", { sessionKind: "contact_chat" });
  const tool = sessionOptions[1].customTools[0];
  assert.ok(tool);
  const before = db.prepare("SELECT id, status FROM tasks UNION ALL SELECT id, status FROM runs").all();
  const toolExecutionCalls = [];
  const result = await tool.execute("tool-call", { action: "list_sessions" }, undefined, undefined, {
    executeTool() { toolExecutionCalls.push("executeTool"); },
  });
  assert.equal(result.isError, false);
  assert.deepEqual(db.prepare("SELECT id, status FROM tasks UNION ALL SELECT id, status FROM runs").all(), before);
  assert.deepEqual(taskSessionCalls, []);
  assert.deepEqual(toolExecutionCalls, []);
});

test("task-filtered session listing reports authorization errors through the tool action", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db, "contact-1");
  seedContact(db, "contact-2");
  const { task } = seedGroupTask(db);
  createGroupTaskRepository(db).addTaskMember(task.id, "contact-1");

  const tool = createQueryContactSessionsTool("contact-2", createTraceQueryService(db));
  await assert.rejects(
    tool.execute("tool-call", { action: "list_sessions", taskId: task.id }),
    /not authorized/i,
  );
});
