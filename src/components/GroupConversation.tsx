"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Approval, Group, Message, Run, Task } from "../server/domain/types.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { RunProcessView } from "./RunProcessView.tsx";
import { TaskStatusPanel } from "./TaskStatusPanel.tsx";

interface ContactLabel {
  id: string;
  name: string;
}

interface VisibleRun extends Run {
  contactName: string;
  title: string;
  stuck: "stuck" | "not_stuck" | "unknown";
  lifecycleEvidence: string;
  events?: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
}

interface GroupConversationProps {
  group: Group;
  task: Task;
  messages: Message[];
  runs: VisibleRun[];
  contacts: ContactLabel[];
  taskStatus: string;
  unreadCount: number;
  pendingAttentionCount: number;
  approvals: Approval[];
  eventCursor: number;
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
  taskStatus: initialTaskStatus = "unknown",
  unreadCount: initialUnreadCount = 0,
  pendingAttentionCount: initialPendingAttentionCount = 0,
  approvals: initialApprovals = [],
  eventCursor = 0,
}: GroupConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [runs, setRuns] = useState(initialRuns);
  const [taskStatus, setTaskStatus] = useState(initialTaskStatus);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [pendingAttentionCount, setPendingAttentionCount] = useState(initialPendingAttentionCount);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [liveStatus, setLiveStatus] = useState("Connecting to live activity");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}/messages`);
    const result = await response.json() as {
      messages?: Message[];
      runs?: VisibleRun[];
      taskStatus?: string;
      unreadCount?: number;
      pendingAttentionCount?: number;
      approvals?: Approval[];
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "Unable to refresh task activity");
    setMessages(result.messages ?? []);
    setRuns(result.runs ?? []);
    setTaskStatus(result.taskStatus ?? initialTaskStatus);
    setUnreadCount(result.unreadCount ?? 0);
    setPendingAttentionCount(result.pendingAttentionCount ?? 0);
    setApprovals(result.approvals ?? []);
  }, [group.id, initialTaskStatus]);

  useEffect(() => {
    const source = new EventSource(`/api/events?after=${eventCursor}`);
    source.onopen = () => setLiveStatus("Live activity connected");
    source.onerror = () => setLiveStatus("Live activity is reconnecting");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (event.payload?.taskId !== task.id) return;
        if (
          event.type === "run.started"
          || event.type === "run.completed"
          || event.type === "run.failed"
          || event.type === "run.interrupted"
          || event.type === "tool.started"
          || event.type === "tool.completed"
          || event.type === "tool.failed"
          || event.type === "tool.cancelled"
          || event.type === "approval.requested"
          || event.type === "approval.decided"
        ) {
          void refresh().catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Unable to refresh task activity");
          });
        }
      } catch {
        setError("Received an unreadable live activity event");
      }
    };
    return () => source.close();
  }, [eventCursor, refresh, task.id]);

  async function markRunsRead() {
    setError("");
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}/read`, {
        method: "POST",
      });
      const result = await response.json() as { error?: string; unreadCount?: number };
      if (!response.ok) throw new Error(result.error ?? "Unable to mark run activity read");
      setUnreadCount(result.unreadCount ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to mark run activity read");
    }
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
        <div className="group-live-status" role="status">{liveStatus}</div>
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
        <section className="approval-section" aria-labelledby="approval-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Action gate</p>
              <h2 id="approval-title">Approvals</h2>
            </div>
            {unreadCount > 0 ? (
              <button className="button button-quiet" type="button" onClick={() => void markRunsRead()}>
                Mark runs read
              </button>
            ) : null}
          </div>
          {!approvals.length ? (
            <p className="approval-empty">No actions are waiting for approval.</p>
          ) : (
            <div className="approval-list">
              {approvals.map((approval) => (
                <ApprovalCard
                  approval={approval}
                  key={approval.id}
                  onDecided={() => void refresh()}
                />
              ))}
            </div>
          )}
        </section>
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
      <div className="group-status-column">
        <TaskStatusPanel
          taskStatus={taskStatus}
          runs={runs}
          unreadCount={unreadCount}
          pendingAttentionCount={pendingAttentionCount}
        />
        <RunProcessView runs={runs} />
      </div>
    </main>
  );
}
