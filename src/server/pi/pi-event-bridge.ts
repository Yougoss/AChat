import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Run } from "../domain/types.ts";
import { createEventRepository } from "../db/repositories/event-repository.ts";
import { createTraceExtension, type TraceScope } from "./trace-extension.ts";

interface BridgeOptions {
  db: Database.Database;
  run: Run;
  scope: TraceScope;
  idFactory?: () => string;
  now?: () => string;
  onFinalMessage?: (text: string, eventId: string) => void | Promise<void>;
}

interface PiSessionEvents {
  subscribe(listener: (event: unknown) => void): () => void;
}

function messageText(message: unknown): string {
  if (typeof message !== "object" || message === null || !("content" in message)) return "";
  const content = (message as { content: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } =>
      typeof part === "object" && part !== null
      && "type" in part && part.type === "text"
      && "text" in part && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function createPiEventBridge(options: BridgeOptions) {
  const events = createEventRepository(options.db);
  const trace = createTraceExtension(options.db);
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  let sequence = 1;
  let pending = Promise.resolve();
  let aborted = false;

  async function record(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<ReturnType<ReturnType<typeof createEventRepository>["appendEvent"]>> {
    const eventSequence = sequence++;
    const createdAt = now();
    const eventId = idFactory();
    const event = events.appendEvent({
      id: eventId,
      entityType: "run",
      entityId: options.run.id,
      type,
      payload: {
        ...payload,
        runId: options.run.id,
        workItemId: options.run.workItemId,
        taskId: options.run.taskId,
        contactId: options.run.contactId,
        piSessionId: options.scope.piSessionId,
        eventSequence,
      },
      idempotencyKey: `${options.run.id}:${eventSequence}:${type}`,
      createdAt,
    });
    await trace.recordAchatEvent(
      options.scope,
      event.type,
      { eventId: event.id, ...(event.payload as Record<string, unknown>) },
    );
    return event;
  }

  function handle(event: unknown): void {
    if (typeof event !== "object" || event === null || !("type" in event)) return;
    const value = event as Record<string, unknown>;
    const type = String(value.type);
    if (type === "message_update") {
      const update = value.assistantMessageEvent;
      if (
        typeof update === "object" && update !== null
        && "type" in update && update.type === "text_delta"
        && "delta" in update && typeof update.delta === "string"
      ) {
        pending = pending.then(async () => {
          await record("text.delta", { text: update.delta });
        });
      }
      return;
    }
    if (type === "tool_execution_start") {
      pending = pending.then(async () => {
        await record("tool.started", {
          toolName: value.toolName,
          toolCallId: value.toolCallId,
          args: value.args,
        });
      });
      return;
    }
    if (type === "tool_execution_end") {
      pending = pending.then(async () => {
        await record("tool.completed", {
          toolName: value.toolName,
          toolCallId: value.toolCallId,
          result: value.result,
          isError: value.isError === true,
        });
      });
      return;
    }
    if (type === "tool_execution_cancel") {
      pending = pending.then(async () => {
        await record("tool.cancelled", {
          toolName: value.toolName,
          toolCallId: value.toolCallId,
        });
      });
      return;
    }
    if (type === "message_end") {
      const message = value.message;
      if (
        typeof message === "object" && message !== null
        && "role" in message && message.role === "assistant"
      ) {
        pending = pending.then(async () => {
          const text = messageText(message);
          const stored = await record("final_message", { text });
          await options.onFinalMessage?.(text, stored.id);
        });
      }
      return;
    }
    if (type === "agent_error" || type === "error") {
      const error = value.error;
      pending = pending.then(async () => {
        await record("run.error", {
          message: error instanceof Error ? error.message : String(error ?? "Pi agent error"),
        });
      });
      return;
    }
    if (type === "agent_end" && value.aborted === true) {
      aborted = true;
      pending = pending.then(async () => {
        await record("run.aborted", { reason: "Pi agent aborted" });
      });
    }
  }

  return {
    record,
    subscribe(session: PiSessionEvents): () => void {
      return session.subscribe(handle);
    },
    async flush(): Promise<void> {
      await pending;
    },
    isAborted(): boolean {
      return aborted;
    },
  };
}
