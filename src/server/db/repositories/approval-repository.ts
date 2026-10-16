import type Database from "better-sqlite3";
import type { Approval } from "../../domain/types.ts";
import { asRecord, asRecords, deserialize, serialize } from "./repository-utils.ts";

export interface CreateApprovalInput extends Omit<Approval, "decidedAt"> {
  decidedAt?: string | null;
}

interface ApprovalRow {
  id: string;
  taskId: string;
  workItemId: string;
  piSessionId: string;
  toolCallId: string;
  actionJson: string;
  status: Approval["status"];
  createdAt: string;
  decidedAt: string | null;
}

function rowToApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    taskId: row.taskId,
    workItemId: row.workItemId,
    piSessionId: row.piSessionId,
    toolCallId: row.toolCallId,
    action: deserialize(row.actionJson),
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export function createApprovalRepository(db: Database.Database) {
  function getApproval(id: string): Approval | undefined {
    const row = db.prepare(`
      SELECT id, task_id AS taskId, work_item_id AS workItemId,
             pi_session_id AS piSessionId, tool_call_id AS toolCallId,
             action_json AS actionJson, status, created_at AS createdAt,
             decided_at AS decidedAt
      FROM approvals WHERE id = ?
    `).get(id);
    return row ? rowToApproval(asRecord<ApprovalRow>(row)) : undefined;
  }

  return {
    createApproval(input: CreateApprovalInput): Approval {
      const approval: Approval = {
        ...input,
        decidedAt: input.decidedAt
          ?? (input.status === "pending" ? null : new Date().toISOString()),
      };
      db.prepare(`
        INSERT INTO approvals (
          id, task_id, work_item_id, pi_session_id, tool_call_id, action_json,
          status, created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approval.id,
        approval.taskId,
        approval.workItemId,
        approval.piSessionId,
        approval.toolCallId,
        serialize(approval.action),
        approval.status,
        approval.createdAt,
        approval.decidedAt,
      );
      return approval;
    },
    getApproval,
    listApprovalsForTask(taskId: string): Approval[] {
      return asRecords<ApprovalRow>(db.prepare(`
        SELECT id, task_id AS taskId, work_item_id AS workItemId,
               pi_session_id AS piSessionId, tool_call_id AS toolCallId,
               action_json AS actionJson, status, created_at AS createdAt,
               decided_at AS decidedAt
        FROM approvals WHERE task_id = ? ORDER BY created_at, id
      `).all(taskId)).map(rowToApproval);
    },
    updateApprovalStatus(
      id: string,
      status: Exclude<Approval["status"], "pending">,
      decidedAt = new Date().toISOString(),
    ): Approval {
      const result = db.prepare(`
        UPDATE approvals SET status = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(status, decidedAt, id);
      if (result.changes === 0) {
        throw new Error(`Pending approval not found: ${id}`);
      }
      return getApproval(id)!;
    },
  };
}
