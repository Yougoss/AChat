"use client";

import type { ReactNode } from "react";
import type { Message } from "../server/domain/types.ts";
import type { ProcessSummary } from "../server/services/process-details-service.ts";
import { ProcessDetailsCard } from "./ProcessDetailsCard.tsx";

export interface TimelineHandoff {
  id: string;
  content: string;
}

export interface TimelineMessage extends Pick<Message, "id" | "role" | "content" | "createdAt"> {
  senderLabel?: string;
  processSummaryId?: string;
  handoffs?: TimelineHandoff[];
}

interface ConversationTimelineProps {
  messages: TimelineMessage[];
  senderLabels: { user: string; assistant: string };
  processSummaries?: Record<string, ProcessSummary>;
  processDetailsUrl?: (summaryId: string) => string;
  ariaLabel?: string;
  emptyState?: ReactNode;
}

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function avatarText(label: string): string {
  return Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "•";
}

export function ConversationTimeline({
  messages,
  senderLabels,
  processSummaries = {},
  processDetailsUrl,
  ariaLabel = "Conversation",
  emptyState,
}: ConversationTimelineProps) {
  return (
    <ol className="message-list" aria-label={ariaLabel} aria-live="polite">
      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const senderLabel = isUser
          ? senderLabels.user
          : message.senderLabel ?? (message.role === "handoff" ? "Handoff" : senderLabels.assistant);
        const processSummaryId = message.processSummaryId ?? message.id;
        const processSummary = processSummaries[processSummaryId];
        const currentDate = new Date(message.createdAt);
        const previousDate = index > 0 ? new Date(messages[index - 1].createdAt) : undefined;
        const hasValidDate = Number.isFinite(currentDate.getTime());
        const hasValidPreviousDate = previousDate && Number.isFinite(previousDate.getTime());
        const crossesDate = Boolean(
          hasValidDate
          && hasValidPreviousDate
          && dateKey(currentDate) !== dateKey(previousDate),
        );
        const gapMs = hasValidDate && hasValidPreviousDate
          ? currentDate.getTime() - previousDate.getTime()
          : Number.POSITIVE_INFINITY;
        const showTimeSeparator = index === 0 || crossesDate || gapMs >= 5 * 60 * 1000;

        return (
          <li className={`message-row message-row-${isUser ? "user" : "assistant"}`} key={message.id}>
            {showTimeSeparator ? (
              <time
                className="timeline-separator"
                data-timeline-separator={crossesDate ? "date" : "time"}
                dateTime={hasValidDate ? currentDate.toISOString() : undefined}
              >
                {crossesDate ? formatDateTime(currentDate) : formatTime(currentDate)}
              </time>
            ) : null}
            <article
              className={`message message-${message.role}`}
              id={`message-${message.id}`}
              aria-label={`${senderLabel} message`}
            >
              <span className="message-avatar" aria-label={`${senderLabel} avatar`}>
                {isUser ? "我" : avatarText(senderLabel)}
              </span>
              <div className="message-content">
                <span className="message-role">{senderLabel}</span>
                <p>{message.content}</p>
                {!isUser && processSummary && processDetailsUrl ? (
                  <ProcessDetailsCard
                    summary={processSummary}
                    detailUrl={processDetailsUrl(processSummaryId)}
                    replyText={message.content}
                    handoffs={message.handoffs}
                  />
                ) : null}
                {!isUser && message.handoffs?.length && !(processSummary && processDetailsUrl) ? (
                  <div className="message-handoff-context" aria-label="Structured handoffs">
                    {message.handoffs.map((handoff) => (
                      <div className="process-handoff" key={handoff.id}>
                        <span className="fragment-anchor" id={`message-${handoff.id}`} aria-hidden="true" />
                        <p>{handoff.content}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          </li>
        );
      })}
      {!messages.length && emptyState ? (
        <li className="conversation-empty">{emptyState}</li>
      ) : null}
    </ol>
  );
}
