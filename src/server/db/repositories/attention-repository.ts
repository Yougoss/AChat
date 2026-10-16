import type Database from "better-sqlite3";
import type { AttentionRequest } from "../../domain/types.ts";
import { asRecord, asRecords } from "./repository-utils.ts";

export interface CreateAttentionRequestInput extends Omit<
  AttentionRequest,
  "status" | "createdAt" | "resolvedAt"
> {
  createdAt?: string;
}

interface AttentionRequestRow {
  id: string;
  taskId: string;
  workItemId: string;
  runId: string | null;
  approvalId: string | null;
  kind: AttentionRequest["kind"];
  status: AttentionRequest["status"];
  createdAt: string;
  resolvedAt: string | null;
}

export function createAttentionRepository(db: Database.Database) {
  function getAttentionRequest(id: string): AttentionRequest | undefined {
    const row = db.prepare(`
      SELECT id, task_id AS taskId, work_item_id AS workItemId,
             run_id AS runId, approval_id AS approvalId, kind, status,
             created_at AS createdAt, resolved_at AS resolvedAt
      FROM attention_requests WHERE id = ?
    `).get(id);
    return row ? { ...asRecord<AttentionRequestRow>(row) } : undefined;
  }

  return {
    createAttentionRequest(input: CreateAttentionRequestInput): AttentionRequest {
      const request: AttentionRequest = {
        ...input,
        status: "open",
        createdAt: input.createdAt ?? new Date().toISOString(),
        resolvedAt: null,
      };
      db.prepare(`
        INSERT INTO attention_requests (
          id, task_id, work_item_id, run_id, approval_id, kind, status, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.id,
        request.taskId,
        request.workItemId,
        request.runId,
        request.approvalId,
        request.kind,
        request.status,
        request.createdAt,
        request.resolvedAt,
      );
      return request;
    },
    getAttentionRequest,
    listAttentionRequestsForTask(taskId: string): AttentionRequest[] {
      return asRecords<AttentionRequestRow>(db.prepare(`
        SELECT id, task_id AS taskId, work_item_id AS workItemId,
               run_id AS runId, approval_id AS approvalId, kind, status,
               created_at AS createdAt, resolved_at AS resolvedAt
        FROM attention_requests WHERE task_id = ? ORDER BY created_at, id
      `).all(taskId)).map((row) => ({ ...row }));
    },
    resolveAttentionRequest(
      id: string,
      status: "resolved" | "cancelled",
    ): AttentionRequest {
      const result = db.prepare(`
        UPDATE attention_requests SET status = ?, resolved_at = ?
        WHERE id = ? AND status = 'open'
      `).run(status, new Date().toISOString(), id);
      if (result.changes === 0) {
        throw new Error(`Open attention request not found: ${id}`);
      }
      return getAttentionRequest(id)!;
    },
  };
}
