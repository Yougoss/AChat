import type Database from "better-sqlite3";
import type { RunCompletion } from "../../domain/types.ts";
import { asRecords } from "./repository-utils.ts";

interface RunCompletionRow {
  cursor: number;
  runId: string;
  taskId: string;
  groupId: string;
  completedAt: string;
}

export function createUnreadRepository(db: Database.Database) {
  return {
    countUnreadRuns(groupId: string): number {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM run_completions
        WHERE group_id = ?
          AND cursor > COALESCE((
            SELECT cursor FROM group_run_read_cursors WHERE group_id = ?
          ), 0)
      `).get(groupId, groupId) as { count: number };
      return row.count;
    },
    markGroupRunsRead(groupId: string): void {
      db.prepare(`
        INSERT INTO group_run_read_cursors (group_id, cursor, updated_at)
        VALUES (
          ?,
          COALESCE((
            SELECT MAX(cursor) FROM run_completions WHERE group_id = ?
          ), 0),
          ?
        )
        ON CONFLICT(group_id) DO UPDATE SET
          cursor = MAX(group_run_read_cursors.cursor, excluded.cursor),
          updated_at = excluded.updated_at
      `).run(groupId, groupId, new Date().toISOString());
    },
    getGroupRunReadCursor(groupId: string): number {
      const row = db.prepare(`
        SELECT cursor FROM group_run_read_cursors WHERE group_id = ?
      `).get(groupId) as { cursor: number } | undefined;
      return row?.cursor ?? 0;
    },
    listRunCompletions(groupId?: string): RunCompletion[] {
      const rows = groupId === undefined
        ? db.prepare(`
          SELECT cursor, run_id AS runId, task_id AS taskId,
                 group_id AS groupId, completed_at AS completedAt
          FROM run_completions ORDER BY cursor
        `).all()
        : db.prepare(`
          SELECT cursor, run_id AS runId, task_id AS taskId,
                 group_id AS groupId, completed_at AS completedAt
          FROM run_completions WHERE group_id = ? ORDER BY cursor
        `).all(groupId);
      return asRecords<RunCompletionRow>(rows).map((row) => ({ ...row }));
    },
  };
}
