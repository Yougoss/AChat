import Database from "better-sqlite3";
import { migrate } from "../../src/server/db/client.ts";
import { createAgentRepository } from "../../src/server/db/repositories/agent-repository.ts";
import { createProjectRepository } from "../../src/server/db/repositories/project-repository.ts";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";

export function createTestDatabase() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

export function seedProject(db, id = "project-1") {
  return createProjectRepository(db).createProject({
    id,
    name: "AChat",
    rootPath: process.cwd(),
  });
}

export function seedContact(db, id = "contact-1") {
  return createAgentRepository(db).createContact({
    id,
    name: "Builder",
    description: "Project builder",
    modelProvider: "test-provider",
    modelId: "test-model",
  });
}

export function seedGroupTask(db, projectId = "project-1") {
  const { group, task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Planning group" },
    task: {
      id: "task-1",
      projectId,
      description: "Build persistence",
      status: "open",
    },
  });
  return { group, task };
}
