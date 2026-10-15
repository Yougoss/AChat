import type Database from "better-sqlite3";
import type { TaskEvent } from "../../domain/types.ts";
import { asRecord, asRecords, deserialize, serialize } from "./repository-utils.ts";

export interface AppEvent {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: string;
}

export interface AppendEventInput extends Omit<AppEvent, "createdAt"> {
  createdAt?: string;
}

export interface AppendTaskEventInput extends Omit<TaskEvent, "createdAt"> {
  createdAt?: string;
}

interface EventRow {
  id: string;
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
    const existingRow = db.prepare(`
      SELECT id, entity_type AS entityType, entity_id AS entityId, type,
             payload_json AS payloadJson, idempotency_key AS idempotencyKey,
             created_at AS createdAt
      FROM events WHERE entity_type = ? AND entity_id = ? AND idempotency_key = ?
    `).get(input.entityType, input.entityId, input.idempotencyKey);
    if (existingRow) {
      const existing = asRecord<EventRow>(existingRow);
      if (existing.type !== input.type || existing.payloadJson !== payloadJson) {
        throw new Error("Event idempotency key conflicts with existing event");
      }
      return rowToEvent(existing);
    }
    const event: AppEvent = {
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
    return event;
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
        SELECT id, entity_type AS entityType, entity_id AS entityId, type,
               payload_json AS payloadJson, idempotency_key AS idempotencyKey,
               created_at AS createdAt
        FROM events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, id
      `).all(entityType, entityId)).map(rowToEvent);
    },
  };
}
