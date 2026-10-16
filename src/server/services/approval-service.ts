import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Approval } from "../domain/types.ts";
import { createApprovalRepository } from "../db/repositories/approval-repository.ts";
import { createAttentionRepository } from "../db/repositories/attention-repository.ts";
import { createEventRepository } from "../db/repositories/event-repository.ts";

export interface ToolApprovalContext {
  taskId: string;
  workItemId: string;
  runId: string;
  piSessionId: string;
  toolCallId: string;
}

export interface ApprovalDecisionInput {
  decision: "approve" | "deny";
}

interface DeferredDecision {
  promise: Promise<"approved" | "denied">;
  resolve: (decision: "approved" | "denied") => void;
  requestKey: string;
  context: ToolApprovalContext;
}

class StaleApprovalError extends Error {}

interface ApprovalWaitState {
  pending: Map<string, DeferredDecision>;
  activeToolCalls: Set<string>;
}

const waitStates = new WeakMap<Database.Database, ApprovalWaitState>();

function getWaitState(db: Database.Database): ApprovalWaitState {
  let state = waitStates.get(db);
  if (!state) {
    state = { pending: new Map(), activeToolCalls: new Set() };
    waitStates.set(db, state);
  }
  return state;
}

function isDecisionInput(value: unknown): value is ApprovalDecisionInput {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1
    && keys[0] === "decision"
    && "decision" in value
    && (value.decision === "approve" || value.decision === "deny");
}

export function createApprovalService(
  db: Database.Database,
  options: { idFactory?: () => string; now?: () => string } = {},
) {
  const approvals = createApprovalRepository(db);
  const attention = createAttentionRepository(db);
  const events = createEventRepository(db);
  const waitState = getWaitState(db);
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  function assertScope(context: ToolApprovalContext, stale = false): void {
    if (
      !context.taskId || !context.workItemId || !context.runId
      || !context.piSessionId || !context.toolCallId
    ) {
      throw stale
        ? new StaleApprovalError("Stale approval: bound server scope is incomplete")
        : new Error("Approval server scope is incomplete");
    }
    const scope = db.prepare(`
      SELECT 1
      FROM work_items
      JOIN runs ON runs.work_item_id = work_items.id
        AND runs.task_id = work_items.task_id
        AND runs.contact_id = work_items.contact_id
      JOIN pi_session_mappings
        ON pi_session_mappings.task_id = work_items.task_id
        AND pi_session_mappings.contact_id = work_items.contact_id
      WHERE work_items.id = ?
        AND work_items.task_id = ?
        AND work_items.status = 'running'
        AND runs.id = ?
        AND runs.status = 'running'
        AND pi_session_mappings.pi_session_id = ?
        AND pi_session_mappings.kind = 'task'
    `).get(context.workItemId, context.taskId, context.runId, context.piSessionId);
    if (!scope) {
      throw stale
        ? new StaleApprovalError("Stale approval: the bound task, work item, run, or Pi session is no longer active")
        : new Error("Approval scope does not match the active task, work item, run, and Pi session");
    }
  }

  function appendApprovalEvent(
    approval: Approval,
    type: string,
    extra: Record<string, unknown> = {},
  ): void {
    events.appendEvent({
      id: `${approval.id}:${type}`,
      entityType: "approval",
      entityId: approval.id,
      type,
      payload: {
        approvalId: approval.id,
        taskId: approval.taskId,
        workItemId: approval.workItemId,
        piSessionId: approval.piSessionId,
        toolCallId: approval.toolCallId,
        action: approval.action,
        status: approval.status,
        ...extra,
      },
      idempotencyKey: `${approval.id}:${type}`,
      createdAt: now(),
    });
  }

  return {
    async requestToolApproval(
      context: ToolApprovalContext,
      action: unknown,
    ): Promise<"approved" | "denied"> {
      assertScope(context);
      const requestKey = JSON.stringify([
        context.taskId,
        context.workItemId,
        context.piSessionId,
        context.toolCallId,
      ]);
      if (waitState.activeToolCalls.has(requestKey)) {
        throw new Error(`A tool approval is already waiting for call ${context.toolCallId}`);
      }
      let resolve!: DeferredDecision["resolve"];
      const deferred: DeferredDecision = {
        promise: new Promise((complete) => {
          resolve = complete;
        }),
        resolve: (decision) => resolve(decision),
        requestKey,
        context: { ...context },
      };
      const approvalId = idFactory();
      if (waitState.pending.has(approvalId)) {
        throw new Error(`Approval ID is already pending: ${approvalId}`);
      }
      waitState.pending.set(approvalId, deferred);
      waitState.activeToolCalls.add(requestKey);
      try {
        db.transaction(() => {
          const approval = approvals.createApproval({
            id: approvalId,
            taskId: context.taskId,
            workItemId: context.workItemId,
            piSessionId: context.piSessionId,
            toolCallId: context.toolCallId,
            action,
            status: "pending",
            createdAt: now(),
            decidedAt: null,
          });
          attention.createAttentionRequest({
            id: `${approvalId}:attention`,
            taskId: context.taskId,
            workItemId: context.workItemId,
            runId: context.runId,
            approvalId,
            kind: "approval",
            createdAt: now(),
          });
          appendApprovalEvent(approval, "approval.requested");
        })();
      } catch (error) {
        waitState.pending.delete(approvalId);
        waitState.activeToolCalls.delete(requestKey);
        throw error;
      }
      return deferred.promise;
    },
    async decideToolApproval(approvalId: string, input: ApprovalDecisionInput): Promise<Approval> {
      if (!isDecisionInput(input)) {
        throw new Error("Approval decisions accept only a decision; scope fields are not accepted");
      }
      const deferred = waitState.pending.get(approvalId);
      if (!deferred) throw new Error(`Stale or pending approval not found: ${approvalId}`);
      const approval = approvals.getApproval(approvalId);
      if (!approval || approval.status !== "pending") {
        waitState.pending.delete(approvalId);
        throw new Error(`Stale or pending approval not found: ${approvalId}`);
      }
      const status = input.decision === "approve" ? "approved" : "denied";
      const decidedAt = now();
      let staleError: StaleApprovalError | undefined;
      const resolved = db.transaction(() => {
        try {
          assertScope(deferred.context, true);
        } catch (error) {
          if (!(error instanceof StaleApprovalError)) throw error;
          staleError = error;
          const denied = approvals.updateApprovalStatus(approvalId, "denied", decidedAt);
          attention.resolveAttentionRequest(`${approvalId}:attention`, "resolved");
          appendApprovalEvent(denied, "approval.decided", { decidedAt, stale: true });
          return denied;
        }
        const updated = approvals.updateApprovalStatus(approvalId, status, decidedAt);
        attention.resolveAttentionRequest(`${approvalId}:attention`, "resolved");
        appendApprovalEvent(updated, "approval.decided", { decidedAt });
        return updated;
      })();
      waitState.pending.delete(approvalId);
      waitState.activeToolCalls.delete(deferred.requestKey);
      if (staleError) {
        deferred.resolve("denied");
        throw staleError;
      }
      deferred.resolve(status);
      return resolved;
    },
    listPendingApprovals(taskId: string): Approval[] {
      return approvals.listApprovalsForTask(taskId)
        .filter((approval) => approval.status === "pending");
    },
  };
}
