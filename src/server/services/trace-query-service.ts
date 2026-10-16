import type Database from "better-sqlite3";
import type { PiSessionMapping } from "../domain/types.ts";
import { createSessionRepository } from "../db/repositories/session-repository.ts";

export interface ContactSessionSummary {
  sessionRef: string;
  kind: PiSessionMapping["kind"];
  taskId: string | null;
  createdAt: string;
  lastActivity: string;
}

export interface TaskSessionSummary {
  taskId: string;
  groupId: string;
  title: string;
  status: string;
  lastActivity: string;
  sessionRefs: string[];
}

export interface TraceRecord {
  id: string;
  sessionRef: string;
  type: string;
  callId: string | null;
  payload: unknown;
  createdAt: string;
}

interface Cursor {
  key: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | undefined {
  if (!value) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof cursor.key !== "string" || typeof cursor.id !== "string") throw new Error();
    return { key: cursor.key, id: cursor.id };
  } catch {
    throw new Error("Invalid trace query cursor");
  }
}

function pageLimit(limit: number | undefined, fallback = 20): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Trace query limit must be an integer between 1 and 100");
  }
  return limit;
}

function parseTraceRow(row: {
  id: string;
  sessionRef: string;
  type: string;
  callId: string | null;
  payload: string;
  createdAt: string;
}): TraceRecord {
  return {
    id: row.id,
    sessionRef: row.sessionRef,
    type: row.type,
    callId: row.callId,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.createdAt,
  };
}

