import path from "node:path";
import type Database from "better-sqlite3";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";
import { sanitizeTraceValue } from "../pi/trace-extension.ts";

const usageFields = ["input", "output", "cacheRead", "cacheWrite"] as const;

type UsageField = (typeof usageFields)[number] | "cost";

export interface ProcessUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

export interface ProcessSummary {
  messageCount: number;
  models: string[];
  usage?: ProcessUsage;
}

export interface ProcessEvent {
  id: string;
  createdAt: string;
  kind: string;
  label: string;
  detail: string;
  model?: string;
  durationMs?: number;
}

export interface ProcessDetails {
  summary: ProcessSummary;
  events: ProcessEvent[];
}

interface TraceRow {
  sequence: number;
  id: string;
  callId: string | null;
  type: string;
  payloadJson: string;
  createdAt: string;
}

interface RunRow {
  id: string;
  taskId: string;
  groupId: string;
  contactId: string;
  workItemId: string;
  workItemTitle: string;
  taskDescription: string;
  startedAt: string;
  sourceMessageId: string | null;
}

interface RunEventRow {
  id: string;
  type: string;
  payloadJson: string;
  createdAt: string;
}

interface AssistantMessageRow {
  id: string;
  content: string;
  metadataJson: string;
  createdAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function removeInternalContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        const record = asRecord(item);
        return !record || !(
          typeof record.type === "string"
          && /^(reasoning|thinking)$/i.test(record.type)
        );
      })
      .map(removeInternalContent);
  }
  const record = asRecord(value);
  if (!record) return value;
  const visible: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (/reasoning|thinking/i.test(key)) continue;
    visible[key] = removeInternalContent(item);
  }
  return visible;
}

function safeValue(value: unknown): unknown {
  return removeInternalContent(sanitizeTraceValue(value));
}

function safeDetail(value: unknown): string {
  const safe = safeValue(value);
  return typeof safe === "string" ? safe : JSON.stringify(safe) ?? "";
}

function visibleText(value: unknown): string {
  if (typeof value === "string") return safeDetail(value);
  if (!Array.isArray(value)) return "";
  return value
    .filter((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string";
    })
    .map((part) => safeDetail(asRecord(part)?.text))
    .filter(Boolean)
    .join("");
}

function processTraceRange(metadataJson: string): { afterSequence: number; throughSequence: number } | undefined {
  const metadata = asRecord(parseJson(metadataJson));
  const range = asRecord(metadata?.processTraceRange);
  const afterSequence = range?.afterSequence;
  const throughSequence = range?.throughSequence;
  if (
    !Number.isSafeInteger(afterSequence)
    || !Number.isSafeInteger(throughSequence)
    || Number(afterSequence) < 0
    || Number(throughSequence) < Number(afterSequence)
  ) {
    return undefined;
  }
  return { afterSequence: Number(afterSequence), throughSequence: Number(throughSequence) };
}

function assistantTraceMessage(payload: unknown): Record<string, unknown> | undefined {
  const event = asRecord(payload);
  const message = asRecord(event?.message);
  return message?.role === "assistant" ? message : undefined;
}

function modelName(message: Record<string, unknown>): string | undefined {
  return typeof message.model === "string" && message.model.trim()
    ? safeDetail(message.model)
    : undefined;
}

function addUsageValue(
  totals: Partial<Record<UsageField, number>>,
  field: UsageField,
  value: unknown,
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  totals[field] = (totals[field] ?? 0) + value;
}

function summaryFromMessages(
  messageCount: number,
  assistantMessages: Record<string, unknown>[],
): ProcessSummary {
  const models = new Set<string>();
  const usage: Partial<Record<UsageField, number>> = {};
  for (const message of assistantMessages) {
    const model = modelName(message);
    if (model) models.add(model);
    const messageUsage = asRecord(message.usage);
    if (!messageUsage) continue;
    for (const field of usageFields) addUsageValue(usage, field, messageUsage[field]);
    const cost = messageUsage.cost;
    addUsageValue(usage, "cost", asRecord(cost)?.total ?? cost);
  }
  return {
    messageCount,
    models: [...models],
    ...(Object.keys(usage).length ? { usage: usage as ProcessUsage } : {}),
  };
}

