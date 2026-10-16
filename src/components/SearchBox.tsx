"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { SearchResult } from "../server/services/search-service.ts";

interface SearchBoxProps {
  contactId?: string;
}

export function SearchBox({ contactId }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<{
    scope: string | null;
    results: SearchResult[];
    busy: boolean;
    error: string;
    searched: boolean;
  }>({
    scope: contactId ?? null,
    results: [],
    busy: false,
    error: "",
    searched: false,
  });
  const requestId = useRef(0);
  const scope = contactId ?? null;
  const visibleState = searchState.scope === scope
    ? searchState
    : { scope, results: [], busy: false, error: "", searched: false };

  useEffect(() => {
    requestId.current += 1;
  }, [contactId]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchState({
        scope,
        results: [],
        busy: false,
        error: "",
        searched: false,
      });
      return;
    }

    const currentRequestId = ++requestId.current;
    const params = new URLSearchParams({ q: trimmedQuery });
    if (contactId) params.set("contactId", contactId);
    setSearchState({
      scope,
      results: [],
      busy: true,
      error: "",
      searched: true,
    });
    try {
      const response = await fetch(`/api/search?${params.toString()}`);
      const result = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to search messages");
      if (requestId.current === currentRequestId) {
        setSearchState({
          scope,
          results: result.results ?? [],
          busy: false,
          error: "",
          searched: true,
        });
      }
    } catch (cause) {
      if (requestId.current === currentRequestId) {
        setSearchState({
          scope,
          results: [],
          busy: false,
          error: cause instanceof Error ? cause.message : "Unable to search messages",
          searched: true,
        });
      }
    }
  }

  return (
    <section className="workspace-search" aria-label="Workspace search">
      <form role="search" onSubmit={(event) => void search(event)}>
        <label className="field-label" htmlFor="workspace-search-input">Search messages and tasks</label>
        <div className="workspace-search-controls">
          <input
            id="workspace-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search visible conversations…"
          />
          <button className="button button-quiet" type="submit" disabled={visibleState.busy || !query.trim()}>
            {visibleState.busy ? "Searching…" : "Search"}
          </button>
        </div>
      </form>
      {visibleState.error ? <p className="form-error" role="alert">{visibleState.error}</p> : null}
      {visibleState.searched && !visibleState.busy && !visibleState.error && !visibleState.results.length ? (
        <p className="search-empty" role="status">No matching messages or conversations.</p>
      ) : null}
      {visibleState.results.length ? (
        <ol className="search-result-list" aria-label="Search results">
          {visibleState.results.map((result) => (
            <li key={`${result.ownerType}:${result.ownerId}`}>
              <Link className="search-result-link" href={result.href}>
                <span className="search-result-kind">
                  {result.ownerType === "contact" ? "Private conversation" : "Task conversation"}
                </span>
                <strong>{result.title}</strong>
                <span className="search-result-preview">{result.preview || "No messages yet"}</span>
                <span className="search-result-count">
                  {result.matchingMessageCount} matching message{result.matchingMessageCount === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
