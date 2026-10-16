"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { Contact, Message, Project } from "../server/domain/types.ts";
import { ContactSessionResults } from "./ContactSessionResults.tsx";
import { ProjectSelector } from "./ProjectSelector.tsx";

interface ContactChatProps {
  contactId?: string;
  contact?: Pick<Contact, "id" | "name" | "description">;
  messages?: Message[];
}

interface Draft {
  name: string;
  description: string;
  contactIds: string[];
}

function readableError(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

export function ContactChat({
  contactId: providedContactId,
  contact: initialContact,
  messages: initialMessages,
}: ContactChatProps) {
  const [contact, setContact] = useState(initialContact);
  const [messages, setMessages] = useState(initialMessages ?? []);
  const [content, setContent] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const contactId = contact?.id ?? providedContactId;

  useEffect(() => {
    if (!contactId || (initialContact && initialMessages)) return;
    let active = true;
    void Promise.all([
      fetch(`/api/contacts/${encodeURIComponent(contactId)}`).then((response) => response.json()),
      fetch(`/api/contacts/${encodeURIComponent(contactId)}/messages`).then((response) => response.json()),
    ]).then(([contactResult, messageResult]) => {
      if (!active) return;
      if (contactResult.error) throw new Error(contactResult.error);
      setContact(contactResult.contact);
      setMessages(messageResult.messages ?? []);
    }).catch((cause: unknown) => {
      if (active) setError(readableError(cause, "Unable to load this contact conversation"));
    });
    return () => {
      active = false;
    };
  }, [contactId, initialContact, initialMessages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || !content.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const result = await response.json() as {
        exchange?: { userMessage: Message; assistantMessage: Message };
        error?: string;
      };
      if (!response.ok || !result.exchange) {
        throw new Error(result.error ?? "Unable to send message");
      }
      setMessages((existing) => [...existing, result.exchange!.userMessage, result.exchange!.assistantMessage]);
      setContent("");
    } catch (cause) {
      setError(readableError(cause, "Unable to send message"));
    } finally {
      setBusy(false);
    }
  }

  async function startDraft() {
    if (!contactId) return;
    const sourceMessage = [...messages].reverse().find((message) => message.role === "user")?.content;
    if (!sourceMessage) {
      setError("Send a message before drafting a task.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const [draftResponse, projectResponse] = await Promise.all([
        fetch(`/api/contacts/${encodeURIComponent(contactId)}/task-draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceMessage }),
        }),
        fetch("/api/projects"),
      ]);
      const [draftResult, projectResult] = await Promise.all([
        draftResponse.json(),
        projectResponse.json(),
      ]) as [
        { draft?: Draft; error?: string },
        { projects?: Project[]; error?: string },
      ];
      if (!draftResponse.ok || !draftResult.draft) {
        throw new Error(draftResult.error ?? "Unable to draft a task");
      }
      if (!projectResponse.ok) throw new Error(projectResult.error ?? "Unable to load registered projects");
      setDraft(draftResult.draft);
      setDraftName(draftResult.draft.name);
      setDraftDescription(draftResult.draft.description);
      setProjects(projectResult.projects ?? []);
    } catch (cause) {
      setError(readableError(cause, "Unable to draft a task"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || !draft || !projectId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftName,
          description: draftDescription,
          projectId,
          contactIds: draft.contactIds,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to create group and task");
      setDraft(null);
      setNotice("Group and task created. No work was dispatched.");
    } catch (cause) {
      setError(readableError(cause, "Unable to create group and task"));
    } finally {
      setBusy(false);
    }
  }

  if (!contact) {
    return (
      <section className="conversation-panel" aria-live="polite">
        <p>{error || "Loading contact conversation…"}</p>
      </section>
    );
  }

  return (
    <div className="conversation-flow">
      <section className="conversation-panel" aria-labelledby="conversation-title">
        <header className="conversation-header">
          <div>
            <p className="eyebrow">Private contact channel</p>
            <h1 id="conversation-title">{contact.name}</h1>
            <p>{contact.description || "No contact description provided."}</p>
          </div>
          <Link className="button button-quiet" href={`/settings/contacts/${encodeURIComponent(contact.id)}`}>
            Contact settings
          </Link>
        </header>
        <ol className="message-list" aria-label={`${contact.name} conversation`} aria-live="polite">
          {messages.map((message) => (
            <li className={`message message-${message.role}`} key={message.id}>
              <span className="message-role">{message.role === "assistant" ? contact.name : "You"}</span>
              <p>{message.content}</p>
              <time className="evidence-meta" dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
          {!messages.length ? (
            <li className="conversation-empty">
              <p>Start a private conversation with {contact.name}.</p>
              <p className="evidence-meta">Messages and replies stay in this contact’s conversation.</p>
            </li>
          ) : null}
        </ol>
        <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
          <label className="visually-hidden" htmlFor={`message-${contact.id}`}>Message {contact.name}</label>
          <textarea
            id={`message-${contact.id}`}
            aria-label={`Message ${contact.name}`}
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            placeholder={`Write to ${contact.name}…`}
            rows={3}
            required
          />
          <div className="composer-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void startDraft()}
              disabled={busy || !messages.some((message) => message.role === "user")}
            >
              Draft a task from this conversation
            </button>
            <button type="submit" className="button button-primary" disabled={busy || !content.trim()}>
              {busy ? "Sending…" : "Send message"}
            </button>
          </div>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="form-success" role="status">{notice}</p> : null}
      </section>

      {draft ? (
        <section className="task-draft-panel" aria-labelledby="draft-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Review before creating</p>
              <h2 id="draft-title">Task draft</h2>
            </div>
          </div>
          <p className="form-hint">This is only a draft. Confirming creates a group and task; it does not dispatch work.</p>
          <form className="stacked-form" onSubmit={(event) => void confirmDraft(event)}>
            <label className="field-label" htmlFor="draft-name">
              Group name
              <input id="draft-name" value={draftName} onChange={(event) => setDraftName(event.currentTarget.value)} required />
            </label>
            <label className="field-label" htmlFor="draft-description">
              Task description <span className="optional-label">(optional at creation)</span>
              <textarea
                id="draft-description"
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.currentTarget.value)}
                rows={4}
              />
            </label>
            <ProjectSelector projects={projects} value={projectId} onChange={setProjectId} id="draft-project" />
            {!projects.length ? (
              <p className="form-hint">Register a project root before confirming this task.</p>
            ) : null}
            <div className="composer-actions">
              <button type="button" className="button button-quiet" onClick={() => setDraft(null)}>Discard draft</button>
              <button type="submit" className="button button-primary" disabled={busy || !projectId || !projects.length}>
                {busy ? "Creating…" : "Confirm and create group/task"}
              </button>
            </div>
          </form>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
      ) : null}

      <ContactSessionResults contactId={contact.id} />
    </div>
  );
}
