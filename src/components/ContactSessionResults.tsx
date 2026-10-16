"use client";

import { useEffect, useState } from "react";
import type { TaskSessionSummary } from "../server/services/trace-query-service.ts";

interface ContactSessionResultsProps {
  contactId: string;
  items?: TaskSessionSummary[];
  nextCursor?: string | null;
}

export function ContactSessionResults({
  contactId,
  items: initialItems,
  nextCursor: initialCursor = null,
}: ContactSessionResultsProps) {
  const [items, setItems] = useState(initialItems ?? []);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadPage(nextCursor?: string | null) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/sessions?${params.toString()}`,
      );
      const result = await response.json() as {
        items?: TaskSessionSummary[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Unable to load session results");
      const nextItems = result.items ?? [];
      setItems((existing) => nextCursor ? [...existing, ...nextItems] : nextItems);
      setCursor(result.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load session results");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialItems) return;
    let active = true;
    const params = new URLSearchParams();
    void fetch(`/api/contacts/${encodeURIComponent(contactId)}/sessions?${params.toString()}`)
      .then(async (response) => {
        const result = await response.json() as {
          items?: TaskSessionSummary[];
          nextCursor?: string | null;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Unable to load session results");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setItems(result.items ?? []);
        setCursor(result.nextCursor ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load session results");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [contactId, initialItems]);

  return (
    <section className="evidence-panel" aria-labelledby={`evidence-title-${contactId}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Read-only · contact scoped</p>
          <h2 id={`evidence-title-${contactId}`}>Evidence from your sessions</h2>
        </div>
        <span className="evidence-count">{items.length} result{items.length === 1 ? "" : "s"}</span>
      </div>
      {items.length ? (
        <ol className="evidence-list">
          {items.map((item) => (
            <li key={item.taskId}>
              <article className="evidence-card">
                <div className="evidence-card-heading">
                  <span className="evidence-source">Task evidence</span>
                  <time className="evidence-meta" dateTime={item.lastActivity}>
                    {item.lastActivity.replace("T", " ").replace("Z", " UTC")}
                  </time>
                </div>
                <h3>{item.title || "Untitled task"}</h3>
                <p className="evidence-meta">Source: task {item.taskId}</p>
                <p className="evidence-summary">Status: {item.status}</p>
                {item.sessionRefs.length ? (
                  <details>
                    <summary>Pi session references ({item.sessionRefs.length})</summary>
                    <ul className="session-reference-list">
                      {item.sessionRefs.map((sessionRef) => (
                        <li className="evidence-meta" key={sessionRef}>{sessionRef}</li>
                      ))}
                    </ul>
                  </details>
                ) : <p className="evidence-meta">No session has been recorded for this task yet.</p>}
              </article>
            </li>
          ))}
        </ol>
      ) : <p className="empty-evidence">No task session evidence is available for this contact yet.</p>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {cursor ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={loading}
          onClick={() => void loadPage(cursor)}
        >
          {loading ? "Loading…" : "Load more results"}
        </button>
      ) : null}
    </section>
  );
}
