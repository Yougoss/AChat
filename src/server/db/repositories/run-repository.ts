import type Database from "better-sqlite3";
import type { Run } from "../../domain/types.ts";
import { asRecord, asRecords } from "./repository-utils.ts";

export interface CreateRunInput extends Omit<Run, "completedAt" | "status"> {
  status: "running";
  completedAt?: null;
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
        completedAt: null,
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
      status: "failed" | "interrupted",
      completedAt: string | null = null,
    ): Run {
      const result = db.prepare(`
        UPDATE runs SET status = ?, completed_at = ? WHERE id = ?
      `).run(status, completedAt ?? new Date().toISOString(), id);
      if (result.changes === 0) throw new Error(`Run not found: ${id}`);
      return getRun(id)!;
    },
    completeRun(id: string, completedAt: string): Run {
      const complete = db.transaction((runId: string, at: string) => {
        const row = db.prepare(`
          SELECT runs.id, runs.task_id AS taskId, runs.status, tasks.group_id AS groupId
          FROM runs JOIN tasks ON tasks.id = runs.task_id
          WHERE runs.id = ?
        `).get(runId) as {
          id: string;
          taskId: string;
          status: Run["status"];
          groupId: string;
        } | undefined;
        if (!row) throw new Error(`Run not found: ${runId}`);
        if (row.status !== "running") {
          throw new Error(`Run is not running and cannot be completed: ${runId}`);
        }
        db.prepare(`
          UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?
        `).run(at, runId);
      });
      complete(id, completedAt);
      return getRun(id)!;
    },
  };
}
