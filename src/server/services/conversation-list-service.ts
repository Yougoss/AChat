import path from "node:path";
import type Database from "better-sqlite3";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";

export interface ConversationListItem {
  kind: "contact" | "task";
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  href: string;
  avatarText: string;
  unreadCount: number;
}

interface ConversationListRow {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  unreadCount: number;
}

function avatarText(title: string): string {
  return title.trim().slice(0, 1).toLocaleUpperCase() || "?";
}

export function createConversationListService(db: Database.Database) {
  return {
    listConversations(): ConversationListItem[] {
      const contacts = db.prepare(`
        SELECT contacts.id,
               contacts.name AS title,
               COALESCE((
                 SELECT messages.content
                 FROM conversations
                 JOIN messages ON messages.conversation_id = conversations.id
                 WHERE conversations.kind = 'private'
                   AND conversations.contact_id = contacts.id
                   AND conversations.id = (
                     SELECT id FROM conversations
                     WHERE kind = 'private' AND contact_id = contacts.id
                     ORDER BY id LIMIT 1
                   )
                 ORDER BY messages.created_at DESC, messages.id DESC
                 LIMIT 1
               ), '') AS preview,
               COALESCE((
                 SELECT messages.created_at
                 FROM conversations
                 JOIN messages ON messages.conversation_id = conversations.id
                 WHERE conversations.kind = 'private'
                   AND conversations.contact_id = contacts.id
                   AND conversations.id = (
                     SELECT id FROM conversations
                     WHERE kind = 'private' AND contact_id = contacts.id
                     ORDER BY id LIMIT 1
                   )
                 ORDER BY messages.created_at DESC, messages.id DESC
                 LIMIT 1
               ), (
                 SELECT conversations.created_at
                 FROM conversations
                 WHERE conversations.kind = 'private'
                   AND conversations.contact_id = contacts.id
                 ORDER BY conversations.id
                 LIMIT 1
               ), agents.created_at) AS updatedAt
        FROM contacts
        JOIN agents ON agents.id = contacts.agent_id
      `).all() as ConversationListRow[];
      const tasks = db.prepare(`
        SELECT groups.id,
               groups.name AS title,
               COALESCE((
                 SELECT messages.content
                 FROM conversations
                 JOIN messages ON messages.conversation_id = conversations.id
                 WHERE conversations.kind = 'task'
                   AND conversations.task_id = tasks.id
                   AND conversations.id = (
                     SELECT id FROM conversations
                     WHERE kind = 'task' AND task_id = tasks.id
                     ORDER BY created_at, id LIMIT 1
                   )
                 ORDER BY messages.created_at DESC, messages.id DESC
                 LIMIT 1
               ), '') AS preview,
               COALESCE((
                 SELECT messages.created_at
                 FROM conversations
                 JOIN messages ON messages.conversation_id = conversations.id
                 WHERE conversations.kind = 'task'
                   AND conversations.task_id = tasks.id
                   AND conversations.id = (
                     SELECT id FROM conversations
                     WHERE kind = 'task' AND task_id = tasks.id
                     ORDER BY created_at, id LIMIT 1
                   )
                 ORDER BY messages.created_at DESC, messages.id DESC
                 LIMIT 1
               ), tasks.updated_at, groups.created_at) AS updatedAt,
               (
                 SELECT COUNT(*)
                 FROM run_completions
                 WHERE run_completions.group_id = groups.id
                   AND run_completions.cursor > COALESCE((
                     SELECT group_run_read_cursors.cursor
                     FROM group_run_read_cursors
                     WHERE group_run_read_cursors.group_id = groups.id
                   ), 0)
               ) AS unreadCount
        FROM groups
        JOIN tasks ON tasks.group_id = groups.id
        WHERE EXISTS (
          SELECT 1 FROM task_members WHERE task_members.task_id = tasks.id
        )
      `).all() as ConversationListRow[];

      return [
        ...contacts.map((row): ConversationListItem => ({
          kind: "contact",
          id: row.id,
          title: row.title,
          preview: row.preview,
          updatedAt: row.updatedAt,
          href: `/contacts/${encodeURIComponent(row.id)}`,
          avatarText: avatarText(row.title),
          unreadCount: 0,
        })),
        ...tasks.map((row): ConversationListItem => ({
          kind: "task",
          id: row.id,
          title: row.title,
          preview: row.preview,
          updatedAt: row.updatedAt,
          href: `/groups/${encodeURIComponent(row.id)}`,
          avatarText: avatarText(row.title),
          unreadCount: row.unreadCount,
        })),
      ].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || left.title.localeCompare(right.title)
        || left.kind.localeCompare(right.kind)
        || left.id.localeCompare(right.id));
    },
  };
}

export async function listConversationItems(): Promise<ConversationListItem[]> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return createConversationListService(db).listConversations();
  } finally {
    db.close();
  }
}
