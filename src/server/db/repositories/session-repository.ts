import type Database from "better-sqlite3";
import type { PiSessionMapping } from "../../domain/types.ts";
import { asRecord, asRecords } from "./repository-utils.ts";

interface SessionMappingRow extends PiSessionMapping {}

interface CreateSessionMappingInput extends Omit<PiSessionMapping, "createdAt"> {
  createdAt?: string;
}

export function createSessionRepository(db: Database.Database) {
  function findByPiSessionId(piSessionId: string): PiSessionMapping | undefined {
    const row = db.prepare(`
      SELECT id, contact_id AS contactId, task_id AS taskId,
             conversation_id AS conversationId, kind, pi_session_id AS piSessionId,
             session_file AS sessionFile, created_at AS createdAt
      FROM pi_session_mappings WHERE pi_session_id = ?
    `).get(piSessionId);
    return row ? { ...asRecord<SessionMappingRow>(row) } : undefined;
  }

  return {
    createSessionMapping(input: CreateSessionMappingInput): PiSessionMapping {
      const mapping: PiSessionMapping = {
        ...input,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      db.prepare(`
        INSERT INTO pi_session_mappings (
          id, contact_id, task_id, conversation_id, kind, pi_session_id,
          session_file, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mapping.id,
        mapping.contactId,
        mapping.taskId,
        mapping.conversationId,
        mapping.kind,
        mapping.piSessionId,
        mapping.sessionFile,
        mapping.createdAt,
      );
      return mapping;
    },
    getSessionMappingById(id: string): PiSessionMapping | undefined {
      const row = db.prepare(`
        SELECT id, contact_id AS contactId, task_id AS taskId,
               conversation_id AS conversationId, kind, pi_session_id AS piSessionId,
               session_file AS sessionFile, created_at AS createdAt
        FROM pi_session_mappings WHERE id = ?
      `).get(id);
      return row ? { ...asRecord<SessionMappingRow>(row) } : undefined;
    },
    getSessionMappingByPiSessionId: findByPiSessionId,
    getSessionMappingForContact(
      contactId: string,
      taskId: string | null,
    ): PiSessionMapping | undefined {
      const row = db.prepare(`
        SELECT id, contact_id AS contactId, task_id AS taskId,
               conversation_id AS conversationId, kind, pi_session_id AS piSessionId,
               session_file AS sessionFile, created_at AS createdAt
        FROM pi_session_mappings
        WHERE contact_id = ? AND task_id IS ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(contactId, taskId);
      return row ? { ...asRecord<SessionMappingRow>(row) } : undefined;
    },
    deleteSessionMapping(id: string): boolean {
      return db.prepare("DELETE FROM pi_session_mappings WHERE id = ?").run(id).changes > 0;
    },
    listSessionMappingsForContact(contactId: string): PiSessionMapping[] {
      return asRecords<SessionMappingRow>(db.prepare(`
        SELECT id, contact_id AS contactId, task_id AS taskId,
               conversation_id AS conversationId, kind, pi_session_id AS piSessionId,
               session_file AS sessionFile, created_at AS createdAt
        FROM pi_session_mappings WHERE contact_id = ? ORDER BY created_at, id
      `).all()).map((row) => ({ ...row }));
    },
  };
}
