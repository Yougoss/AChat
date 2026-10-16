"use client";

import { useState } from "react";
import { UnreadBadge } from "./UnreadBadge.tsx";

interface TaskRunStatus {
  id: string;
  status: string;
  workItemStatus: string;
  contactName: string;
  title: string;
  stuck: "stuck" | "not_stuck" | "unknown";
  lifecycleEvidence: string;
}

interface TaskStatusPanelProps {
  taskId: string;
  taskStatus: string;
  runs: TaskRunStatus[];
  unreadCount: number;
  pendingAttentionCount: number;
  onRetryComplete?: () => Promise<void> | void;
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
  onRetryComplete,
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
      await onRetryComplete?.();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Unable to retry interrupted work");
    } finally {
      setRetrying(false);
    }
  }

  return (
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
  );
}
