"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { Run } from "../server/domain/types.ts";
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
  open: boolean;
  taskId: string;
  taskGoal: string;
  participants: string[];
  taskGoalActions?: ReactNode;
  taskStatus: string;
  runs: TaskRunStatus[];
  unreadCount: number;
  pendingAttentionCount: number;
  onClose: () => void;
  onMarkRunsRead?: () => void;
  onRefresh?: () => Promise<void> | void;
}

function stuckLabel(state: TaskRunStatus["stuck"]): string {
  if (state === "stuck") return "Possibly stuck";
  if (state === "unknown") return "Stuck status unknown";
  return "Not stuck";
}

export function TaskStatusPanel({
  open,
  taskId,
  taskGoal,
  participants,
  taskGoalActions,
  taskStatus,
  runs,
  unreadCount,
  pendingAttentionCount,
  onClose,
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

  if (!open) return null;

  return (
    <aside
      id="task-information-drawer"
      className="task-information-drawer"
      aria-label="Task information"
    >
      <header className="task-drawer-header">
        <h2>Task information</h2>
        <div className="task-drawer-actions">
          <button className="button button-quiet" type="button" onClick={() => void onRefresh?.()}>
            Refresh activity
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Close task information"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <div className="task-information-body">
        <section className="task-goal-card" aria-labelledby="task-goal-title">
          <h3 id="task-goal-title">Task goal</h3>
          <p>{taskGoal || "No task description yet."}</p>
          {taskGoalActions}
        </section>
        <section className="task-participants" aria-labelledby="task-participants-title">
          <h3 id="task-participants-title">Participants</h3>
          {participants.length ? (
            <ul className="task-participant-list">
              {participants.map((participant) => (
                <li key={participant}>{participant}</li>
              ))}
            </ul>
          ) : (
            <p className="status-empty">No participants.</p>
          )}
        </section>
        <section className="task-status-panel" aria-labelledby="task-status-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current activity</p>
              <h3 id="task-status-title">Task status</h3>
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
        <RunProcessView runs={runs} />
      </div>
    </aside>
  );
}
