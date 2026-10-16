import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AppRuntimeLifecycle } from "../app-runtime.ts";
import type { DatabaseLifecycle } from "../db/client.ts";
import { createGroupTaskRepository } from "../db/repositories/group-task-repository.ts";
import { createRunRepository } from "../db/repositories/run-repository.ts";
import { createSessionRepository } from "../db/repositories/session-repository.ts";
import { createEventRepository, type AppEvent } from "../db/repositories/event-repository.ts";
import { createMessageRepository } from "../db/repositories/message-repository.ts";
import { createWorkItemRepository } from "../db/repositories/work-item-repository.ts";
import type { Run } from "../domain/types.ts";
import { createContactSession, setTaskSessionRunContext } from "../pi/session-factory.ts";
import { createPiEventBridge } from "../pi/pi-event-bridge.ts";
import { createTraceExtension } from "../pi/trace-extension.ts";
import { setWorkItemScheduler } from "./work-scheduler.ts";

type TaskSessionFactory = (
  contactId: string,
  options: {
    sessionKind: "task";
    taskId: string;
    workItemId: string;
    runId: string;
    handoffDepth: number;
  },
) => Promise<AgentSession>;

interface WorkQueueOptions {
  db: Database.Database;
  createContactSession?: TaskSessionFactory;
  idFactory?: () => string;
  now?: () => string;
  bindRunContext?: typeof setTaskSessionRunContext;
}

type TraceableEvent = Pick<AppEvent, "id" | "type" | "payload">;

function assistantInstruction(
  description: string,
  item: { title: string; handoffInstruction?: string | null; expectedOutput?: string | null },
): string {
  return [
    "Task instructions:",
    description,
    "",
    "Assigned work item:",
    item.handoffInstruction ?? item.title,
    ...(item.expectedOutput ? ["", "Expected output:", item.expectedOutput] : []),
  ].join("\n");
}

