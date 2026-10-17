import type { Run } from "../server/domain/types.ts";

interface RunProcessViewProps {
  runs: Array<Run & {
    contactName: string;
    title: string;
  }>;
}

export function RunProcessView({ runs }: RunProcessViewProps) {
  return (
    <section className="run-process-panel" aria-labelledby="run-process-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Execution history</p>
          <h2 id="run-process-title">Run history</h2>
        </div>
        <span className="evidence-meta">{runs.length} {runs.length === 1 ? "attempt" : "attempts"}</span>
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
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
