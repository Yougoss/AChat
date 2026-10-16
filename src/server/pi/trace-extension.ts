import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiSessionMapping } from "../domain/types.ts";

export type TraceScope = Pick<
  PiSessionMapping,
  "id" | "contactId" | "taskId" | "kind" | "piSessionId"
>;

const sensitiveKey = /authorization|(^|[_-])auth($|[_-])|cookie|api[-_]?key|token|password|secret|credential|headers/i;

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.map((item) => sanitize(item, seen));
    seen.delete(value);
    return sanitized;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue;
    sanitized[key] = sanitize(item, seen);
  }
  seen.delete(value);
  return sanitized;
}

function serialize(value: unknown): string {
  const json = JSON.stringify(sanitize(value));
  return json === undefined ? "null" : json;
}

export function createTraceExtension(db: Database.Database) {
  const activeCalls = new Map<string, string>();
  const insert = db.prepare(`
    INSERT INTO trace_records (id, mapping_id, call_id, type, payload_json)
    SELECT ?, pi_session_mappings.id, ?, ?, ?
    FROM pi_session_mappings
    WHERE pi_session_mappings.id = ?
      AND pi_session_mappings.pi_session_id = ?
      AND pi_session_mappings.contact_id = ?
  `);

  function append(
    scope: TraceScope,
    callId: string | null,
    type: "provider_request" | "provider_event" | "final_message" | "pi_event" | "achat_event",
    payload: unknown,
  ): void {
    const result = insert.run(
      randomUUID(),
      callId,
      type,
      serialize(payload),
      scope.id,
      scope.piSessionId,
      scope.contactId,
    );
    if (result.changes !== 1) {
      throw new Error("Trace scope does not match a persisted Pi session mapping");
    }
  }

  const trace = {
    async recordProviderRequest(scope: TraceScope, callId: string, payload: unknown): Promise<void> {
      activeCalls.set(scope.id, callId);
      append(scope, callId, "provider_request", payload);
    },
    async recordProviderEvent(scope: TraceScope, callId: string, event: unknown): Promise<void> {
      append(scope, callId, "provider_event", event);
    },
    async recordSessionEvent(scope: TraceScope, event: unknown): Promise<void> {
      const eventType = typeof event === "object" && event !== null && "type" in event
        ? String((event as { type: unknown }).type)
        : "unknown";
      const isAssistantMessage = typeof event === "object"
        && event !== null
        && "message" in event
        && typeof (event as { message?: unknown }).message === "object"
        && (event as { message: { role?: unknown } }).message?.role === "assistant";
      const callId = activeCalls.get(scope.id) ?? null;
      if (eventType === "message_end" && isAssistantMessage) {
        append(scope, callId, "final_message", event);
      } else if (
        eventType === "message_start"
        || eventType === "tool_execution_start"
        || eventType === "tool_execution_end"
        || eventType === "agent_settled"
      ) {
        append(scope, callId, "pi_event", event);
      }
    },
    async recordAchatEvent(
      scope: TraceScope,
      type: string,
      payload: unknown,
      callId = activeCalls.get(scope.id) ?? null,
    ): Promise<void> {
      append(scope, callId, "achat_event", { type, payload });
    },
    instrumentModelRuntime(runtime: ModelRuntime, scope: TraceScope): ModelRuntime {
      return new Proxy(runtime, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === "stream" || property === "streamSimple") {
            return (model: unknown, context: unknown, options: Record<string, unknown> = {}) => {
              const callId = randomUUID();
              const onPayload = options.onPayload as
                | ((payload: unknown, model: unknown) => unknown | Promise<unknown>)
                | undefined;
              const onResponse = options.onResponse as
                | ((response: unknown, model: unknown) => unknown)
                | undefined;
              const onProviderStreamEvent = options.onProviderStreamEvent as
                | ((event: unknown, model: unknown) => unknown)
                | undefined;
              return Reflect.apply(value, target, [
                model,
                context,
                {
                  ...options,
                  onPayload: async (payload: unknown, requestModel: unknown) => {
                    const transformed = await onPayload?.(payload, requestModel);
                    await trace.recordProviderRequest(
                      scope,
                      callId,
                      transformed === undefined ? payload : transformed,
                    );
                    return transformed;
                  },
                  onResponse: async (response: unknown, responseModel: unknown) => {
                    const record = typeof response === "object" && response !== null
                      ? { status: (response as { status?: unknown }).status }
                      : { status: undefined };
                    await trace.recordProviderEvent(scope, callId, { type: "http_response", ...record });
                    await onResponse?.(response, responseModel);
                  },
                  onProviderStreamEvent: async (event: unknown, eventModel: unknown) => {
                    await trace.recordProviderEvent(scope, callId, event);
                    await onProviderStreamEvent?.(event, eventModel);
                  },
                },
              ]);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as ModelRuntime;
    },
    subscribeToSession(scope: TraceScope, session: {
      subscribe(listener: (event: unknown) => void): () => void;
    }): () => void {
      return session.subscribe((event) => {
        void trace.recordSessionEvent(scope, event);
      });
    },
  };

  return trace;
}
