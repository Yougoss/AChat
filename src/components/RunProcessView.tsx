import type { Run } from "../server/domain/types.ts";

interface RunProcessViewProps {
  runs: Array<Run & {
    contactName: string;
    title: string;
    events?: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
  }>;
}

function eventSummary(type: string, payload: Record<string, unknown>): string {
  if (type === "text.delta" || type === "final_message") {
    return String(payload.text ?? "");
  }
  if (type === "tool.started") return `Calling ${String(payload.toolName ?? "tool")}`;
  if (type === "tool.completed") {
    const result = payload.result;
    const detail = Array.isArray(result)
      ? result.map((part) => (
          typeof part === "object" && part !== null && "text" in part
            ? String(part.text)
            : ""
        )).join(" ")
      : "";
    return `${String(payload.toolName ?? "Tool")} result${detail ? `: ${detail}` : ""}`;
  }
  if (type === "run.error") return `Error: ${String(payload.message ?? "Unknown error")}`;
  if (type === "run.aborted") return String(payload.reason ?? "Run aborted");
  if (type === "run.failed") return "Run failed";
  if (type === "run.interrupted") return "Run interrupted";
  if (type === "run.started") return "Run started";
  if (type === "run.completed") return "Run completed";
  return type;
}

export function RunProcessView({ runs }: RunProcessViewProps) {
  return (
    <section className="run-process-panel" aria-labelledby="run-process-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Execution ledger</p>
          <h2 id="run-process-title">Runs</h2>
        </div>
        <span className="evidence-meta">{runs.length} attempts</span>
      </div>
      {!runs.length ? (
        <p className="run-empty">No work has been dispatched. Mention a member with @contact or use @all.</p>
      ) : (
        <ol className="run-list" aria-label="Task runs">
          {runs.map((run) => (
            <li className="run-card" key={run.id}>
              <div className="run-card-heading">
                <strong>{run.contactName}</strong>
                <span className={`run-status run-status-${run.status}`}>{run.status}</span>
              </div>
              <p>{run.title}</p>
              <div className="run-metadata">
                <span>Attempt {run.attempt}</span>
                <span>{run.id}</span>
                <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time>
              </div>
              {run.events?.length ? (
                <ol className="run-event-list" aria-label={`${run.contactName} run events`}>
                  {run.events.map((event) => (
                    <li key={event.id} data-event-type={event.type}>
                      <span>{eventSummary(event.type, event.payload)}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
