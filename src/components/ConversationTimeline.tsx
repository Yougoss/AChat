"use client";

import type { ReactNode } from "react";
import type { Message } from "../server/domain/types.ts";
import type { ProcessSummary } from "../server/services/process-details-service.ts";
import { ProcessDetailsCard } from "./ProcessDetailsCard.tsx";

interface ConversationTimelineProps {
  messages: Pick<Message, "id" | "role" | "content" | "createdAt">[];
  senderLabels: { user: string; assistant: string };
  processSummaries?: Record<string, ProcessSummary>;
  processDetailsUrl?: (messageId: string) => string;
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
        const senderLabel = isUser ? senderLabels.user : senderLabels.assistant;
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
              className={`message message-${isUser ? "user" : "assistant"}`}
              id={`message-${message.id}`}
              aria-label={`${senderLabel} message`}
            >
              <span className="message-avatar" aria-label={`${senderLabel} avatar`}>
                {isUser ? "我" : avatarText(senderLabel)}
              </span>
              <div className="message-content">
                <span className="message-role">{senderLabel}</span>
                <p>{message.content}</p>
                {!isUser && processSummaries[message.id] && processDetailsUrl ? (
                  <ProcessDetailsCard
                    summary={processSummaries[message.id]}
                    detailUrl={processDetailsUrl(message.id)}
                    replyText={message.content}
                  />
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
