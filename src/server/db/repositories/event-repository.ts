import type Database from "better-sqlite3";
import type { TaskEvent } from "../../domain/types.ts";
import { asRecord, asRecords, deserialize, serialize } from "./repository-utils.ts";
import { publishPersistedEvent } from "./event-pubsub.ts";

export interface AppEvent {
  id: string;
  cursor: number;
  entityType: string;
  entityId: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: string;
}

export interface AppendEventInput extends Omit<AppEvent, "cursor" | "createdAt"> {
  createdAt?: string;
}

export interface AppendTaskEventInput extends Omit<TaskEvent, "createdAt"> {
  createdAt?: string;
}

interface EventRow {
  id: string;
  cursor: number;
  entityType: string;
  entityId: string;
  type: string;
  payloadJson: string;
  idempotencyKey: string;
  createdAt: string;
}

interface TaskEventRow {
  id: string;
  taskId: string;
  type: string;
  payloadJson: string;
  idempotencyKey: string;
  createdAt: string;
}

function rowToEvent(row: EventRow): AppEvent {
  return {
    id: row.id,
    cursor: row.cursor,
    entityType: row.entityType,
    entityId: row.entityId,
    type: row.type,
    payload: deserialize(row.payloadJson),
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

function rowToTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.taskId,
    type: row.type,
    payload: deserialize(row.payloadJson),
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

export function createEventRepository(db: Database.Database) {
  function appendEvent(input: AppendEventInput): AppEvent {
    const payloadJson = serialize(input.payload);
    const append = db.transaction(() => {
      const existingRow = db.prepare(`
        SELECT events.id, achat_event_cursors.cursor,
               events.entity_type AS entityType, events.entity_id AS entityId,
               events.type, events.payload_json AS payloadJson,
               events.idempotency_key AS idempotencyKey, events.created_at AS createdAt
        FROM events
        JOIN achat_event_cursors ON achat_event_cursors.event_id = events.id
        WHERE events.entity_type = ? AND events.entity_id = ? AND events.idempotency_key = ?
      `).get(input.entityType, input.entityId, input.idempotencyKey);
      if (existingRow) {
        const existing = asRecord<EventRow>(existingRow);
        if (existing.type !== input.type || existing.payloadJson !== payloadJson) {
          throw new Error("Event idempotency key conflicts with existing event");
        }
        return { event: rowToEvent(existing), inserted: false };
      }
      const event = {
        ...input,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      db.prepare(`
        INSERT INTO events (
          id, entity_type, entity_id, type, payload_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.entityType,
        event.entityId,
        event.type,
        payloadJson,
        event.idempotencyKey,
        event.createdAt,
      );
      db.prepare("INSERT INTO achat_event_cursors (event_id) VALUES (?)").run(event.id);
      const stored = db.prepare(`
        SELECT events.id, achat_event_cursors.cursor,
               events.entity_type AS entityType, events.entity_id AS entityId,
               events.type, events.payload_json AS payloadJson,
               events.idempotency_key AS idempotencyKey, events.created_at AS createdAt
        FROM events
        JOIN achat_event_cursors ON achat_event_cursors.event_id = events.id
        WHERE events.id = ?
      `).get(event.id);
      return { event: rowToEvent(asRecord<EventRow>(stored)), inserted: true };
    });
    const result = append();
    if (result.inserted) publishPersistedEvent(db, result.event);
    return result.event;
  }

  return {
    appendEvent,
    appendTaskEvent(input: AppendTaskEventInput): TaskEvent {
      const payloadJson = serialize(input.payload);
      const existingRow = db.prepare(`
        SELECT id, task_id AS taskId, type, payload_json AS payloadJson,
               idempotency_key AS idempotencyKey, created_at AS createdAt
        FROM task_events WHERE task_id = ? AND idempotency_key = ?
      `).get(input.taskId, input.idempotencyKey);
      if (existingRow) {
        const existing = asRecord<TaskEventRow>(existingRow);
        if (existing.type !== input.type || existing.payloadJson !== payloadJson) {
          throw new Error("Task event idempotency key conflicts with existing event");
        }
        return rowToTaskEvent(existing);
      }

      const event: TaskEvent = {
        ...input,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      db.prepare(`
        INSERT INTO task_events (
          id, task_id, type, payload_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.taskId,
        event.type,
        payloadJson,
        event.idempotencyKey,
        event.createdAt,
      );
      return event;
    },
    listTaskEvents(taskId: string): TaskEvent[] {
      return asRecords<TaskEventRow>(db.prepare(`
        SELECT id, task_id AS taskId, type, payload_json AS payloadJson,
               idempotency_key AS idempotencyKey, created_at AS createdAt
        FROM task_events WHERE task_id = ? ORDER BY created_at, id
      `).all(taskId)).map(rowToTaskEvent);
    },
    listEventsForEntity(entityType: string, entityId: string): AppEvent[] {
      return asRecords<EventRow>(db.prepare(`
        SELECT events.id, achat_event_cursors.cursor,
               events.entity_type AS entityType, events.entity_id AS entityId,
               events.type, events.payload_json AS payloadJson,
               events.idempotency_key AS idempotencyKey, events.created_at AS createdAt
        FROM events
        JOIN achat_event_cursors ON achat_event_cursors.event_id = events.id
        WHERE events.entity_type = ? AND events.entity_id = ?
        ORDER BY achat_event_cursors.cursor
      `).all(entityType, entityId)).map(rowToEvent);
    },
    listEventsAfterCursor(cursor: number): AppEvent[] {
      return asRecords<EventRow>(db.prepare(`
        SELECT events.id, achat_event_cursors.cursor,
               events.entity_type AS entityType, events.entity_id AS entityId,
               events.type, events.payload_json AS payloadJson,
               events.idempotency_key AS idempotencyKey, events.created_at AS createdAt
        FROM events
        JOIN achat_event_cursors ON achat_event_cursors.event_id = events.id
        WHERE achat_event_cursors.cursor > ?
        ORDER BY achat_event_cursors.cursor
      `).all(cursor)).map(rowToEvent);
    },
    getCurrentCursor(): number {
      const row = db.prepare(`
        SELECT COALESCE(MAX(cursor), 0) AS cursor FROM achat_event_cursors
      `).get() as { cursor: number };
      return row.cursor;
    },
  };
}