export function createWorkQueue(options: WorkQueueOptions) {
  const db = options.db;
  const workItems = createWorkItemRepository(db);
  const runs = createRunRepository(db);
  const tasks = createGroupTaskRepository(db);
  const sessions = createSessionRepository(db);
  const messages = createMessageRepository(db);
  const eventRepository = createEventRepository(db);
  const trace = createTraceExtension(db);
  const openSession = options.createContactSession ?? createContactSession;
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const bindRunContext = options.bindRunContext ?? setTaskSessionRunContext;
  const queuedIds: string[] = [];
  const queuedSet = new Set<string>();
  const activeRuns = new Map<string, Promise<Run>>();
  let started = false;
  let stopped = false;
  let drainPromise: Promise<void> | undefined;

  async function persistEvent(
    run: Run,
    scope: { id: string; contactId: string; taskId: string; kind: "task"; piSessionId: string } | undefined,
    type: string,
    payload: Record<string, unknown>,
    sequence: number,
  ): Promise<AppEvent> {
    const event = eventRepository.appendEvent({
      id: idFactory(),
      entityType: "run",
      entityId: run.id,
      type,
      payload: {
        ...payload,
        eventSequence: sequence,
        runId: run.id,
        workItemId: run.workItemId,
        taskId: run.taskId,
        contactId: run.contactId,
        ...(scope ? { piSessionId: scope.piSessionId } : {}),
      },
      idempotencyKey: `${run.id}:${sequence}:${type}`,
      createdAt: now(),
    });
    if (scope) {
      await trace.recordAchatEvent(
        scope,
        event.type,
        { eventId: event.id, ...(event.payload as Record<string, unknown>) },
      );
    }
    return event;
  }

  async function recordAchatEventIfMissing(
    scope: NonNullable<Parameters<typeof persistEvent>[1]>,
    event: TraceableEvent,
  ): Promise<void> {
    const alreadyRecorded = db.prepare(`
      SELECT 1 FROM trace_records
      WHERE mapping_id = ? AND type = 'achat_event'
        AND json_extract(payload_json, '$.payload.eventId') = ?
      LIMIT 1
    `).get(scope.id, event.id);
    if (alreadyRecorded) return;
    await trace.recordAchatEvent(
      scope,
      event.type,
      { eventId: event.id, ...(event.payload as Record<string, unknown>) },
    );
  }

  async function recordSourceMessageEvent(
    scope: NonNullable<Parameters<typeof persistEvent>[1]>,
    taskId: string,
    messageId: string | null,
  ): Promise<void> {
    if (!messageId) return;
    const eventRows = db.prepare(`
      SELECT id, type, payload_json AS payloadJson
      FROM events
      WHERE entity_type = 'task' AND entity_id = ?
        AND json_extract(payload_json, '$.messageId') = ?
      ORDER BY created_at, id
    `).all(taskId, messageId) as Array<{ id: string; type: string; payloadJson: string }>;
    const row = eventRows[0];
    if (row) {
      await recordAchatEventIfMissing(scope, {
        id: row.id,
        type: row.type,
        payload: JSON.parse(row.payloadJson) as unknown,
      });
    }
  }

  async function runTaskWorkItem(workItemId: string): Promise<Run> {
    const active = activeRuns.get(workItemId);
    if (active) return active;
    const promise = executeWorkItem(workItemId);
    activeRuns.set(workItemId, promise);
    try {
      return await promise;
    } finally {
      activeRuns.delete(workItemId);
    }
  }

  async function executeWorkItem(workItemId: string): Promise<Run> {
    const workItem = workItems.getWorkItem(workItemId);
    if (!workItem) throw new Error(`Work item not found: ${workItemId}`);
    const task = tasks.getTask(workItem.taskId);
    if (!task) throw new Error(`Task not found: ${workItem.taskId}`);
    if (!task.description.trim()) {
      throw new Error("Task description is required before work can start");
    }
    if (workItem.status !== "pending") {
      throw new Error(`Work item is not pending: ${workItem.id}`);
    }
    if (!tasks.listTaskMembers(task.id).includes(workItem.contactId)) {
      throw new Error(`Contact ${workItem.contactId} is not a member of task ${task.id}`);
    }
    const itemInstructions = db.prepare(`
      SELECT instruction AS handoffInstruction, expected_output AS expectedOutput
      FROM handoffs WHERE work_item_id = ?
    `).get(workItem.id) as { handoffInstruction: string; expectedOutput: string | null } | undefined;
    const attempt = runs.listRunsForWorkItem(workItem.id).length + 1;
    const startRun = db.transaction(() => {
      const created = runs.createRun({
        id: idFactory(),
        taskId: task.id,
        workItemId: workItem.id,
        contactId: workItem.contactId,
        attempt,
        status: "running",
        startedAt: now(),
      });
      workItems.updateWorkItemStatus(workItem.id, "running", created.startedAt);
      return created;
    });
    const run = startRun();
    let mapping = sessions.getSessionMappingForContact(workItem.contactId, task.id);
    let scope = mapping
      ? {
          id: mapping.id,
          contactId: mapping.contactId,
          taskId: task.id,
          kind: "task" as const,
          piSessionId: mapping.piSessionId,
        }
      : undefined;
    let startedEvent: AppEvent | undefined;
    let bridge: ReturnType<typeof createPiEventBridge> | undefined;
    let session: AgentSession | undefined;
    try {
      startedEvent = await persistEvent(run, scope, "run.started", {
        attempt,
        handoffDepth: workItem.handoffDepth,
      }, 0);
      session = await openSession(workItem.contactId, {
        sessionKind: "task",
        taskId: task.id,
        workItemId: workItem.id,
        runId: run.id,
        handoffDepth: workItem.handoffDepth,
      });
      mapping = sessions.getSessionMappingForContact(workItem.contactId, task.id);
      if (!mapping) {
        throw new Error(`Task session mapping missing for contact ${workItem.contactId}`);
      }
      scope = {
        id: mapping.id,
        contactId: mapping.contactId,
        taskId: task.id,
        kind: "task",
        piSessionId: mapping.piSessionId,
      };
      if (startedEvent) await recordAchatEventIfMissing(scope, startedEvent);
      await recordSourceMessageEvent(scope, task.id, workItem.sourceMessageId);
      const sourceAgent = db.prepare(
        "SELECT agent_id AS agentId FROM contacts WHERE id = ?",
      ).get(workItem.contactId) as { agentId: string } | undefined;
      if (!sourceAgent) throw new Error(`Contact not found: ${workItem.contactId}`);
      bindRunContext(mapping.piSessionId, {
        sourceAgentId: sourceAgent.agentId,
        sourceContactId: workItem.contactId,
        taskId: task.id,
        sourcePiSessionId: mapping.piSessionId,
        sourceRunId: run.id,
        handoffDepth: workItem.handoffDepth,
      });
      const conversation = db.prepare(`
        SELECT id FROM conversations WHERE kind = 'task' AND task_id = ?
        ORDER BY created_at, id LIMIT 1
      `).get(task.id) as { id: string } | undefined;
      bridge = createPiEventBridge({
        db,
        run,
        scope,
        idFactory,
        now,
        onFinalMessage: async (text, eventId) => {
          if (!conversation || !text.trim()) return;
          messages.appendMessage({
            id: idFactory(),
            conversationId: conversation.id,
            role: "assistant",
            content: text,
            metadata: {
              eventId,
              runId: run.id,
              workItemId: workItem.id,
              contactId: workItem.contactId,
            },
            createdAt: now(),
          });
        },
      });
      bridge.subscribe(session);
      await session.prompt(assistantInstruction(task.description, {
        title: workItem.title,
        handoffInstruction: itemInstructions?.handoffInstruction,
        expectedOutput: itemInstructions?.expectedOutput,
      }));
      await bridge.flush();
      if (bridge.isAborted()) {
        const interrupted = runs.updateRunStatus(run.id, "interrupted", now());
        workItems.updateWorkItemStatus(workItem.id, "interrupted", now());
        await persistEvent(interrupted, scope, "run.interrupted", {
          status: interrupted.status,
          completedAt: interrupted.completedAt,
        }, 1_000_000);
        return interrupted;
      }
      const completedAt = now();
      const completed = runs.completeRun(run.id, completedAt);
      workItems.updateWorkItemStatus(workItem.id, "completed", completedAt);
      await persistEvent(completed, scope, "run.completed", { completedAt }, 1_000_000);
      return completed;
    } catch (error) {
      await bridge?.flush();
      const message = error instanceof Error ? error.message : String(error);
      const alreadyRecorded = db.prepare(`
        SELECT 1 FROM events WHERE entity_type = 'run' AND entity_id = ?
          AND type IN ('run.error', 'run.aborted') LIMIT 1
      `).get(run.id);
      const failedAt = now();
      const failed = runs.updateRunStatus(run.id, "failed", failedAt);
      workItems.updateWorkItemStatus(workItem.id, "failed", failedAt);
      if (!alreadyRecorded) {
        await persistEvent(failed, scope, "run.error", { message }, 999_999);
      }
      await persistEvent(failed, scope, "run.failed", {
        message,
        completedAt: failed.completedAt,
      }, 1_000_000);
      throw error;
    } finally {
      if (mapping) bindRunContext(mapping.piSessionId, undefined);
    }
  }

  async function drain(): Promise<void> {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      while (started && queuedIds.length) {
        const workItemId = queuedIds.shift()!;
        queuedSet.delete(workItemId);
        try {
          await runTaskWorkItem(workItemId);
        } catch {
          // The failed run and work item are persisted by runTaskWorkItem.
        }
      }
    })().finally(() => {
      drainPromise = undefined;
      if (started && queuedIds.length) void drain();
    });
    return drainPromise;
  }

  return {
    runTaskWorkItem,
    async enqueueWorkItem(workItemId: string): Promise<void> {
      if (!started || stopped) throw new Error("Task work queue is not running");
      if (queuedSet.has(workItemId) || activeRuns.has(workItemId)) return;
      queuedSet.add(workItemId);
      queuedIds.push(workItemId);
      void drain();
    },
    async start(): Promise<void> {
      if (started && !stopped) return;
      stopped = false;
      started = true;
    },
    async stop(): Promise<void> {
      if (!started || stopped) return;
      stopped = true;
      started = false;
      await drainPromise;
      queuedIds.splice(0);
      queuedSet.clear();
    },
    async drain(): Promise<void> {
      await drain();
    },
  };
}

export interface WorkQueueLifecycle extends AppRuntimeLifecycle {
  getWorkQueue(): ReturnType<typeof createWorkQueue>;
}

export function createWorkQueueLifecycle(options: {
  databaseLifecycle: DatabaseLifecycle;
  createQueue?: (db: Database.Database) => ReturnType<typeof createWorkQueue>;
}): WorkQueueLifecycle {
  let queue: ReturnType<typeof createWorkQueue> | undefined;
  return {
    async start() {
      if (queue) return;
      const activeQueue = (options.createQueue ?? ((db) => createWorkQueue({ db })))(
        options.databaseLifecycle.getDatabase(),
      );
      await activeQueue.start();
      queue = activeQueue;
      setWorkItemScheduler((workItemId) => activeQueue.enqueueWorkItem(workItemId));
    },
    async stop() {
      if (!queue) return;
      setWorkItemScheduler(undefined);
      const activeQueue = queue;
      queue = undefined;
      await activeQueue.stop();
    },
    getWorkQueue() {
      if (!queue) throw new Error("Work queue lifecycle has not started");
      return queue;
    },
  };
}
