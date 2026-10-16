import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Message } from "../domain/types.ts";
import { createAgentRepository } from "../db/repositories/agent-repository.ts";
import { createEventRepository } from "../db/repositories/event-repository.ts";
import { createMessageRepository } from "../db/repositories/message-repository.ts";
import { createSessionRepository } from "../db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../db/repositories/work-item-repository.ts";
import { createTraceExtension } from "../pi/trace-extension.ts";

export const MAX_HANDOFF_DEPTH = 8;

export interface HandoffContext {
  sourceAgentId: string;
  sourceContactId: string;
  taskId: string;
  sourcePiSessionId: string;
  sourceRunId: string;
  handoffDepth: number;
}

export interface EnqueueHandoffInput {
  recipientAgentId: string;
  instruction: string;
  expectedOutput?: string;
  toolCallId: string;
}

export interface HandoffServiceOptions {
  idFactory?: () => string;
  now?: () => string;
  enqueueWorkItem?: (workItemId: string) => void | Promise<void>;
}

type HandoffResult =
  | { handoffId: string; status: "queued" }
  | { status: "awaiting_user"; reason: "handoff_depth_limit"; eventId: string };

function parseContext(context: HandoffContext): HandoffContext {
  if (
    !context.sourceAgentId
    || !context.sourceContactId
    || !context.taskId
    || !context.sourcePiSessionId
    || !context.sourceRunId
    || !Number.isInteger(context.handoffDepth)
    || context.handoffDepth < 0
  ) {
    throw new Error("Handoff context is incomplete or invalid");
  }
  return context;
}

async function recordTraceForMapping(
  db: Database.Database,
  mappingId: string | undefined,
  contactId: string,
  taskId: string,
  piSessionId: string,
  event: { id: string; type: string; payload: unknown },
): Promise<void> {
  if (!mappingId) return;
  const mapping = createSessionRepository(db).getSessionMappingById(mappingId);
  if (!mapping) return;
  await createTraceExtension(db).recordAchatEvent(
    {
      id: mapping.id,
      contactId,
      taskId,
      kind: mapping.kind,
      piSessionId,
    },
    event.type,
    { eventId: event.id, ...event.payload as Record<string, unknown> },
  );
}

