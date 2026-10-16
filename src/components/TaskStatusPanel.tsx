import { UnreadBadge } from "./UnreadBadge.tsx";

interface TaskRunStatus {
  id: string;
  status: string;
  contactName: string;
  title: string;
  stuck: "stuck" | "not_stuck" | "unknown";
  lifecycleEvidence: string;
}

interface TaskStatusPanelProps {
  taskStatus: string;
  runs: TaskRunStatus[];
  unreadCount: number;
  pendingAttentionCount: number;
}

function stuckLabel(state: TaskRunStatus["stuck"]): string {
  if (state === "stuck") return "Possibly stuck";
  if (state === "unknown") return "Stuck status unknown";
  return "Not stuck";
}

export function TaskStatusPanel({
  taskStatus,
  runs,
  unreadCount,
  pendingAttentionCount,
}: TaskStatusPanelProps) {
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
    </section>
  );
}