export function createTraceQueryService(db: Database.Database) {
  const sessions = createSessionRepository(db);
  return {
    async listContactSessions(
      contactId: string,
      options: { cursor?: string; limit?: number; taskId?: string } = {},
    ): Promise<{ items: ContactSessionSummary[]; nextCursor: string | null }> {
      const limit = pageLimit(options.limit);
      const cursor = decodeCursor(options.cursor);
      if (options.taskId !== undefined) {
        const membership = db.prepare(`
          SELECT 1 AS member
          FROM task_members
          WHERE task_id = ? AND contact_id = ?
        `).get(options.taskId, contactId);
        if (!membership) {
          const exists = db.prepare("SELECT 1 AS found FROM tasks WHERE id = ?").get(options.taskId);
          throw new Error(exists
            ? `Contact ${contactId} is not authorized to read task ${options.taskId}`
            : `Task not found: ${options.taskId}`);
        }
      }
      const rows = db.prepare(`
        SELECT mapping.pi_session_id AS sessionRef,
               mapping.kind,
               mapping.task_id AS taskId,
               mapping.created_at AS createdAt,
               COALESCE(MAX(trace.created_at), mapping.created_at) AS lastActivity,
               mapping.id AS mappingId
        FROM pi_session_mappings AS mapping
        LEFT JOIN trace_records AS trace ON trace.mapping_id = mapping.id
        WHERE mapping.contact_id = ?
          AND (? IS NULL OR mapping.task_id = ?)
        GROUP BY mapping.id
        HAVING ? IS NULL
          OR lastActivity < ?
          OR (lastActivity = ? AND mapping.id < ?)
        ORDER BY lastActivity DESC, mapping.id DESC
        LIMIT ?
      `).all(
        contactId,
        options.taskId ?? null,
        options.taskId ?? null,
        cursor?.key ?? null,
        cursor?.key ?? null,
        cursor?.key ?? null,
        cursor?.id ?? null,
        limit + 1,
      ) as Array<ContactSessionSummary & { mappingId: string }>;
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(({ mappingId: _mappingId, ...item }) => item);
      const last = rows[limit - 1];
      return {
        items,
        nextCursor: hasMore && last
          ? encodeCursor({ key: last.lastActivity, id: last.mappingId })
          : null,
      };
    },

    async listContactTasks(
      contactId: string,
      options: { cursor?: string; limit?: number; taskId?: string } = {},
    ): Promise<{ items: TaskSessionSummary[]; nextCursor: string | null }> {
      const limit = pageLimit(options.limit, 5);
      const cursor = decodeCursor(options.cursor);
      if (options.taskId) {
        const task = db.prepare(`
          SELECT tasks.id
          FROM tasks
          JOIN task_members ON task_members.task_id = tasks.id
          WHERE tasks.id = ? AND task_members.contact_id = ?
        `).get(options.taskId, contactId);
        if (!task) {
          const exists = db.prepare("SELECT 1 AS found FROM tasks WHERE id = ?").get(options.taskId);
          throw new Error(exists
            ? `Contact ${contactId} is not authorized to read task ${options.taskId}`
            : `Task not found: ${options.taskId}`);
        }
      }
      const rows = db.prepare(`
        WITH scoped_tasks AS (
          SELECT tasks.id AS taskId,
                 tasks.group_id AS groupId,
                 tasks.description AS title,
                 tasks.status,
                 COALESCE(
                   (SELECT MAX(trace.created_at)
                    FROM pi_session_mappings AS mapping
                    JOIN trace_records AS trace ON trace.mapping_id = mapping.id
                    WHERE mapping.task_id = tasks.id AND mapping.contact_id = task_members.contact_id),
                   (SELECT MAX(mapping.created_at)
                    FROM pi_session_mappings AS mapping
                    WHERE mapping.task_id = tasks.id AND mapping.contact_id = task_members.contact_id),
                   tasks.updated_at
                 ) AS lastActivity
          FROM tasks
          JOIN task_members ON task_members.task_id = tasks.id
          WHERE task_members.contact_id = ?
            AND (? IS NULL OR tasks.id = ?)
        )
        SELECT * FROM scoped_tasks
        WHERE ? IS NULL
          OR lastActivity < ?
          OR (lastActivity = ? AND taskId < ?)
        ORDER BY lastActivity DESC, taskId DESC
        LIMIT ?
      `).all(
        contactId,
        options.taskId ?? null,
        options.taskId ?? null,
        cursor?.key ?? null,
        cursor?.key ?? null,
        cursor?.key ?? null,
        cursor?.id ?? null,
        limit + 1,
      ) as Array<Omit<TaskSessionSummary, "sessionRefs">>;
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        ...row,
        sessionRefs: sessions.listSessionMappingsForContactTask(contactId, row.taskId)
          .map((mapping) => mapping.piSessionId),
      }));
      const last = rows[limit - 1];
      return {
        items,
        nextCursor: hasMore && last
          ? encodeCursor({ key: last.lastActivity, id: last.taskId })
          : null,
      };
    },

    async readContactSession(
      contactId: string,
      sessionRef: string,
      options: { cursor?: string; limit?: number; taskId?: string } = {},
    ): Promise<{ items: TraceRecord[]; nextCursor: string | null }> {
      const mapping = sessions.getSessionMappingByContactAndPiSessionId(contactId, sessionRef);
      if (!mapping) {
        if (sessions.getSessionMappingByPiSessionId(sessionRef)) {
          throw new Error(`Contact ${contactId} is not authorized to read Pi session ${sessionRef}`);
        }
        throw new Error(`Pi session not found: ${sessionRef}`);
      }
      if (options.taskId !== undefined && mapping.taskId !== options.taskId) {
        throw new Error(`Pi session ${sessionRef} does not belong to task ${options.taskId}`);
      }
      const limit = pageLimit(options.limit);
      const cursor = decodeCursor(options.cursor);
      const rows = db.prepare(`
        SELECT sequence, id, call_id AS callId, type, payload_json AS payload,
               created_at AS createdAt
        FROM trace_records
        WHERE mapping_id = ? AND (? IS NULL OR sequence > ?)
        ORDER BY sequence
        LIMIT ?
      `).all(mapping.id, cursor?.id ?? null, cursor?.id ?? null, limit + 1) as Array<{
        sequence: number;
        id: string;
        callId: string | null;
        type: string;
        payload: string;
        createdAt: string;
      }>;
      const hasMore = rows.length > limit;
      const selected = rows.slice(0, limit);
      return {
        items: selected.map((row) => parseTraceRow({
          ...row,
          sessionRef,
        })),
        nextCursor: hasMore && selected.length
          ? encodeCursor({ key: "sequence", id: String(selected.at(-1)!.sequence) })
          : null,
      };
    },
  };
}
