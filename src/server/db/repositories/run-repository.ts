import type Database from "better-sqlite3";
import type { Run } from "../../domain/types.ts";
import { asRecord, asRecords } from "./repository-utils.ts";

export interface CreateRunInput extends Omit<Run, "completedAt"> {
  completedAt?: string | null;
}

interface RunRow {
  id: string;
  taskId: string;
  workItemId: string;
  contactId: string;
  attempt: number;
  status: Run["status"];
  startedAt: string;
  completedAt: string | null;
}

export function createRunRepository(db: Database.Database) {
  function getRun(id: string): Run | undefined {
    const row = db.prepare(`
      SELECT id, task_id AS taskId, work_item_id AS workItemId,
             contact_id AS contactId, attempt, status, started_at AS startedAt,
             completed_at AS completedAt
      FROM runs WHERE id = ?
    `).get(id);
    return row ? { ...asRecord<RunRow>(row) } : undefined;
  }

  return {
    createRun(input: CreateRunInput): Run {
      const run: Run = {
        ...input,
        completedAt: input.completedAt
          ?? (input.status === "running" ? null : new Date().toISOString()),
      };
      db.prepare(`
        INSERT INTO runs (
          id, task_id, work_item_id, contact_id, attempt, status, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.taskId,
        run.workItemId,
        run.contactId,
        run.attempt,
        run.status,
        run.startedAt,
        run.completedAt,
      );
      return run;
    },
    getRun,
    listRunsForWorkItem(workItemId: string): Run[] {
      return asRecords<RunRow>(db.prepare(`
        SELECT id, task_id AS taskId, work_item_id AS workItemId,
               contact_id AS contactId, attempt, status, started_at AS startedAt,
               completed_at AS completedAt
        FROM runs WHERE work_item_id = ? ORDER BY attempt, id
      `).all(workItemId)).map((row) => ({ ...row }));
    },
    updateRunStatus(
      id: string,
      status: Run["status"],
      completedAt: string | null = null,
    ): Run {
      const result = db.prepare(`
        UPDATE runs SET status = ?, completed_at = ? WHERE id = ?
      `).run(status, status === "running" ? null : completedAt ?? new Date().toISOString(), id);
      if (result.changes === 0) throw new Error(`Run not found: ${id}`);
      return getRun(id)!;
    },
  };
}
