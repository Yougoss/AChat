import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppRuntimeLifecycle } from "../app-runtime.ts";
import { createEventRepository, type AppEvent } from "../db/repositories/event-repository.ts";
import { createGroupTaskRepository } from "../db/repositories/group-task-repository.ts";
import { createRunRepository } from "../db/repositories/run-repository.ts";
import { createSessionRepository } from "../db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../db/repositories/work-item-repository.ts";
import type { Run } from "../domain/types.ts";
import { createTraceExtension } from "../pi/trace-extension.ts";

export interface RecoverySummary {
  interruptedRuns: number;
  associatedSessions: number;
}

interface RecoveryOptions {
  runWorkItem?: (workItemId: string) => Promise<Run>;
  hasSessionFile?: (sessionFile: string) => boolean;
  idFactory?: () => string;
  now?: () => string;
}

function eventScope(mapping: NonNullable<ReturnType<
  ReturnType<typeof createSessionRepository>["getSessionMappingForContact"]
>>): {
  id: string;
  contactId: string;
  taskId: string | null;
  kind: "private" | "task";
  piSessionId: string;
} {
  return {
    id: mapping.id,
    contactId: mapping.contactId,
    taskId: mapping.taskId,
    kind: mapping.kind,
    piSessionId: mapping.piSessionId,
  };
}

