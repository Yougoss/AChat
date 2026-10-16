import type Database from "better-sqlite3";
import type { Conversation, Message } from "../../domain/types.ts";
import { asRecord, asRecords, deserialize, serialize } from "./repository-utils.ts";

interface ConversationRow {
  id: string;
  groupId: string | null;
  taskId: string | null;
  contactId: string | null;
  kind: "task" | "private";
  createdAt: string;
}

interface MessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  metadataJson: string;
  createdAt: string;
}

export interface AppendMessageInput extends Omit<Message, "metadata"> {
  metadata?: unknown;
}

export function createMessageRepository(db: Database.Database) {
  return {
    createConversation(input: Omit<Conversation, "createdAt"> & { createdAt?: string }): Conversation {
      const conversation: Conversation = {
        ...input,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      db.prepare(`
        INSERT INTO conversations (id, group_id, task_id, contact_id, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        conversation.id,
        conversation.groupId,
        conversation.taskId,
        conversation.contactId,
        conversation.kind,
        conversation.createdAt,
      );
      return conversation;
    },
    getConversation(id: string): Conversation | undefined {
      const row = db.prepare(`
        SELECT id, group_id AS groupId, task_id AS taskId, contact_id AS contactId,
               kind, created_at AS createdAt
        FROM conversations WHERE id = ?
      `).get(id);
      return row ? { ...asRecord<ConversationRow>(row) } : undefined;
    },
    appendMessage(input: AppendMessageInput): Message {
      db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.conversationId,
        input.role,
        input.content,
        serialize(input.metadata ?? {}),
        input.createdAt,
      );
      return {
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        ...(input.metadata && typeof input.metadata === "object"
          ? { metadata: input.metadata as Record<string, unknown> }
          : {}),
        createdAt: input.createdAt,
      };
    },
    getMessage(id: string): Message | undefined {
      const row = db.prepare(`
        SELECT id, conversation_id AS conversationId, role, content,
               metadata_json AS metadataJson, created_at AS createdAt
        FROM messages WHERE id = ?
      `).get(id);
      if (!row) return undefined;
      const message = asRecord<Omit<Message, "metadata"> & { metadataJson: string }>(row);
      return {
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        metadata: deserialize(message.metadataJson) as Record<string, unknown>,
        createdAt: message.createdAt,
      };
    },
    getMessageMetadata(id: string): unknown {
      const row = db.prepare("SELECT metadata_json AS metadataJson FROM messages WHERE id = ?").get(id);
      return row ? deserialize(asRecord<{ metadataJson: string }>(row).metadataJson) : undefined;
    },
    listMessages(conversationId: string): Message[] {
      return asRecords<MessageRow>(db.prepare(`
        SELECT id, conversation_id AS conversationId, role, content,
               metadata_json AS metadataJson, created_at AS createdAt
        FROM messages WHERE conversation_id = ? ORDER BY created_at, id
      `).all(conversationId)).map((row) => {
        const message = asRecord<MessageRow>(row);
        return {
          id: message.id,
          conversationId: message.conversationId,
          role: message.role,
          content: message.content,
          metadata: deserialize(message.metadataJson) as Record<string, unknown>,
          createdAt: message.createdAt,
        };
      });
    },
  };
}
