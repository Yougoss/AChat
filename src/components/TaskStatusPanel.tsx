"use client";

import { useState } from "react";
import type { Approval, Run } from "../server/domain/types.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { RunProcessView } from "./RunProcessView.tsx";
import { UnreadBadge } from "./UnreadBadge.tsx";

interface TaskRunStatus extends Run {
  workItemStatus: string;
  contactName: string;
  title: string;
  stuck: "stuck" | "not_stuck" | "unknown";
  lifecycleEvidence: string;
  events?: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
}

interface TaskStatusPanelProps {
  taskId: string;
  taskStatus: string;
  runs: TaskRunStatus[];
  unreadCount: number;
  pendingAttentionCount: number;
  approvals?: Approval[];
  onMarkRunsRead?: () => void;
  onRefresh?: () => Promise<void> | void;
}

function stuckLabel(state: TaskRunStatus["stuck"]): string {
  if (state === "stuck") return "Possibly stuck";
  if (state === "unknown") return "Stuck status unknown";
  return "Not stuck";
}

export function TaskStatusPanel({
  taskId,
  taskStatus,
  runs,
  unreadCount,
  pendingAttentionCount,
  approvals = [],
  onMarkRunsRead,
  onRefresh,
}: TaskStatusPanelProps) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  async function retryInterrupted() {
    setRetrying(true);
    setRetryError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to retry interrupted work");
      }
      await onRefresh?.();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Unable to retry interrupted work");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <details className="task-information">
      <summary>
        <span>Task information</span>
        <span className="task-information-signals">
          {taskStatus} · {runs.length} {runs.length === 1 ? "run" : "runs"}
          {unreadCount ? ` · ${unreadCount} unread` : ""}
          {pendingAttentionCount ? ` · ${pendingAttentionCount} waiting` : ""}
        </span>
      </summary>
      <div className="task-information-body">
        <section className="task-status-panel" aria-labelledby="task-status-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Independent signals</p>
              <h2 id="task-status-title">Task status</h2>
            </div>
            <UnreadBadge count={unreadCount} />
          </div>
          <dl className="task-status-grid">
            <div>
              <dt>Task</dt>
              <dd>{taskStatus}</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>{runs.some((run) => run.status === "running") ? "Running" : "Idle"}</dd>
            </div>
            <div>
              <dt>Attention</dt>
              <dd>{pendingAttentionCount ? `${pendingAttentionCount} waiting` : "No requests"}</dd>
            </div>
          </dl>
          {unreadCount > 0 ? (
            <button className="button button-quiet task-mark-read" type="button" onClick={onMarkRunsRead}>
              Mark runs read
            </button>
          ) : null}
          {!runs.length ? (
            <p className="status-empty">No runs have been dispatched for this task.</p>
          ) : (
            <ul className="task-run-status-list" aria-label="Run status">
              {runs.map((run) => (
                <li key={run.id}>
                  <span>
                    <strong>{run.contactName}</strong>
                    <span>{run.title}</span>
                  </span>
                  <span className={`run-status run-status-${run.status}`}>{run.status}</span>
                  <span className={`stuck-state stuck-state-${run.stuck}`} role="status">
                    {stuckLabel(run.stuck)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {runs.some((run) => run.workItemStatus === "interrupted") ? (
            <div className="task-retry">
              <p className="evidence-meta">
                Retry starts a new run in the task’s existing Pi session; prior run evidence is kept.
              </p>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => void retryInterrupted()}
                disabled={retrying}
              >
                {retrying ? "Retrying interrupted work…" : "Retry interrupted work"}
              </button>
              {retryError ? <p className="form-error" role="alert">{retryError}</p> : null}
            </div>
          ) : null}
        </section>
        <section className="approval-section" aria-labelledby="approval-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Action gate</p>
              <h2 id="approval-title">Approvals</h2>
            </div>
          </div>
          {!approvals.length ? (
            <p className="approval-empty">No actions are waiting for approval.</p>
          ) : (
            <div className="approval-list">
              {approvals.map((approval) => (
                <ApprovalCard approval={approval} key={approval.id} onDecided={() => void onRefresh?.()} />
              ))}
            </div>
          )}
        </section>
        <RunProcessView runs={runs} />
      </div>
    </details>
  );
}
