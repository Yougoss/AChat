import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Message } from "../domain/types.ts";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";
import { createMessageRepository } from "../db/repositories/message-repository.ts";
import { createUnreadRepository } from "../db/repositories/unread-repository.ts";
import { getPiModelRuntime } from "../pi/model-runtime.ts";
import { createContactSession } from "../pi/session-factory.ts";

type ContactChatSession = Pick<AgentSession, "messages" | "prompt">;
type ContactSessionFactory = (
  contactId: string,
  options: { sessionKind: "contact_chat" },
) => Promise<ContactChatSession>;

interface MessageServiceOptions {
  createContactSession?: ContactSessionFactory;
  idFactory?: () => string;
  now?: () => string;
}

function assistantText(message: AgentMessage | undefined): string {
  if (!message || message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function privateConversationId(
  db: Database.Database,
  contactId: string,
  idFactory: () => string,
): string {
  const existing = db.prepare(`
    SELECT id FROM conversations
    WHERE kind = 'private' AND contact_id = ?
    ORDER BY id LIMIT 1
  `).get(contactId) as { id: string } | undefined;
  if (existing) return existing.id;
  return createMessageRepository(db).createConversation({
    id: idFactory(),
    groupId: null,
    taskId: null,
    contactId,
    kind: "private",
  }).id;
}

function traceBoundary(
  db: Database.Database,
  contactId: string,
  conversationId: string,
): { mappingId: string; afterSequence: number } | undefined {
  const mapping = db.prepare(`
    SELECT id FROM pi_session_mappings
    WHERE contact_id = ? AND conversation_id = ? AND kind = 'private' AND task_id IS NULL
  `).get(contactId, conversationId) as { id: string } | undefined;
  if (!mapping) return undefined;
  const row = db.prepare(`
    SELECT COALESCE(MAX(sequence), 0) AS sequence
    FROM trace_records WHERE mapping_id = ?
  `).get(mapping.id) as { sequence: number };
  return { mappingId: mapping.id, afterSequence: row.sequence };
}

function traceSequence(db: Database.Database, mappingId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(MAX(sequence), 0) AS sequence
    FROM trace_records WHERE mapping_id = ?
  `).get(mappingId) as { sequence: number };
  return row.sequence;
}

export function createContactMessageService(
  db: Database.Database,
  options: MessageServiceOptions = {},
) {
  const messages = createMessageRepository(db);
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const openSession = options.createContactSession ?? createContactSession;

  return {
    async sendContactMessage(
      contactId: string,
      input: { content: string },
    ): Promise<{ userMessage: Message; assistantMessage: Message }> {
      const content = input.content.trim();
      if (!content) throw new Error("Contact message cannot be empty");
      const session = await openSession(contactId, { sessionKind: "contact_chat" });
      const previousMessageCount = session.messages.length;
      const conversationId = privateConversationId(db, contactId, idFactory);
      const traceStart = traceBoundary(db, contactId, conversationId);
      const userMessage = messages.appendMessage({
        id: idFactory(),
        conversationId,
        role: "user",
        content,
        createdAt: now(),
      });

      await session.prompt(content);
      const response = assistantText(session.messages.slice(previousMessageCount).reverse().find(
        (message) => message.role === "assistant",
      ));
      if (!response.trim()) {
        throw new Error("Contact session did not return an assistant message");
      }
      const throughSequence = traceStart
        ? traceSequence(db, traceStart.mappingId)
        : undefined;
      const assistantMessage = messages.appendMessage({
        id: idFactory(),
        conversationId,
        role: "assistant",
        content: response,
        ...(traceStart && throughSequence !== undefined
          ? {
              metadata: {
                processTraceRange: {
                  afterSequence: traceStart.afterSequence,
                  throughSequence,
                },
              },
            }
          : {}),
        createdAt: now(),
      });
      return { userMessage, assistantMessage };
    },
    listContactMessages(contactId: string): Message[] {
      const conversation = db.prepare(`
        SELECT id FROM conversations WHERE kind = 'private' AND contact_id = ?
        ORDER BY id LIMIT 1
      `).get(contactId) as { id: string } | undefined;
      return conversation ? messages.listMessages(conversation.id) : [];
    },
  };
}

export function markGroupRunsRead(
  db: Database.Database,
  groupId: string,
): void {
  const group = db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  createUnreadRepository(db).markGroupRunsRead(groupId);
}

async function withMessageService<T>(
  operation: (service: ReturnType<typeof createContactMessageService>) => Promise<T> | T,
): Promise<T> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return await operation(createContactMessageService(db));
  } finally {
    db.close();
  }
}

export function sendContactMessage(
  contactId: string,
  input: { content: string },
): Promise<{ userMessage: Message; assistantMessage: Message }> {
  return withMessageService((service) => service.sendContactMessage(contactId, input));
}

export function listContactMessages(contactId: string): Promise<Message[]> {
  return withMessageService((service) => service.listContactMessages(contactId));
}