function privateEvent(row: TraceRow): ProcessEvent | undefined {
  const payload = parseJson(row.payloadJson);
  if (row.type === "final_message") {
    const message = assistantTraceMessage(payload);
    if (!message) return undefined;
    const detail = visibleText(message.content);
    if (!detail) return undefined;
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "assistant_message",
      label: "Assistant reply",
      detail,
      ...(modelName(message) ? { model: modelName(message) } : {}),
      ...(typeof message.durationMs === "number" && Number.isFinite(message.durationMs)
        ? { durationMs: message.durationMs }
        : {}),
    };
  }
  if (row.type !== "pi_event") return undefined;
  const event = asRecord(payload);
  if (!event || typeof event.type !== "string") return undefined;
  if (event.type === "message_start") {
    const message = asRecord(event.message);
    if (message?.role !== "user") return undefined;
    const detail = visibleText(message.content);
    if (!detail) return undefined;
    return { id: row.id, createdAt: row.createdAt, kind: "input", label: "Input", detail };
  }
  if (event.type === "tool_execution_start") {
    const toolName = typeof event.toolName === "string" ? safeDetail(event.toolName) : "Tool";
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "tool_call",
      label: `Tool call: ${toolName}`,
      detail: safeDetail(event.args ?? event.input ?? {}),
    };
  }
  if (event.type === "tool_execution_end") {
    const toolName = typeof event.toolName === "string" ? safeDetail(event.toolName) : "Tool";
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "tool_result",
      label: `Tool result: ${toolName}`,
      detail: safeDetail(event.result ?? ""),
    };
  }
  return undefined;
}

function contactMessageRow(
  db: Database.Database,
  contactId: string,
  messageId: string,
): { id: string; content: string; metadataJson: string; conversationId: string } | undefined {
  return db.prepare(`
    SELECT messages.id, messages.content, messages.metadata_json AS metadataJson,
           messages.conversation_id AS conversationId
    FROM messages
    JOIN conversations ON conversations.id = messages.conversation_id
    WHERE messages.id = ? AND messages.role = 'assistant'
      AND conversations.kind = 'private' AND conversations.contact_id = ?
  `).get(messageId, contactId) as
    | { id: string; content: string; metadataJson: string; conversationId: string }
    | undefined;
}

function contactMessageTrace(
  db: Database.Database,
  contactId: string,
  conversationId: string,
  metadataJson: string,
): TraceRow[] {
  const range = processTraceRange(metadataJson);
  if (!range) return [];
  const mapping = db.prepare(`
    SELECT id FROM pi_session_mappings
    WHERE contact_id = ? AND conversation_id = ? AND kind = 'private' AND task_id IS NULL
  `).get(contactId, conversationId) as { id: string } | undefined;
  if (!mapping || range.throughSequence <= range.afterSequence) return [];
  return db.prepare(`
    SELECT sequence, id, call_id AS callId, type, payload_json AS payloadJson,
           created_at AS createdAt
    FROM trace_records
    WHERE mapping_id = ? AND sequence > ? AND sequence <= ?
      AND type IN ('final_message', 'pi_event')
    ORDER BY sequence
  `).all(mapping.id, range.afterSequence, range.throughSequence) as TraceRow[];
}

