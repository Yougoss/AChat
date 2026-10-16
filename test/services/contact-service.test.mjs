import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { createTestDatabase, seedContact, seedProject } from "../db/helpers.mjs";
import { createContactService } from "../../src/server/services/contact-service.ts";
import { createWorkspaceService } from "../../src/server/services/workspace-service.ts";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";

function createRuntime(models = [
  { provider: "github-copilot", id: "model-a", name: "Model A" },
  { provider: "github-copilot", id: "model-b", name: "Model B" },
]) {
  return { async getAvailable(provider) {
    assert.equal(provider, "github-copilot");
    return models;
  } };
}

test("creates a contact with its selected available model persisted", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const service = createContactService(db, {
    runtime: createRuntime(),
    idFactory: () => "contact-new",
  });

  const contact = await service.createContact({
    name: "Researcher",
    description: "Tracks evidence",
    modelProvider: "github-copilot",
    modelId: "model-b",
  });

  assert.deepEqual(contact, {
    id: "contact-new",
    name: "Researcher",
    description: "Tracks evidence",
    modelProvider: "github-copilot",
    modelId: "model-b",
  });
  assert.equal((await service.getContact("contact-new")).modelId, "model-b");
});

test("rejects a contact model that is not currently available", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const service = createContactService(db, {
    runtime: createRuntime([]),
    idFactory: () => "contact-new",
  });

  await assert.rejects(
    service.createContact({
      name: "Researcher",
      description: "",
      modelProvider: "github-copilot",
      modelId: "missing",
    }),
    /not currently available/i,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 0);
});

test("creates one group and one task in a registered project without creating a worktree", (t) => {
  const db = createTestDatabase();
  const rootPath = process.cwd();
  t.after(() => db.close());
  const project = createWorkspaceService(db, {
    idFactory: (() => {
      const ids = ["group-new", "task-new"];
      return () => ids.shift();
    })(),
  }).createProject({ name: "Selected", rootPath });
  const contact = seedContact(db, "contact-selected");
  const service = createWorkspaceService(db, {
    idFactory: (() => {
      const ids = ["group-created", "task-created"];
      return () => ids.shift();
    })(),
  });
  const before = new Set(readdirSync(rootPath));

  const created = service.createGroupAndTask({
    name: "Evidence review",
    description: "Review recent findings",
    projectId: project.id,
    contactIds: [contact.id],
  });

  assert.equal(created.group.id, "group-created");
  assert.equal(created.task.groupId, created.group.id);
  assert.equal(created.task.projectId, project.id);
  assert.equal(created.task.description, "Review recent findings");
  assert.deepEqual(createGroupTaskRepository(db).listGroupMembers(created.group.id), [contact.id]);
  assert.deepEqual(createGroupTaskRepository(db).listTaskMembers(created.task.id), [contact.id]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM groups").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
  assert.deepEqual(new Set(readdirSync(rootPath)), before);
  assert.equal(before.has(".worktrees"), readdirSync(rootPath).includes(".worktrees"));
});

test("allows an empty task description at creation time", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const service = createWorkspaceService(db, {
    idFactory: (() => {
      const ids = ["group-empty", "task-empty"];
      return () => ids.shift();
    })(),
  });

  const { task } = service.createGroupAndTask({
    name: "Unspecified work",
    description: "",
    projectId: "project-1",
    contactIds: ["contact-1"],
  });

  assert.equal(task.description, "");
});

test("rejects task creation for an unregistered project", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db);
  const service = createWorkspaceService(db);

  assert.throws(() => service.createGroupAndTask({
    name: "Unmapped work",
    description: "",
    projectId: "not-registered",
    contactIds: ["contact-1"],
  }), /registered project/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM groups").get().count, 0);
});

test("long-task recognition returns a reviewable draft without creating or dispatching work", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db, "contact-1");
  const service = createContactService(db, {
    runtime: createRuntime(),
    idFactory: () => "unused",
  });
  const draft = service.proposeLongTask(
    "contact-1",
    "Compare the last release notes and prepare a concise risk assessment.",
  );

  assert.equal(draft.contactIds[0], "contact-1");
  assert.match(draft.description, /Compare the last release notes/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM groups").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM runs").get().count, 0);
});