export function createHandoffService(
  db: Database.Database,
  options: HandoffServiceOptions = {},
) {
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const contacts = createAgentRepository(db);
  const messages = createMessageRepository(db);
  const workItems = createWorkItemRepository(db);
  const sessions = createSessionRepository(db);
  const events = createEventRepository(db);

  return {
    async enqueueHandoff(
      rawContext: HandoffContext,
      input: EnqueueHandoffInput,
    ): Promise<HandoffResult> {
      const context = parseContext(rawContext);
      const instruction = input.instruction.trim();
      const expectedOutput = input.expectedOutput?.trim() || undefined;
      if (!instruction) throw new Error("Handoff instruction is required");
      if (!input.toolCallId) throw new Error("Handoff tool call ID is required");
      if (!input.recipientAgentId) throw new Error("Handoff recipient is required");

      const sourceMapping = sessions.getSessionMappingByContactAndPiSessionId(
        context.sourceContactId,
        context.sourcePiSessionId,
      );
      if (
        !sourceMapping
        || sourceMapping.kind !== "task"
        || sourceMapping.taskId !== context.taskId
        || contacts.getContactAgentId(context.sourceContactId) !== context.sourceAgentId
      ) {
        throw new Error("Handoff source does not match a bound task session");
      }
      const sourceRun = db.prepare(`
        SELECT id FROM runs
        WHERE id = ? AND task_id = ? AND contact_id = ?
      `).get(context.sourceRunId, context.taskId, context.sourceContactId);
      if (!sourceRun) throw new Error("Handoff source run does not match its task and contact");

      const transaction = db.transaction(() => {
        const duplicateRow = db.prepare(`
          SELECT id AS handoffId, to_agent_id AS recipientAgentId,
                 instruction, expected_output AS expectedOutput
          FROM handoffs
          WHERE source_pi_session_id = ? AND tool_call_id = ?
        `).get(context.sourcePiSessionId, input.toolCallId) as {
          handoffId: string;
          recipientAgentId: string | null;
          instruction: string;
          expectedOutput: string | null;
        } | undefined;
        if (duplicateRow) {
          if (
            duplicateRow.recipientAgentId !== input.recipientAgentId
            || duplicateRow.instruction !== instruction
            || duplicateRow.expectedOutput !== (expectedOutput ?? null)
          ) {
            throw new Error("Handoff tool-call id conflicts with an existing request");
          }
          return { kind: "duplicate" as const, handoffId: duplicateRow.handoffId };
        }

        const recipient = db.prepare(`
          SELECT contacts.id AS contactId, contacts.name, contacts.agent_id AS agentId
          FROM contacts
          JOIN task_members ON task_members.contact_id = contacts.id
          WHERE contacts.agent_id = ? AND task_members.task_id = ?
        `).get(input.recipientAgentId, context.taskId) as {
          contactId: string;
          name: string;
          agentId: string;
        } | undefined;
        if (!recipient) throw new Error("Handoff recipient is not a member of this task");
        if (recipient.contactId === context.sourceContactId) {
          throw new Error("Handoff recipient must be another task member");
        }

        if (context.handoffDepth >= MAX_HANDOFF_DEPTH) {
          const eventId = idFactory();
          const event = events.appendEvent({
            id: eventId,
            entityType: "task",
            entityId: context.taskId,
            type: "awaiting_user",
            payload: {
              reason: "handoff_depth_limit",
              taskId: context.taskId,
              runId: context.sourceRunId,
              sourceContactId: context.sourceContactId,
              sourcePiSessionId: context.sourcePiSessionId,
              handoffDepth: context.handoffDepth,
            },
            idempotencyKey: `handoff-depth:${context.sourcePiSessionId}:${input.toolCallId}`,
            createdAt: now(),
          });
          return { kind: "awaiting" as const, event, eventId: event.id };
        }

        const handoffId = idFactory();
        const messageId = idFactory();
        const workItemId = idFactory();
        const timestamp = now();
        const taskConversation = db.prepare(`
          SELECT id FROM conversations WHERE kind = 'task' AND task_id = ?
          ORDER BY created_at, id LIMIT 1
        `).get(context.taskId) as { id: string } | undefined;
        if (!taskConversation) throw new Error("Task conversation not found");
        const sourceContact = contacts.getContact(context.sourceContactId);
        const recipientContact = contacts.getContact(recipient.contactId);
        if (!sourceContact || !recipientContact) throw new Error("Handoff contact not found");
        const content = `@${sourceContact.name} → @${recipientContact.name}: ${instruction}${
          expectedOutput ? `\nExpected output: ${expectedOutput}` : ""
        }`;
        const message: Message = messages.appendMessage({
          id: messageId,
          conversationId: taskConversation.id,
          role: "handoff",
          content,
          metadata: {
            handoffId,
            fromContactId: context.sourceContactId,
            toContactId: recipient.contactId,
            fromAgentId: context.sourceAgentId,
            toAgentId: recipient.agentId,
            sourceRunId: context.sourceRunId,
          },
          createdAt: timestamp,
        });
        const workItem = workItems.createWorkItem({
          id: workItemId,
          taskId: context.taskId,
          contactId: recipient.contactId,
          title: instruction,
          status: "pending",
          handoffDepth: context.handoffDepth + 1,
          sourceMessageId: message.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        db.prepare(`
          INSERT INTO handoffs (
            id, task_id, from_contact_id, to_contact_id, from_run_id, summary,
            status, created_at, from_agent_id, to_agent_id, source_pi_session_id,
            tool_call_id, instruction, expected_output, handoff_depth, message_id,
            work_item_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          handoffId,
          context.taskId,
          context.sourceContactId,
          recipient.contactId,
          context.sourceRunId,
          instruction,
          timestamp,
          context.sourceAgentId,
          recipient.agentId,
          context.sourcePiSessionId,
          input.toolCallId,
          instruction,
          expectedOutput ?? null,
          context.handoffDepth + 1,
          message.id,
          workItem.id,
        );
        const event = events.appendEvent({
          id: idFactory(),
          entityType: "task",
          entityId: context.taskId,
          type: "handoff.queued",
          payload: {
            handoffId,
            runId: context.sourceRunId,
            workItemId: workItem.id,
            messageId: message.id,
            sourceContactId: context.sourceContactId,
            recipientContactId: recipient.contactId,
            sourcePiSessionId: context.sourcePiSessionId,
            handoffDepth: workItem.handoffDepth,
          },
          idempotencyKey: `handoff:${context.sourcePiSessionId}:${input.toolCallId}`,
          createdAt: timestamp,
        });
        return { kind: "queued" as const, handoffId, workItemId, event };
      });

      const result = transaction();
      if (result.kind === "awaiting") {
        await recordTraceForMapping(
          db,
          sourceMapping.id,
          context.sourceContactId,
          context.taskId,
          context.sourcePiSessionId,
          result.event,
        );
        return {
          status: "awaiting_user",
          reason: "handoff_depth_limit",
          eventId: result.eventId,
        };
      }
      if (result.kind === "duplicate") return { handoffId: result.handoffId, status: "queued" };
      await recordTraceForMapping(
        db,
        sourceMapping.id,
        context.sourceContactId,
        context.taskId,
        context.sourcePiSessionId,
        result.event,
      );
      await options.enqueueWorkItem?.(result.workItemId);
      return { handoffId: result.handoffId, status: "queued" };
    },
  };
}

export interface GroupMessageServiceOptions {
  idFactory?: () => string;
  now?: () => string;
  enqueueWorkItem?: (workItemId: string) => void | Promise<void>;
}

export function createGroupMessageService(
  db: Database.Database,
  options: GroupMessageServiceOptions = {},
) {
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const messages = createMessageRepository(db);
  const events = createEventRepository(db);
  const workItems = createWorkItemRepository(db);

  return {
    async sendGroupMessage(
      groupId: string,
      input: { content: string },
    ): Promise<{ message: Message; routedTo: string[] }> {
      const content = input.content.trim();
      if (!content) throw new Error("Group message cannot be empty");
      const context = db.prepare(`
        SELECT tasks.id AS taskId, tasks.description
        FROM tasks WHERE tasks.group_id = ?
      `).get(groupId) as { taskId: string; description: string } | undefined;
      if (!context) throw new Error(`Group not found: ${groupId}`);
      if (!context.description.trim()) {
        throw new Error("Task description is required before work can start");
      }
      const members = db.prepare(`
        SELECT contacts.id, contacts.name
        FROM task_members
        JOIN contacts ON contacts.id = task_members.contact_id
        WHERE task_members.task_id = ?
        ORDER BY contacts.id
      `).all(context.taskId) as Array<{ id: string; name: string }>;
      const allMentioned = /(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(content);
      const recipients = allMentioned
        ? members
        : members.filter((member) =>
            new RegExp(`(^|[^\\p{L}\\p{N}_])@(?:${escapeRegExp(member.name)}|${escapeRegExp(member.id)})(?![\\p{L}\\p{N}_])`, "iu")
              .test(content));
      const uniqueRecipients = [...new Map(recipients.map((member) => [member.id, member])).values()];
      const timestamp = now();
      const messageId = idFactory();

      const routedTo = uniqueRecipients.map((member) => member.id);
      const committed = db.transaction(() => {
        let conversation = db.prepare(`
          SELECT id FROM conversations WHERE kind = 'task' AND task_id = ?
          ORDER BY created_at, id LIMIT 1
        `).get(context.taskId) as { id: string } | undefined;
        if (!conversation) {
          conversation = {
            id: messages.createConversation({
              id: idFactory(),
              groupId,
              taskId: context.taskId,
              contactId: null,
              kind: "task",
              createdAt: timestamp,
            }).id,
          };
        }
        const message = messages.appendMessage({
          id: messageId,
          conversationId: conversation.id,
          role: "user",
          content,
          metadata: { routedTo },
          createdAt: timestamp,
        });
        const itemIds: string[] = [];
        for (const recipient of uniqueRecipients) {
          const workItem = workItems.createWorkItem({
            id: idFactory(),
            taskId: context.taskId,
            contactId: recipient.id,
            title: content,
            status: "pending",
            handoffDepth: 0,
            sourceMessageId: message.id,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          itemIds.push(workItem.id);
        }
        const event = events.appendEvent({
          id: idFactory(),
          entityType: "task",
          entityId: context.taskId,
          type: "group.message",
          payload: {
            messageId: message.id,
            groupId,
            taskId: context.taskId,
            routedTo,
            workItemIds: itemIds,
          },
          idempotencyKey: `group-message:${message.id}`,
          createdAt: timestamp,
        });
        return { message, itemIds, event };
      })();

      const sessionRepository = createSessionRepository(db);
      const trace = createTraceExtension(db);
      for (const recipientId of routedTo) {
        const mapping = sessionRepository.getSessionMappingForContact(recipientId, context.taskId);
        if (!mapping) continue;
        await trace.recordAchatEvent(
          {
            id: mapping.id,
            contactId: mapping.contactId,
            taskId: mapping.taskId,
            kind: mapping.kind,
            piSessionId: mapping.piSessionId,
          },
          committed.event.type,
          { eventId: committed.event.id, ...(committed.event.payload as object) },
        );
      }
      for (const workItemId of committed.itemIds) {
        await options.enqueueWorkItem?.(workItemId);
      }
      return { message: committed.message, routedTo };
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
