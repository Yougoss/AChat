"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Group, Message, Run, Task } from "../server/domain/types.ts";
import { RunProcessView } from "./RunProcessView.tsx";

interface ContactLabel {
  id: string;
  name: string;
}

interface VisibleRun extends Run {
  contactName: string;
  title: string;
  events?: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
}

interface GroupConversationProps {
  group: Group;
  task: Task;
  messages: Message[];
  runs: VisibleRun[];
  contacts: ContactLabel[];
}

function senderLabel(message: Message, contacts: ContactLabel[]): string {
  if (message.role === "user") return "You";
  const senderId = message.metadata?.fromContactId ?? message.metadata?.contactId;
  if (typeof senderId !== "string") return message.role;
  return contacts.find((contact) => contact.id === senderId)?.name ?? "Task member";
}

export function GroupConversation({
  group,
  task,
  messages: initialMessages,
  runs: initialRuns,
  contacts,
}: GroupConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [runs, setRuns] = useState(initialRuns);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}/messages`);
    const result = await response.json() as { messages?: Message[]; runs?: VisibleRun[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Unable to refresh task activity");
    setMessages(result.messages ?? []);
    setRuns(result.runs ?? []);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const result = await response.json() as { message?: Message; error?: string };
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? "Unable to send group message");
      }
      setMessages((existing) => [...existing, result.message!]);
      setContent("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send group message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="group-workspace">
      <section className="conversation-panel group-conversation-panel" aria-labelledby="group-title">
        <header className="conversation-header">
          <div>
            <p className="eyebrow">Dispatch workbench · group task</p>
            <h1 id="group-title">{group.name}</h1>
            <p>{task.description || "No task description yet. Add one before the first work trigger."}</p>
          </div>
          <button className="button button-quiet" type="button" onClick={() => void refresh()}>
            Refresh activity
          </button>
        </header>
        <div className="group-member-strip" aria-label="Task members">
          {contacts.map((contact) => (
            <span className="group-member-chip" key={contact.id}>
              <span className="contact-avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</span>
              {contact.name}
            </span>
          ))}
        </div>
        <ol className="message-list group-message-list" aria-label={`${group.name} conversation`} aria-live="polite">
          {messages.map((message) => (
            <li className={`message message-${message.role}`} key={message.id}>
              <div className="group-message-heading">
                <span className="message-role">{senderLabel(message, contacts)}</span>
                {message.role === "handoff" ? (
                  <span className="handoff-route" aria-label="Structured handoff">
                    @{contacts.find((contact) => contact.id === String(message.metadata?.fromContactId))?.name ?? "member"}
                    {" → "}
                    @{contacts.find((contact) => contact.id === String(message.metadata?.toContactId))?.name ?? "member"}
                  </span>
                ) : null}
              </div>
              <p>{message.content}</p>
              <time className="evidence-meta" dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
          {!messages.length ? (
            <li className="conversation-empty">
              <p>Start the task conversation by explicitly mentioning a member.</p>
              <p className="evidence-meta">Only @contact and @all messages create work.</p>
            </li>
          ) : null}
        </ol>
        <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
          <label className="visually-hidden" htmlFor={`group-message-${group.id}`}>Message task members</label>
          <textarea
            id={`group-message-${group.id}`}
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            placeholder="Message the group. Use @contact or @all to dispatch work…"
            rows={3}
            required
          />
          <div className="composer-actions">
            <span className="evidence-meta">Mentioned members only · no inferred delegation</span>
            <button className="button button-primary" type="submit" disabled={busy || !content.trim()}>
              {busy ? "Sending…" : "Send to group"}
            </button>
          </div>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
      <RunProcessView runs={runs} />
    </main>
  );
}