export function createRecoveryService(db: Database.Database, options: RecoveryOptions = {}) {
  const runs = createRunRepository(db);
  const workItems = createWorkItemRepository(db);
  const tasks = createGroupTaskRepository(db);
  const sessions = createSessionRepository(db);
  const events = createEventRepository(db);
  const trace = createTraceExtension(db);
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  function isEventTraced(mappingId: string, eventId: string): boolean {
    return Boolean(db.prepare(`
      SELECT 1 FROM trace_records
      WHERE mapping_id = ? AND type = 'achat_event'
        AND json_extract(payload_json, '$.payload.eventId') = ?
      LIMIT 1
    `).get(mappingId, eventId));
  }

  async function associateEvent(
    mapping: NonNullable<ReturnType<typeof sessions.getSessionMappingForContact>>,
    event: AppEvent,
  ): Promise<void> {
    if (isEventTraced(mapping.id, event.id)) return;
    await trace.recordAchatEvent(eventScope(mapping), event.type, {
      eventId: event.id,
      ...(event.payload as Record<string, unknown>),
    });
  }

  function interruptedEvent(run: Run, piSessionId: string | undefined): AppEvent {
    const existing = events.listEventsForEntity("run", run.id)
      .find((event) => event.type === "run.interrupted");
    if (existing) return existing;
    const completedAt = run.completedAt ?? now();
    return events.appendEvent({
      id: idFactory(),
      entityType: "run",
      entityId: run.id,
      type: "run.interrupted",
      payload: {
        runId: run.id,
        taskId: run.taskId,
        workItemId: run.workItemId,
        contactId: run.contactId,
        ...(piSessionId ? { piSessionId } : {}),
        status: "interrupted",
        completedAt,
        reason: "process_restart",
      },
      idempotencyKey: `${run.id}:recovery:interrupted`,
      createdAt: completedAt,
    });
  }

  function ensureWorkItemInterrupted(run: Run): void {
    const workItem = workItems.getWorkItem(run.workItemId);
    if (!workItem || workItem.status !== "running") return;
    const hasCompletedRun = db.prepare(`
      SELECT 1 FROM runs WHERE work_item_id = ? AND status = 'completed' LIMIT 1
    `).get(workItem.id);
    workItems.updateWorkItemStatus(
      workItem.id,
      hasCompletedRun ? "completed" : "interrupted",
      run.completedAt ?? now(),
    );
  }

  return {
    async reconcileInterruptedWork(): Promise<RecoverySummary> {
      const runningRows = db.prepare(`
        SELECT id, task_id AS taskId, work_item_id AS workItemId,
               contact_id AS contactId, attempt, status,
               started_at AS startedAt, completed_at AS completedAt
        FROM runs WHERE status = 'running'
        ORDER BY started_at, id
      `).all() as Run[];
      let interruptedRuns = 0;
      const associatedMappingIds = new Set<string>();
      const candidates = [
        ...runningRows.map((run) => ({ run, wasRunning: true })),
        ...db.prepare(`
          SELECT id, task_id AS taskId, work_item_id AS workItemId,
                 contact_id AS contactId, attempt, status,
                 started_at AS startedAt, completed_at AS completedAt
          FROM runs WHERE status = 'interrupted'
          ORDER BY started_at, id
        `).all().map((run) => ({ run: run as Run, wasRunning: false })),
      ];

      for (const candidate of candidates) {
        const run = candidate.wasRunning
          ? db.transaction(() => {
              const interrupted = runs.updateRunStatus(candidate.run.id, "interrupted", now());
              ensureWorkItemInterrupted(interrupted);
              return interrupted;
            })()
          : candidate.run;
        if (!candidate.wasRunning) ensureWorkItemInterrupted(run);
        if (candidate.wasRunning) interruptedRuns += 1;
        const mapping = sessions.getSessionMappingForContact(run.contactId, run.taskId);
        const event = interruptedEvent(run, mapping?.piSessionId);
        if (mapping) {
          await associateEvent(mapping, event);
          associatedMappingIds.add(mapping.id);
        }
      }

      return { interruptedRuns, associatedSessions: associatedMappingIds.size };
    },

    async retryInterruptedWork(taskId: string, workItemIds?: string[]): Promise<Run[]> {
      if (!tasks.getTask(taskId)) throw new Error(`Task not found: ${taskId}`);
      if (workItemIds !== undefined && !Array.isArray(workItemIds)) {
        throw new Error("workItemIds must be an array of work item IDs");
      }

      const requestedIds = workItemIds === undefined
        ? workItems.listWorkItemsForTask(taskId)
            .filter((workItem) => {
              const history = runs.listRunsForWorkItem(workItem.id);
              return workItem.status === "interrupted"
                && history.at(-1)?.status === "interrupted"
                && !history.some((run) => run.status === "completed")
                && isMappedSessionAvailable(workItem.contactId, taskId);
            })
            .map((workItem) => workItem.id)
        : [...new Set(workItemIds)];

      const eligible: Array<{ id: string; contactId: string }> = [];
      for (const id of requestedIds) {
        if (typeof id !== "string" || !id) {
          throw new Error("Each workItemId must be a non-empty string");
        }
        const workItem = workItems.getWorkItem(id);
        if (!workItem) throw new Error(`Work item not found: ${id}`);
        if (workItem.taskId !== taskId) {
          throw new Error(`Work item ${id} does not belong to task ${taskId}`);
        }
        const history = runs.listRunsForWorkItem(id);
        if (workItem.status === "completed" || history.some((run) => run.status === "completed")) {
          throw new Error(`Completed work item cannot be retried: ${id}`);
        }
        const latest = history.at(-1);
        if (workItem.status !== "interrupted" || latest?.status !== "interrupted") {
          throw new Error(`Work item is not eligible for retry: ${id}`);
        }
        const mapping = sessions.getSessionMappingForContact(workItem.contactId, taskId);
        if (!mapping) {
          throw new Error(`No mapped Pi session exists for work item ${id}`);
        }
        if (options.hasSessionFile && !options.hasSessionFile(mapping.sessionFile)) {
          throw new Error(`Mapped Pi session file is missing for work item ${id}`);
        }
        eligible.push({ id, contactId: workItem.contactId });
      }

      if (!eligible.length) return [];
      if (!options.runWorkItem) throw new Error("Task work queue is not available for retry");

      const retriedRuns: Run[] = [];
      for (const { id } of eligible) {
        const reset = db.transaction(() => db.prepare(`
          UPDATE work_items
          SET status = 'pending', updated_at = ?
          WHERE id = ? AND task_id = ? AND status = 'interrupted'
            AND NOT EXISTS (
              SELECT 1 FROM runs
              WHERE runs.work_item_id = work_items.id AND runs.status = 'completed'
            )
        `).run(now(), id, taskId).changes === 1);
        if (!reset()) throw new Error(`Work item is no longer eligible for retry: ${id}`);
        try {
          retriedRuns.push(await options.runWorkItem(id));
        } catch (error) {
          const item = workItems.getWorkItem(id);
          if (item?.status === "pending") {
            workItems.updateWorkItemStatus(id, "interrupted", now());
          }
          throw error;
        }
      }
      return retriedRuns;
    },
  };

  function isMappedSessionAvailable(contactId: string, taskId: string): boolean {
    const mapping = sessions.getSessionMappingForContact(contactId, taskId);
    return Boolean(mapping && (
      !options.hasSessionFile || options.hasSessionFile(mapping.sessionFile)
    ));
  }
}

export interface RecoveryLifecycle extends AppRuntimeLifecycle {
  getRecoveryService(): ReturnType<typeof createRecoveryService>;
}

export function createRecoveryLifecycle(options: {
  getDatabase(): Database.Database;
  runWorkItem(workItemId: string): Promise<Run>;
  hasSessionFile?: (sessionFile: string) => boolean;
}): RecoveryLifecycle {
  let recovery: ReturnType<typeof createRecoveryService> | undefined;
  return {
    async start() {
      if (recovery) return;
      const service = createRecoveryService(options.getDatabase(), {
        runWorkItem: options.runWorkItem,
        hasSessionFile: options.hasSessionFile,
      });
      try {
        await service.reconcileInterruptedWork();
        recovery = service;
      } catch (error) {
        recovery = undefined;
        throw error;
      }
    },
    async stop() {
      recovery = undefined;
    },
    getRecoveryService() {
      if (!recovery) throw new Error("Recovery lifecycle has not started");
      return recovery;
    },
  };
}