function readPrivateDetails(
  db: Database.Database,
  contactId: string,
  messageId: string,
): ProcessDetails {
  const contact = db.prepare("SELECT 1 AS found FROM contacts WHERE id = ?").get(contactId);
  if (!contact) throw new Error(`Contact not found: ${contactId}`);
  const message = contactMessageRow(db, contactId, messageId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  const traceRows = contactMessageTrace(db, contactId, message.conversationId, message.metadataJson);
  const assistantMessages = traceRows
    .filter((row) => row.type === "final_message")
    .map((row) => assistantTraceMessage(parseJson(row.payloadJson)))
    .filter((value): value is Record<string, unknown> => Boolean(value));
  return {
    summary: summaryFromMessages(1, assistantMessages),
    events: traceRows.map(privateEvent).filter((event): event is ProcessEvent => Boolean(event)),
  };
}

function readTaskRun(
  db: Database.Database,
  groupId: string,
  runId: string,
): RunRow {
  const group = db.prepare("SELECT 1 AS found FROM groups WHERE id = ?").get(groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  const run = db.prepare(`
    SELECT runs.id, runs.task_id AS taskId, tasks.group_id AS groupId,
           runs.contact_id AS contactId, runs.work_item_id AS workItemId,
           work_items.title AS workItemTitle, tasks.description AS taskDescription,
           runs.started_at AS startedAt,
           work_items.source_message_id AS sourceMessageId
    FROM runs
    JOIN tasks ON tasks.id = runs.task_id
    JOIN work_items ON work_items.id = runs.work_item_id
    WHERE tasks.group_id = ? AND runs.id = ?
  `).get(groupId, runId) as RunRow | undefined;
  if (!run) throw new Error(`Run not found: ${runId}`);
  return run;
}

function taskRunMessages(db: Database.Database, run: RunRow): AssistantMessageRow[] {
  return db.prepare(`
    SELECT messages.id, messages.content, messages.metadata_json AS metadataJson,
           messages.created_at AS createdAt
    FROM messages
    JOIN conversations ON conversations.id = messages.conversation_id
    WHERE conversations.kind = 'task' AND conversations.task_id = ?
      AND conversations.group_id = ? AND messages.role = 'assistant'
      AND json_extract(messages.metadata_json, '$.runId') = ?
    ORDER BY messages.created_at, messages.id
  `).all(run.taskId, run.groupId, run.id) as AssistantMessageRow[];
}

function taskRunEvents(
  db: Database.Database,
  run: RunRow,
  piSessionId: string | undefined,
): RunEventRow[] {
  const rows = db.prepare(`
    SELECT id, type, payload_json AS payloadJson, created_at AS createdAt
    FROM events
    WHERE entity_type = 'run' AND entity_id = ?
      AND json_extract(payload_json, '$.runId') = ?
      AND json_extract(payload_json, '$.taskId') = ?
      AND json_extract(payload_json, '$.contactId') = ?
    ORDER BY CAST(json_extract(payload_json, '$.eventSequence') AS INTEGER), id
  `).all(run.id, run.id, run.taskId, run.contactId) as RunEventRow[];
  return piSessionId
    ? rows.filter((row) => {
        const payload = asRecord(parseJson(row.payloadJson));
        return payload?.piSessionId === piSessionId;
      })
    : rows;
}

function runTraceMapping(db: Database.Database, run: RunRow): { id: string; piSessionId: string } | undefined {
  return db.prepare(`
    SELECT id, pi_session_id AS piSessionId
    FROM pi_session_mappings
    WHERE contact_id = ? AND task_id = ? AND kind = 'task'
  `).get(run.contactId, run.taskId) as { id: string; piSessionId: string } | undefined;
}

function taskRunTraceEvents(
  db: Database.Database,
  run: RunRow,
  mapping: { id: string; piSessionId: string } | undefined,
  events: RunEventRow[],
): Map<string, { callId: string | null; payload: Record<string, unknown> }> {
  const byEventId = new Map<string, { callId: string | null; payload: Record<string, unknown> }>();
  if (!mapping || !events.length) return byEventId;
  const runEventIds = new Set(events.map(({ id }) => id));
  const callBoundEventTypes = new Set([
    "tool.started",
    "tool.completed",
    "tool.cancelled",
    "final_message",
  ]);
  const runEventTypes = new Map(events.map(({ id, type }) => [id, type]));
  const records = db.prepare(`
    SELECT id, call_id AS callId, payload_json AS payloadJson
    FROM trace_records
    WHERE mapping_id = ? AND type = 'achat_event'
      AND json_extract(payload_json, '$.payload.runId') = ?
      AND json_extract(payload_json, '$.payload.taskId') = ?
      AND json_extract(payload_json, '$.payload.contactId') = ?
    ORDER BY sequence
  `).all(mapping.id, run.id, run.taskId, run.contactId) as Array<{
    id: string;
    callId: string | null;
    payloadJson: string;
  }>;
  for (const record of records) {
    const wrapper = asRecord(parseJson(record.payloadJson));
    const payload = asRecord(wrapper?.payload);
    if (
      typeof payload?.eventId !== "string"
      || !runEventIds.has(payload.eventId)
      || payload.piSessionId !== mapping.piSessionId
      || typeof wrapper?.type !== "string"
      || !callBoundEventTypes.has(wrapper.type)
      || runEventTypes.get(payload.eventId) !== wrapper.type
    ) {
      continue;
    }
    byEventId.set(payload.eventId, { callId: record.callId, payload });
  }
  return byEventId;
}

function taskTraceAssistantMessages(
  db: Database.Database,
  mappingId: string | undefined,
  callIds: string[],
): Array<{ callId: string | null; message: Record<string, unknown> }> {
  if (!mappingId || !callIds.length) return [];
  const placeholders = callIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT sequence, id, call_id AS callId, type, payload_json AS payloadJson,
           created_at AS createdAt
    FROM trace_records
    WHERE mapping_id = ? AND type = 'final_message' AND call_id IN (${placeholders})
    ORDER BY sequence
  `).all(mappingId, ...callIds) as TraceRow[];
  return rows.flatMap((row) => {
    const message = assistantTraceMessage(parseJson(row.payloadJson));
    return message ? [{ callId: row.callId, message }] : [];
  });
}

function eventSequence(event: RunEventRow): number {
  const payload = asRecord(parseJson(event.payloadJson));
  return typeof payload?.eventSequence === "number" && Number.isFinite(payload.eventSequence)
    ? payload.eventSequence
    : Number.MAX_SAFE_INTEGER;
}

function taskProcessEvent(
  row: RunEventRow,
  traceEvent: { callId: string | null; payload: Record<string, unknown> } | undefined,
  assistantMessage: AssistantMessageRow | undefined,
  traceMessages: Array<{ callId: string | null; message: Record<string, unknown> }>,
): ProcessEvent | undefined {
  const rawPayload = asRecord(parseJson(row.payloadJson)) ?? {};
  const payload = traceEvent?.payload ?? rawPayload;
  const eventTraceMessage = traceEvent?.callId
    ? traceMessages.find(({ callId }) => callId === traceEvent.callId)?.message
    : undefined;
  if (row.type === "tool.started") {
    const toolName = typeof payload.toolName === "string" ? safeDetail(payload.toolName) : "Tool";
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "tool_call",
      label: `Tool call: ${toolName}`,
      detail: safeDetail(payload.args ?? payload.input ?? {}),
    };
  }
  if (row.type === "tool.completed") {
    const toolName = typeof payload.toolName === "string" ? safeDetail(payload.toolName) : "Tool";
    const failed = payload.isError === true;
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "tool_result",
      label: failed ? `Tool failed: ${toolName}` : `Tool result: ${toolName}`,
      detail: safeDetail(payload.result ?? ""),
    };
  }
  if (row.type === "tool.cancelled") {
    const toolName = typeof payload.toolName === "string" ? safeDetail(payload.toolName) : "Tool";
    return { id: row.id, createdAt: row.createdAt, kind: "tool_result", label: `Tool cancelled: ${toolName}`, detail: "" };
  }
  if (row.type === "final_message") {
    const text = assistantMessage?.content ?? payload.text;
    const detail = visibleText(text);
    if (!detail) return undefined;
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "assistant_message",
      label: "Assistant reply",
      detail,
      ...(eventTraceMessage && modelName(eventTraceMessage)
        ? { model: modelName(eventTraceMessage) }
        : {}),
      ...(typeof eventTraceMessage?.durationMs === "number" && Number.isFinite(eventTraceMessage.durationMs)
        ? { durationMs: eventTraceMessage.durationMs }
        : {}),
    };
  }
  if (row.type === "run.error") {
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "error",
      label: "Run error",
      detail: safeDetail(payload.message ?? "The run failed"),
    };
  }
  if (row.type === "run.aborted" || row.type === "run.interrupted") {
    return {
      id: row.id,
      createdAt: row.createdAt,
      kind: "error",
      label: "Run interrupted",
      detail: safeDetail(payload.reason ?? "The run was interrupted"),
    };
  }
  return undefined;
}

function readTaskRunDetails(db: Database.Database, groupId: string, runId: string): ProcessDetails {
  const run = readTaskRun(db, groupId, runId);
  const assistantMessages = taskRunMessages(db, run);
  const mapping = runTraceMapping(db, run);
  const runEvents = taskRunEvents(db, run, mapping?.piSessionId);
  const traceEvents = taskRunTraceEvents(db, run, mapping, runEvents);
  const callIds = [...new Set([...traceEvents.values()]
    .map(({ callId }) => callId)
    .filter((callId): callId is string => Boolean(callId)))];
  const traceMessages = taskTraceAssistantMessages(db, mapping?.id, callIds);
  const events: Array<{ event: ProcessEvent; order: number }> = [];

  const taskInstructions = [
    run.taskDescription ? `Task:\n${run.taskDescription}` : "",
    run.workItemTitle ? `Assigned work item:\n${run.workItemTitle}` : "",
  ].filter(Boolean).join("\n\n");
  if (taskInstructions) {
    events.push({
      event: {
        id: `run:${run.id}:instructions`,
        createdAt: run.startedAt,
        kind: "context",
        label: "Task instructions",
        detail: safeDetail(taskInstructions),
      },
      order: -2,
    });
  }

  if (run.sourceMessageId) {
    const source = db.prepare(`
      SELECT messages.id, messages.role, messages.content, messages.created_at AS createdAt
      FROM messages
      JOIN conversations ON conversations.id = messages.conversation_id
      WHERE messages.id = ? AND messages.role IN ('user', 'handoff')
        AND conversations.kind = 'task' AND conversations.task_id = ?
        AND conversations.group_id = ?
    `).get(run.sourceMessageId, run.taskId, run.groupId) as
      | { id: string; role: string; content: string; createdAt: string }
      | undefined;
    if (source) {
      events.push({
        event: {
          id: `message:${source.id}`,
          createdAt: source.createdAt,
          kind: source.role === "handoff" ? "handoff" : "input",
          label: source.role === "handoff" ? "Handoff instructions" : "Task input",
          detail: safeDetail(source.content),
        },
        order: -1,
      });
    }
  }

  const assistantByEventId = new Map<string, AssistantMessageRow>();
  for (const message of assistantMessages) {
    const metadata = asRecord(parseJson(message.metadataJson));
    if (typeof metadata?.eventId === "string") assistantByEventId.set(metadata.eventId, message);
  }
  const emittedAssistantIds = new Set<string>();
  for (const event of runEvents) {
    const processEvent = taskProcessEvent(
      event,
      traceEvents.get(event.id),
      assistantByEventId.get(event.id),
      traceMessages,
    );
    if (!processEvent) continue;
    events.push({ event: processEvent, order: eventSequence(event) });
    if (event.type === "final_message") emittedAssistantIds.add(event.id);
  }
  for (const message of assistantMessages) {
    const metadata = asRecord(parseJson(message.metadataJson));
    const eventId = typeof metadata?.eventId === "string" ? metadata.eventId : undefined;
    if (eventId && emittedAssistantIds.has(eventId)) continue;
    const traceMessage = traceMessages.find(({ callId }) =>
      callId !== null && traceEvents.get(eventId ?? "")?.callId === callId)?.message;
    events.push({
      event: {
        id: message.id,
        createdAt: message.createdAt,
        kind: "assistant_message",
        label: "Assistant reply",
        detail: visibleText(message.content),
        ...(traceMessage && modelName(traceMessage) ? { model: modelName(traceMessage) } : {}),
        ...(typeof traceMessage?.durationMs === "number" && Number.isFinite(traceMessage.durationMs)
          ? { durationMs: traceMessage.durationMs }
          : {}),
      },
      order: eventId ? eventSequence(runEvents.find(({ id }) => id === eventId) ?? {
        id: message.id,
        type: "",
        payloadJson: "{}",
        createdAt: message.createdAt,
      }) : Number.MAX_SAFE_INTEGER,
    });
  }

  const messageCount = assistantMessages.length
    || runEvents.filter(({ type }) => type === "final_message").length
    || traceMessages.length;
  return {
    summary: summaryFromMessages(messageCount, traceMessages.map(({ message }) => message)),
    events: events
      .sort((left, right) => left.order - right.order || left.event.id.localeCompare(right.event.id))
      .map(({ event }) => event),
  };
}

export function createProcessDetailsService(db: Database.Database) {
  return {
    getContactMessageProcessDetails(contactId: string, messageId: string): ProcessDetails {
      return readPrivateDetails(db, contactId, messageId);
    },
    getGroupRunProcessDetails(groupId: string, runId: string): ProcessDetails {
      return readTaskRunDetails(db, groupId, runId);
    },
    listContactMessageProcessSummaries(
      contactId: string,
      messageIds: string[],
    ): Record<string, ProcessSummary> {
      const summaries: Record<string, ProcessSummary> = {};
      for (const messageId of messageIds) {
        const message = contactMessageRow(db, contactId, messageId);
        if (!message) continue;
        const traceRows = contactMessageTrace(db, contactId, message.conversationId, message.metadataJson);
        const assistantMessages = traceRows
          .filter((row) => row.type === "final_message")
          .map((row) => assistantTraceMessage(parseJson(row.payloadJson)))
          .filter((value): value is Record<string, unknown> => Boolean(value));
        summaries[message.id] = summaryFromMessages(1, assistantMessages);
      }
      return summaries;
    },
    listGroupRunProcessSummaries(groupId: string): Record<string, ProcessSummary> {
      const group = db.prepare("SELECT 1 AS found FROM groups WHERE id = ?").get(groupId);
      if (!group) throw new Error(`Group not found: ${groupId}`);
      const runs = db.prepare(`
        SELECT runs.id
        FROM runs
        JOIN tasks ON tasks.id = runs.task_id
        WHERE tasks.group_id = ?
        ORDER BY runs.started_at, runs.id
      `).all(groupId) as Array<{ id: string }>;
      return Object.fromEntries(runs.map(({ id }) => [
        id,
        readTaskRunDetails(db, groupId, id).summary,
      ]));
    },
  };
}

async function withProcessDetailsService<T>(
  operation: (service: ReturnType<typeof createProcessDetailsService>) => T,
): Promise<T> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return operation(createProcessDetailsService(db));
  } finally {
    db.close();
  }
}

export function getContactMessageProcessDetails(
  contactId: string,
  messageId: string,
): Promise<ProcessDetails> {
  return withProcessDetailsService((service) =>
    service.getContactMessageProcessDetails(contactId, messageId));
}

export function getGroupRunProcessDetails(
  groupId: string,
  runId: string,
): Promise<ProcessDetails> {
  return withProcessDetailsService((service) =>
    service.getGroupRunProcessDetails(groupId, runId));
}

export function listContactMessageProcessSummaries(
  contactId: string,
  messageIds: string[],
): Promise<Record<string, ProcessSummary>> {
  return withProcessDetailsService((service) =>
    service.listContactMessageProcessSummaries(contactId, messageIds));
}
