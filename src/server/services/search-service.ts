import type Database from "better-sqlite3";
import {
  createSearchPreview,
  prepareSearchQuery,
  searchTextHasExactTerm,
} from "../search/indexer.ts";

export interface SearchResult {
  ownerType: "contact" | "group";
  ownerId: string;
  taskId: string | null;
  title: string;
  preview: string;
  messageId: string | null;
  matchedAt: string | null;
  matchingMessageCount: number;
  href: string;
}

interface SearchDocumentRow {
  documentType: "contact" | "task" | "message";
  ownerType: "contact" | "group";
  ownerId: string;
  taskId: string | null;
  messageId: string | null;
  name: string;
  description: string;
  content: string;
  createdAt: string | null;
}

interface SearchGroup {
  ownerType: "contact" | "group";
  ownerId: string;
  taskId: string | null;
  title: string;
  messageMatches: SearchDocumentRow[];
  exactTermWeight: number;
  matchedAt: string | null;
  previewMessage?: SearchDocumentRow;
}

const MAX_SEARCH_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 20;

export function createSearchService(db: Database.Database) {
  return {
    async searchVisibleMessages(
      query: string,
      contactId?: string,
      limit?: number,
    ): Promise<SearchResult[]> {
      return searchVisibleMessagesInDatabase(db, query, contactId, limit);
    },
  };
}

export async function searchVisibleMessages(
  query: string,
  contactId?: string,
  limit?: number,
): Promise<SearchResult[]> {
  const { getAchatDatabase, startAchatRuntime } = await import("../runtime-bootstrap.ts");
  await startAchatRuntime();
  return createSearchService(getAchatDatabase()).searchVisibleMessages(query, contactId, limit);
}

