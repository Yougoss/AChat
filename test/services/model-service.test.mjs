import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestDatabase, seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { createModelService } from "../../src/server/services/model-service.ts";
import { createSessionFactory } from "../../src/server/pi/session-factory.ts";
import { createSessionRegistry } from "../../src/server/pi/session-registry.ts";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";

function createRuntime(models) {
  return {
    getModels(providerId) {
      assert.equal(providerId, "github-copilot");
      return models;
    },
    async getAvailable(providerId) {
      assert.equal(providerId, "github-copilot");
      return models;
    },
    getProviderAuthStatus() {
      return { configured: true };
    },
  };
}

test("rejects a model that is not currently available from GitHub Copilot", async () => {
  const db = createTestDatabase();
  try {
    seedContact(db);
    const service = createModelService(db, createRuntime([
      { provider: "github-copilot", id: "copilot-model", name: "Copilot Model" },
    ]));

    await assert.rejects(service.setContactModel("contact-1", "missing-model"), /available.*github-copilot/i);
  } finally {
    db.close();
  }
});

test("persists the selected model only on the selected contact", async () => {
  const db = createTestDatabase();
  try {
    seedContact(db, "contact-1");
    seedContact(db, "contact-2");
    const service = createModelService(db, createRuntime([
      { provider: "github-copilot", id: "copilot-model", name: "Copilot Model" },
    ]));

    const saved = await service.setContactModel("contact-1", "copilot-model");
    assert.equal(saved.modelProvider, "github-copilot");
    assert.equal(saved.modelId, "copilot-model");
    assert.equal(service.getContactModel("contact-2").modelId, "test-model");
  } finally {
    db.close();
  }
});

test("reloads a contact's saved model when creating its next session", async () => {
  const db = createTestDatabase();
  try {
    const contact = seedContact(db);
    seedProject(db);
    seedGroupTask(db);
    const model = { provider: "github-copilot", id: "copilot-model", name: "Copilot Model" };
    const runtime = createRuntime([model]);
    await createModelService(db, runtime).setContactModel(contact.id, model.id);
    const created = [];
    const dataDir = path.join(process.cwd(), ".task3-session-test-data");
    const factory = createSessionFactory({
      db,
      runtime,
      sessionRegistry: createSessionRegistry(),
      dataDir,
      agentDir: "/shared/pi-agent",
      createSession: async (options) => {
        created.push(options);
        return { session: { marker: "session" } };
      },
    });

    await factory.createContactSession(contact.id, { sessionKind: "contact_chat" });
    assert.equal(created[0].model.id, "copilot-model");
    assert.equal(created[0].agentDir, "/shared/pi-agent");
    assert.equal(created[0].noTools, "all");
    const mapping = db.prepare(`
      SELECT contact_id AS contactId, task_id AS taskId, kind, session_file AS sessionFile
      FROM pi_session_mappings
    `).get();
    assert.equal(mapping.contactId, contact.id);
    assert.equal(mapping.taskId, null);
    assert.equal(mapping.kind, "private");
    assert.ok(mapping.sessionFile.includes(path.join(".task3-session-test-data", "sessions")));
  } finally {
    rmSync(path.join(process.cwd(), ".task3-session-test-data"), { recursive: true, force: true });
    db.close();
  }
});

test("task prompts contain only the selected task and its members", async () => {
  const db = createTestDatabase();
  try {
    const firstContact = seedContact(db, "contact-1");
    seedProject(db);
    const { task } = seedGroupTask(db);
    const { task: secondTask } = createGroupTaskRepository(db).createGroupWithTask({
      group: { id: "group-2", name: "Other", description: "Other group" },
      task: { id: "task-2", projectId: "project-1", description: "Secret task context", status: "open" },
    });
    const secondContact = seedContact(db, "contact-2");
    const taskRepo = createGroupTaskRepository(db);
    taskRepo.addTaskMember(task.id, firstContact.id);
    taskRepo.addTaskMember(secondTask.id, secondContact.id);
    db.prepare("UPDATE contacts SET description = ? WHERE id = ?").run("Selected member profile", firstContact.id);
    db.prepare("UPDATE contacts SET description = ? WHERE id = ?").run("Secret other profile", secondContact.id);
    const factory = createSessionFactory({
      db,
      runtime: createRuntime([]),
      sessionRegistry: createSessionRegistry(),
      dataDir: "/achat-test-data",
      createSession: async () => ({ session: { marker: "session" } }),
    });

    const prompt = await factory.buildTaskSystemPrompt(firstContact.id, task.id);
    assert.match(prompt, /Build persistence/);
    assert.match(prompt, /Selected member profile/);
    assert.doesNotMatch(prompt, /Secret task context|Secret other profile/);
  } finally {
    db.close();
  }
});

test("task sessions use their project cwd and never receive contact-chat tools", async () => {
  const db = createTestDatabase();
  try {
    const contact = seedContact(db);
    const project = seedProject(db);
    const { task } = seedGroupTask(db);
    const tasks = createGroupTaskRepository(db);
    tasks.addTaskMember(task.id, contact.id);
    const model = { provider: "github-copilot", id: "test-model", name: "Model" };
    const runtime = createRuntime([model]);
    await createModelService(db, runtime).setContactModel(contact.id, model.id);
    const created = [];
    const dataDir = path.join(process.cwd(), ".task3-session-test-data");
    const factory = createSessionFactory({
      db,
      runtime,
      sessionRegistry: createSessionRegistry(),
      dataDir,
      agentDir: "/shared/pi-agent",
      createSession: async (options) => {
        created.push(options);
        return { session: { marker: "session" } };
      },
    });

    await factory.createContactSession(contact.id, { taskId: task.id, sessionKind: "task" });
    assert.equal(created[0].cwd, project.rootPath);
    assert.equal(created[0].tools.includes("query_contact_sessions"), false);
    assert.equal(created[0].customTools?.length ?? 0, 0);
    const mapping = db.prepare(`
      SELECT contact_id AS contactId, task_id AS taskId, kind
      FROM pi_session_mappings
    `).get();
    assert.equal(mapping.contactId, contact.id);
    assert.equal(mapping.taskId, task.id);
    assert.equal(mapping.kind, "task");
  } finally {
    rmSync(path.join(process.cwd(), ".task3-session-test-data"), { recursive: true, force: true });
    db.close();
  }
});
