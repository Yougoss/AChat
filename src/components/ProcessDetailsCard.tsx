"use client";

import { useRef, useState } from "react";
import type { ProcessDetails, ProcessEvent, ProcessSummary } from "../server/services/process-details-service.ts";

interface ProcessDetailsCardProps {
  summary: ProcessSummary;
  detailUrl: string;
  replyText: string;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Unable to load process details";
}

function formatCost(value: number): string {
  return `$${value}`;
}

function orderedEvents(events: ProcessEvent[]): ProcessEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const timeDifference = Date.parse(left.event.createdAt) - Date.parse(right.event.createdAt);
      return Number.isFinite(timeDifference) && timeDifference !== 0
        ? timeDifference
        : left.index - right.index;
    })
    .map(({ event }) => event);
}

function ProcessEventRow({ event }: { event: ProcessEvent }) {
  const isLongToolOutput = event.kind === "tool_result" && event.detail.length > 600;
  return (
    <li className={`process-event process-event-${event.kind}`}>
      <div className="process-event-heading">
        <strong>{event.label}</strong>
        <time dateTime={event.createdAt}>
          {new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date(event.createdAt))}
        </time>
      </div>
      {event.model ? <span className="process-event-model">{event.model}</span> : null}
      {event.durationMs !== undefined ? (
        <span className="process-event-duration">{event.durationMs} ms</span>
      ) : null}
      {event.detail ? isLongToolOutput ? (
        <details className="process-event-output">
          <summary>Show full output</summary>
          <pre>{event.detail}</pre>
        </details>
      ) : (
        <pre className="process-event-detail">{event.detail}</pre>
      ) : null}
    </li>
  );
}

export function ProcessDetailsCard({ summary, detailUrl, replyText }: ProcessDetailsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<ProcessDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasRequested = useRef(false);

  async function loadDetails() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(detailUrl);
      const result = await response.json() as ProcessDetails & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to load process details");
      setDetails(result);
      hasRequested.current = true;
    } catch (cause) {
      setError(errorMessage(cause));
      hasRequested.current = false;
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !details && !loading && !hasRequested.current) {
      hasRequested.current = true;
      void loadDetails();
    }
  }

  const usageMetrics = summary.usage
    ? ([
        ["Input", summary.usage.input],
        ["Output", summary.usage.output],
        ["Cache read", summary.usage.cacheRead],
        ["Cache write", summary.usage.cacheWrite],
        ["Cost", summary.usage.cost === undefined ? undefined : formatCost(summary.usage.cost)],
      ] as const).filter(([, value]) => value !== undefined)
    : [];

  return (
    <section className="process-details-card" aria-label="Process details">
      <div className="process-details-summary">
        <div className="process-summary-copy">
          <strong>Process details</strong>
          <span>{summary.messageCount} {summary.messageCount === 1 ? "message" : "messages"}</span>
          {summary.models.length ? <span>{summary.models.join(", ")}</span> : null}
        </div>
        {usageMetrics.length ? (
          <ul className="process-usage" aria-label="Usage">
            {usageMetrics.map(([label, value]) => (
              <li key={label}><span>{label}</span> <strong>{value}</strong></li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="process-details-toggle"
          aria-expanded={expanded}
          aria-controls={`process-details-${detailUrl}`}
          onClick={toggle}
        >
          {expanded ? "Hide process details" : "Show process details"}
        </button>
      </div>
      {expanded ? (
        <div className="process-details-body" id={`process-details-${detailUrl}`}>
          <p className="process-reply">{replyText}</p>
          {loading ? <p role="status">Loading process details…</p> : null}
          {error ? (
            <div role="alert" className="process-details-error">
              <p>{error}</p>
              <button type="button" className="button button-quiet" onClick={() => void loadDetails()}>
                Retry
              </button>
            </div>
          ) : null}
          {details ? (
            details.events.length ? (
              <ol className="process-event-list" aria-label="Process events">
                {orderedEvents(details.events).map((event) => (
                  <ProcessEventRow event={event} key={event.id} />
                ))}
              </ol>
            ) : (
              <p className="process-details-empty">No process events are available.</p>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
