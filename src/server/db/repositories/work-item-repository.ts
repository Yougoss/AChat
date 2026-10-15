import type Database from "better-sqlite3";
import type { WorkItem } from "../../domain/types.ts";
import { asRecord, asRecords } from "./repository-utils.ts";

interface CreateWorkItemInput extends Omit<WorkItem, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

interface WorkItemRow {
  id: string;
  taskId: string;
  contactId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function createWorkItemRepository(db: Database.Database) {
  function getWorkItem(id: string): WorkItem | undefined {
    const row = db.prepare(`
      SELECT id, task_id AS taskId, contact_id AS contactId, title, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM work_items WHERE id = ?
    `).get(id);
    return row ? { ...asRecord<WorkItemRow>(row) } : undefined;
  }

  return {
    createWorkItem(input: CreateWorkItemInput): WorkItem {
      const createdAt = input.createdAt ?? new Date().toISOString();
      const updatedAt = input.updatedAt ?? createdAt;
      db.prepare(`
        INSERT INTO work_items (
          id, task_id, contact_id, title, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.taskId,
        input.contactId,
        input.title,
        input.status,
        createdAt,
        updatedAt,
      );
      return { ...input, createdAt, updatedAt };
    },
    getWorkItem,
    listWorkItemsForTask(taskId: string): WorkItem[] {
      return asRecords<WorkItemRow>(db.prepare(`
        SELECT id, task_id AS taskId, contact_id AS contactId, title, status,
               created_at AS createdAt, updated_at AS updatedAt
        FROM work_items WHERE task_id = ? ORDER BY created_at, id
      `).all()).map((row) => ({ ...row }));
    },
    updateWorkItemStatus(id: string, status: string, updatedAt = new Date().toISOString()): WorkItem {
      const result = db.prepare(`
        UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?
      `).run(status, updatedAt, id);
      if (result.changes === 0) throw new Error(`Work item not found: ${id}`);
      return getWorkItem(id)!;
    },
  };
}
