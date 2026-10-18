"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Approval, Group, Message, Run, Task } from "../server/domain/types.ts";
import type { ProcessSummary } from "../server/services/process-details-service.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ConversationTimeline, type TimelineHandoff, type TimelineMessage } from "./ConversationTimeline.tsx";
import { TaskStatusPanel } from "./TaskStatusPanel.tsx";

interface ContactLabel {
  id: string;
  name: string;
}

interface VisibleRun extends Run {
  workItemStatus: string;
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
  processSummaries: Record<string, ProcessSummary>;
}

function senderLabel(message: Message, contacts: ContactLabel[]): string {
  if (message.role === "user") return "You";
  const senderId = message.metadata?.fromContactId ?? message.metadata?.contactId;
  if (typeof senderId !== "string") return message.role;
  return contacts.find((contact) => contact.id === senderId)?.name ?? "Task member";
}

function conversationTimeline(
  messages: Message[],
  contacts: ContactLabel[],
): TimelineMessage[] {
  const lastAssistantByRun = new Map<string, string>();
  const handoffsByRun = new Map<string, TimelineHandoff[]>();
  const pairedHandoffs = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant" && typeof message.metadata?.runId === "string") {
      lastAssistantByRun.set(message.metadata.runId, message.id);
    }
  }
  for (const message of messages) {
    if (message.role !== "handoff" || typeof message.metadata?.sourceRunId !== "string") continue;
    const sourceRunId = message.metadata.sourceRunId;
    if (!lastAssistantByRun.has(sourceRunId)) continue;
    const handoffs = handoffsByRun.get(sourceRunId) ?? [];
    handoffs.push({ id: message.id, content: message.content });
    handoffsByRun.set(sourceRunId, handoffs);
    pairedHandoffs.add(message.id);
  }

  return messages.flatMap((message): TimelineMessage[] => {
    if (message.role === "handoff") {
      if (pairedHandoffs.has(message.id)) return [];
      const fromId = message.metadata?.fromContactId;
      const toId = message.metadata?.toContactId;
      const from = typeof fromId === "string"
        ? contacts.find((contact) => contact.id === fromId)?.name
        : undefined;
      const to = typeof toId === "string"
        ? contacts.find((contact) => contact.id === toId)?.name
        : undefined;
      return [{
        id: message.id,
        role: "handoff",
        content: message.content,
        createdAt: message.createdAt,
        senderLabel: `${from ?? "member"} → ${to ?? "member"}`,
      }];
    }

    if (message.role !== "assistant") {
      return [{ ...message, role: message.role === "user" ? "user" : "assistant" }];
    }

    const runId = typeof message.metadata?.runId === "string"
      ? message.metadata.runId
      : undefined;
    const isLastAssistant = runId && lastAssistantByRun.get(runId) === message.id;
    return [{
      ...message,
      role: "assistant",
      senderLabel: senderLabel(message, contacts),
      processSummaryId: isLastAssistant ? runId : undefined,
      handoffs: isLastAssistant ? handoffsByRun.get(runId) : undefined,
    }];
  });
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
  processSummaries: initialProcessSummaries = {},
}: GroupConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [runs, setRuns] = useState(initialRuns);
  const [taskStatus, setTaskStatus] = useState(initialTaskStatus);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [pendingAttentionCount, setPendingAttentionCount] = useState(initialPendingAttentionCount);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [processSummaries, setProcessSummaries] = useState(initialProcessSummaries);
  const [content, setContent] = useState("");
  const [taskDescription, setTaskDescription] = useState(task.description);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [liveStatus, setLiveStatus] = useState("Connecting to live activity");
  const [taskInformationOpen, setTaskInformationOpen] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}/messages`);
    const result = await response.json() as {
      messages?: Message[];
      runs?: VisibleRun[];
      taskStatus?: string;
      unreadCount?: number;
      pendingAttentionCount?: number;
      approvals?: Approval[];
      processSummaries?: Record<string, ProcessSummary>;
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "Unable to refresh task activity");
    setMessages(result.messages ?? []);
    setRuns(result.runs ?? []);
    setTaskStatus(result.taskStatus ?? initialTaskStatus);
    setUnreadCount(result.unreadCount ?? 0);
    setPendingAttentionCount(result.pendingAttentionCount ?? 0);
    setApprovals(result.approvals ?? []);
    setProcessSummaries(result.processSummaries ?? {});
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

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return;
    let targetId = fragment;
    try {
      targetId = decodeURIComponent(fragment);
    } catch {
      targetId = fragment;
    }
    document.getElementById(targetId)?.scrollIntoView({ block: "center" });
  }, [messages]);

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

  async function saveTaskDescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!descriptionDraft.trim()) return;
    setSavingDescription(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: descriptionDraft }),
      });
      const result = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !result.task) {
        throw new Error(result.error ?? "Unable to save task description");
      }
      setTaskDescription(result.task.description);
      setDescriptionDraft(result.task.description);
      setEditingDescription(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save task description");
    } finally {
      setSavingDescription(false);
    }
  }

  return (
      <section className="conversation-panel group-conversation-panel" aria-labelledby="group-title">
        <header className="conversation-header">
          <div className="conversation-header-copy">
            <h1 id="group-title">{group.name}</h1>
            <p className="conversation-subtitle">
              Task group · {contacts.map((contact) => contact.name).join(", ") || "No participants"}
            </p>
          </div>
          <button
            className="button button-quiet"
            type="button"
            aria-expanded={taskInformationOpen}
            onClick={() => setTaskInformationOpen((open) => !open)}
          >
            Task information
          </button>
        </header>
        <div className="group-live-status visually-hidden" role="status">{liveStatus}</div>
        <div className="conversation-thread">
          {approvals.length ? (
            <section className="task-approval-thread" aria-label="Pending approvals">
              {approvals.map((approval) => (
                <ApprovalCard approval={approval} key={approval.id} onDecided={() => void refresh()} />
              ))}
            </section>
          ) : null}
          <ConversationTimeline
            messages={conversationTimeline(messages, contacts)}
            senderLabels={{ user: "You", assistant: "Task member" }}
            processSummaries={processSummaries}
            processDetailsUrl={(runId) =>
              `/api/groups/${encodeURIComponent(group.id)}/runs/${encodeURIComponent(runId)}/process`}
            ariaLabel={`${group.name} conversation`}
            emptyState={
              <>
                <p>Start the task conversation by explicitly mentioning a member.</p>
                <p className="evidence-meta">Only @contact and @all messages create work.</p>
              </>
            }
          />
        </div>
        <TaskStatusPanel
          open={taskInformationOpen}
          taskId={task.id}
          taskGoal={taskDescription}
          participants={contacts.map((contact) => contact.name)}
          taskGoalActions={editingDescription ? (
            <form className="task-description-editor" onSubmit={(event) => void saveTaskDescription(event)}>
              <label htmlFor={`task-description-${task.id}`}>Task description</label>
              <textarea
                id={`task-description-${task.id}`}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
                rows={3}
                required
              />
              <div className="task-description-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={savingDescription || !descriptionDraft.trim()}
                >
                  {savingDescription ? "Saving…" : "Save changes"}
                </button>
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => {
                    setDescriptionDraft(taskDescription);
                    setEditingDescription(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                setDescriptionDraft(taskDescription);
                setEditingDescription(true);
              }}
            >
              {taskDescription ? "Edit task description" : "Add task description"}
            </button>
          )}
          taskStatus={taskStatus}
          runs={runs}
          unreadCount={unreadCount}
          pendingAttentionCount={pendingAttentionCount}
          onClose={() => setTaskInformationOpen(false)}
          onMarkRunsRead={() => void markRunsRead()}
          onRefresh={refresh}
        />
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
  );
}