function searchVisibleMessagesInDatabase(
  db: Database.Database,
  query: string,
  contactId?: string,
  limit?: number,
): SearchResult[] {
  const prepared = prepareSearchQuery(query);
  if (!prepared) return [];

  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit!)))
    : DEFAULT_SEARCH_LIMIT;
  const scopedContactId = contactId?.trim() || null;
  const rows = db.prepare(`
    SELECT documents.document_type AS documentType,
           CASE
             WHEN documents.document_type = 'contact' THEN 'contact'
             WHEN documents.document_type = 'task' THEN 'group'
             WHEN conversations.kind = 'private' THEN 'contact'
             ELSE 'group'
           END AS ownerType,
           CASE
             WHEN documents.document_type = 'contact' THEN documents.contact_id
             WHEN documents.document_type = 'task' THEN documents.group_id
             WHEN conversations.kind = 'private' THEN conversations.contact_id
             ELSE conversations.group_id
           END AS ownerId,
           documents.task_id AS taskId,
           documents.message_id AS messageId,
           coalesce(nullif(documents.name, ''), contacts.name, groups.name, '') AS name,
           documents.description,
           documents.content,
           documents.created_at AS createdAt
    FROM search_documents_fts
    JOIN search_documents AS documents ON documents.id = search_documents_fts.rowid
    LEFT JOIN messages ON messages.id = documents.message_id
    LEFT JOIN conversations ON conversations.id = messages.conversation_id
    LEFT JOIN contacts
      ON contacts.id = CASE
        WHEN documents.document_type = 'contact' THEN documents.contact_id
        WHEN conversations.kind = 'private' THEN conversations.contact_id
      END
    LEFT JOIN groups
      ON groups.id = CASE
        WHEN documents.document_type = 'task' THEN documents.group_id
        WHEN conversations.kind = 'task' THEN conversations.group_id
      END
    WHERE search_documents_fts MATCH ?
      AND (
        ? IS NULL
        OR (documents.document_type = 'contact' AND documents.contact_id = ?)
        OR (
          documents.document_type = 'task'
          AND EXISTS (
            SELECT 1 FROM task_members
            WHERE task_members.task_id = documents.task_id
              AND task_members.contact_id = ?
          )
        )
        OR (
          documents.document_type = 'message'
          AND (
            (conversations.kind = 'private' AND conversations.contact_id = ?)
            OR (
              conversations.kind = 'task'
              AND EXISTS (
                SELECT 1 FROM task_members
                WHERE task_members.task_id = conversations.task_id
                  AND task_members.contact_id = ?
              )
            )
          )
        )
      )
  `).all(
    prepared.matchExpression,
    scopedContactId,
    scopedContactId,
    scopedContactId,
    scopedContactId,
    scopedContactId,
  ) as SearchDocumentRow[];

  const resultGroups = new Map<string, SearchGroup>();
  for (const row of rows) {
    if (!row.ownerId) continue;
    const groupKey = `${row.ownerType}:${row.ownerId}`;
    let group = resultGroups.get(groupKey);
    if (!group) {
      group = {
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        taskId: row.taskId,
        title: row.name,
        messageMatches: [],
        exactTermWeight: 0,
        matchedAt: null,
      };
      resultGroups.set(groupKey, group);
    }
    if (row.documentType === "message" && row.messageId) {
      group.messageMatches.push(row);
      if (!group.matchedAt || (row.createdAt ?? "") > group.matchedAt) {
        group.matchedAt = row.createdAt;
        group.previewMessage = row;
      }
    }
    if (searchTextHasExactTerm(
      `${row.name} ${row.description} ${row.content}`,
      prepared.exactTerm,
    )) {
      group.exactTermWeight += 1;
    }
    if (row.documentType === "task" && row.taskId) group.taskId = row.taskId;
    if (row.name) group.title = row.name;
  }

  const findLatestMessage = db.prepare(`
    SELECT messages.id AS messageId, messages.content, messages.created_at AS createdAt
    FROM messages
    JOIN conversations ON conversations.id = messages.conversation_id
    WHERE (
      (? = 'contact' AND conversations.kind = 'private' AND conversations.contact_id = ?)
      OR (
        ? = 'group'
        AND conversations.kind = 'task'
        AND conversations.group_id = ?
        AND (
          ? IS NULL
          OR EXISTS (
            SELECT 1 FROM task_members
            WHERE task_members.task_id = conversations.task_id
              AND task_members.contact_id = ?
          )
        )
      )
    )
    ORDER BY messages.created_at DESC, messages.id DESC
    LIMIT 1
  `);

  const results = [...resultGroups.values()].map((group): SearchResult => {
    const contextualMessage = group.previewMessage
      ? undefined
      : findLatestMessage.get(
        group.ownerType,
        group.ownerId,
        group.ownerType,
        group.ownerId,
        scopedContactId,
        scopedContactId,
      ) as { messageId: string; content: string; createdAt: string } | undefined;
    const message = group.previewMessage
      ? {
        messageId: group.previewMessage.messageId!,
        content: group.previewMessage.content,
        createdAt: group.previewMessage.createdAt,
      }
      : contextualMessage;
    const location = message
      ? `#message-${encodeURIComponent(message.messageId)}`
      : "";
    return {
      ownerType: group.ownerType,
      ownerId: group.ownerId,
      taskId: group.taskId,
      title: group.title || group.ownerId,
      preview: message ? createSearchPreview(message.content, query) : "",
      messageId: message?.messageId ?? null,
      matchedAt: group.matchedAt ?? message?.createdAt ?? null,
      matchingMessageCount: group.messageMatches.length,
      href: group.ownerType === "contact"
        ? `/contacts/${encodeURIComponent(group.ownerId)}${location}`
        : `/groups/${encodeURIComponent(group.ownerId)}${location}`,
    };
  });

  return results
    .sort((left, right) =>
      right.matchingMessageCount - left.matchingMessageCount
      || (right.matchedAt ?? "").localeCompare(left.matchedAt ?? "")
      || resultGroups.get(`${right.ownerType}:${right.ownerId}`)!.exactTermWeight
        - resultGroups.get(`${left.ownerType}:${left.ownerId}`)!.exactTermWeight
      || left.title.localeCompare(right.title)
      || left.ownerId.localeCompare(right.ownerId))
    .slice(0, normalizedLimit);
}
