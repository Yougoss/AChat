import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Group, Project, Task } from "../domain/types.ts";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";
import { createAgentRepository } from "../db/repositories/agent-repository.ts";
import { createGroupTaskRepository } from "../db/repositories/group-task-repository.ts";
import { createProjectRepository } from "../db/repositories/project-repository.ts";

export interface CreateGroupAndTaskInput {
  name: string;
  description?: string;
  projectId: string;
  contactIds: string[];
}

interface WorkspaceServiceOptions {
  idFactory?: () => string;
}

export function createWorkspaceService(
  db: Database.Database,
  options: WorkspaceServiceOptions = {},
) {
  const projects = createProjectRepository(db);
  const tasks = createGroupTaskRepository(db);
  const contacts = createAgentRepository(db);
  const idFactory = options.idFactory ?? randomUUID;

  return {
    createProject(input: { name: string; rootPath: string }): Project {
      const name = input.name.trim();
      if (!name) throw new Error("Project name is required");
      if (!input.rootPath.trim()) throw new Error("Project root path is required");
      return projects.createProject({
        id: idFactory(),
        name,
        rootPath: input.rootPath,
      });
    },
    listProjects(): Project[] {
      return projects.listProjects();
    },
    createGroupAndTask(input: CreateGroupAndTaskInput): { group: Group; task: Task } {
      const name = input.name.trim();
      if (!name) throw new Error("Group name is required");
      if (!projects.getProject(input.projectId)) {
        throw new Error(`Task must use a registered project: ${input.projectId}`);
      }
      const contactIds = [...new Set(input.contactIds)];
      if (!contactIds.length) throw new Error("Select at least one group contact");
      if (contactIds.length !== input.contactIds.length) {
        throw new Error("A contact can only be selected once");
      }
      for (const contactId of contactIds) {
        if (!contacts.getContact(contactId)) throw new Error(`Contact not found: ${contactId}`);
      }

      const group: Group = {
        id: idFactory(),
        name,
        description: input.description?.trim() ?? "",
      };
      const task: Task = {
        id: idFactory(),
        groupId: group.id,
        projectId: input.projectId,
        description: input.description?.trim() ?? "",
        status: "open",
      };
      const createPair = db.transaction(() => {
        const created = tasks.createGroupWithTask({ group, task });
        for (const contactId of contactIds) {
          tasks.addGroupMember(group.id, contactId);
          tasks.addTaskMember(task.id, contactId);
        }
        return created;
      });
      return createPair();
    },
    listTaskMembers(taskId: string): string[] {
      return tasks.listTaskMembers(taskId);
    },
  };
}

async function withWorkspaceService<T>(
  operation: (service: ReturnType<typeof createWorkspaceService>) => T | Promise<T>,
): Promise<T> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return await operation(createWorkspaceService(db));
  } finally {
    db.close();
  }
}

export function createProject(input: { name: string; rootPath: string }): Promise<Project> {
  return withWorkspaceService((service) => service.createProject(input));
}

export function listProjects(): Promise<Project[]> {
  return withWorkspaceService((service) => service.listProjects());
}

export function createGroupAndTask(
  input: CreateGroupAndTaskInput,
): Promise<{ group: Group; task: Task }> {
  return withWorkspaceService((service) => service.createGroupAndTask(input));
}
