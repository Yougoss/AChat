import type Database from "better-sqlite3";
import type { Group, Task } from "../../domain/types.ts";
import { createEventRepository, type AppendTaskEventInput } from "./event-repository.ts";
import { asRecord, asRecords } from "./repository-utils.ts";

interface GroupRow {
  id: string;
  name: string;
  description: string;
}

interface TaskRow {
  id: string;
  groupId: string;
  projectId: string;
  description: string;
  status: string;
}

export interface CreateGroupWithTaskInput {
  group: Group;
  task: Omit<Task, "groupId">;
}

export function createGroupTaskRepository(db: Database.Database) {
  const eventRepository = createEventRepository(db);
  const insertGroupAndTask = db.transaction((input: CreateGroupWithTaskInput) => {
    db.prepare("INSERT INTO groups (id, name, description) VALUES (?, ?, ?)")
      .run(input.group.id, input.group.name, input.group.description);
    db.prepare(`
      INSERT INTO tasks (id, group_id, project_id, description, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.task.id,
      input.group.id,
      input.task.projectId,
      input.task.description,
      input.task.status,
    );
  });

  function getTaskByGroupId(groupId: string): Task | undefined {
    const row = db.prepare(`
      SELECT id, group_id AS groupId, project_id AS projectId, description, status
      FROM tasks WHERE group_id = ?
    `).get(groupId);
    return row ? { ...asRecord<TaskRow>(row) } : undefined;
  }

  return {
    createGroupWithTask(input: CreateGroupWithTaskInput): { group: Group; task: Task } {
      insertGroupAndTask(input);
      return {
        group: { ...input.group },
        task: { ...input.task, groupId: input.group.id },
      };
    },
    getGroup(id: string): Group | undefined {
      const row = db.prepare("SELECT id, name, description FROM groups WHERE id = ?").get(id);
      return row ? { ...asRecord<GroupRow>(row) } : undefined;
    },
    getTask(id: string): Task | undefined {
      const row = db.prepare(`
        SELECT id, group_id AS groupId, project_id AS projectId, description, status
        FROM tasks WHERE id = ?
      `).get(id);
      return row ? { ...asRecord<TaskRow>(row) } : undefined;
    },
    getTaskByGroupId,
    addGroupMember(groupId: string, contactId: string, role = "member"): void {
      db.prepare(`
        INSERT INTO group_members (group_id, contact_id, role) VALUES (?, ?, ?)
      `).run(groupId, contactId, role);
    },
    listGroupMembers(groupId: string): string[] {
      return asRecords<{ contact_id: string }>(db.prepare(`
        SELECT contact_id FROM group_members WHERE group_id = ? ORDER BY contact_id
      `).all(groupId)).map(({ contact_id }) => contact_id);
    },
    addTaskMember(taskId: string, contactId: string, role = "member"): void {
      db.prepare(`
        INSERT INTO task_members (task_id, contact_id, role) VALUES (?, ?, ?)
      `).run(taskId, contactId, role);
    },
    listTaskMembers(taskId: string): string[] {
      return asRecords<{ contact_id: string }>(db.prepare(`
        SELECT contact_id FROM task_members WHERE task_id = ? ORDER BY contact_id
      `).all(taskId)).map(({ contact_id }) => contact_id);
    },
    appendTaskEvent: eventRepository.appendTaskEvent,
    listTaskEvents: eventRepository.listTaskEvents,
  };
}
