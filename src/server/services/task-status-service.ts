import type Database from "better-sqlite3";
import { createAttentionRepository } from "../db/repositories/attention-repository.ts";
import { createEventRepository } from "../db/repositories/event-repository.ts";
import { createRunRepository } from "../db/repositories/run-repository.ts";

export type StuckState = "stuck" | "not_stuck" | "unknown";

interface RunEvent {
  id: string;
  cursor: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

function toolCallId(event: RunEvent): string | undefined {
  return typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : undefined;
}

function isTerminalToolEvent(event: RunEvent): boolean {
  return event.type === "tool.failed"
    || event.type === "tool.cancelled"
    || event.type === "tool.completed"
    || (event.type === "tool.completed" && event.payload.isError === true);
}

export function createTaskStatusService(
  db: Database.Database,
  options: { now?: () => string } = {},
) {
  const runs = createRunRepository(db);
  const events = createEventRepository(db);
  const attention = createAttentionRepository(db);
  const now = options.now ?? (() => new Date().toISOString());

  return {
    getRunExecutionStatus(runId: string): {
      runStatus: string;
      taskStatus: string;
      workItemStatus: string;
      stuck: StuckState;
      lifecycleEvidence: "tool_active" | "tool_waiting" | "tool_closed" | "unknown" | "terminal";
    } {
      const run = runs.getRun(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);
      const task = db.prepare(`
        SELECT tasks.status AS taskStatus, work_items.status AS workItemStatus
        FROM tasks
        JOIN work_items ON work_items.task_id = tasks.id
        WHERE tasks.id = ? AND work_items.id = ?
      `).get(run.taskId, run.workItemId) as {
        taskStatus: string;
        workItemStatus: string;
      } | undefined;
      if (!task) throw new Error(`Task or work item not found for run: ${runId}`);

      if (run.status !== "running") {
        return {
          runStatus: run.status,
          taskStatus: task.taskStatus,
          workItemStatus: task.workItemStatus,
          stuck: "not_stuck",
          lifecycleEvidence: "terminal",
        };
      }

      const runEvents = events.listEventsForEntity("run", runId) as RunEvent[];
      const attentionWaiting = attention.listAttentionRequestsForTask(run.taskId)
        .some((request) =>
          request.runId === runId
          && request.status === "open"
          && (request.kind === "approval" || request.kind === "input"));
      if (attentionWaiting) {
        return {
          runStatus: run.status,
          taskStatus: task.taskStatus,
          workItemStatus: task.workItemStatus,
          stuck: "not_stuck",
          lifecycleEvidence: "tool_waiting",
        };
      }

      const starts = runEvents.filter((event) => event.type === "tool.started");
      let hasUnfinishedTool = false;
      for (const start of starts.toReversed()) {
        const id = toolCallId(start);
        if (!id) continue;
        const terminal = runEvents.some((event) =>
          event.cursor > start.cursor
          && toolCallId(event) === id
          && isTerminalToolEvent(event));
        if (terminal) continue;
        hasUnfinishedTool = true;
        const elapsed = Date.parse(now()) - Date.parse(start.createdAt);
        if (Number.isFinite(elapsed) && elapsed >= 30 * 60 * 1000) {
          return {
            runStatus: run.status,
            taskStatus: task.taskStatus,
            workItemStatus: task.workItemStatus,
            stuck: "stuck",
            lifecycleEvidence: "tool_active",
          };
        }
      }
      if (hasUnfinishedTool) {
        return {
          runStatus: run.status,
          taskStatus: task.taskStatus,
          workItemStatus: task.workItemStatus,
          stuck: "not_stuck",
          lifecycleEvidence: "tool_active",
        };
      }

      const hasClosedTool = starts.some((start) => {
        const id = toolCallId(start);
        return id !== undefined && runEvents.some((event) =>
          event.cursor > start.cursor
          && toolCallId(event) === id
          && isTerminalToolEvent(event));
      });
      return {
        runStatus: run.status,
        taskStatus: task.taskStatus,
        workItemStatus: task.workItemStatus,
        stuck: hasClosedTool ? "not_stuck" : "unknown",
        lifecycleEvidence: hasClosedTool ? "tool_closed" : "unknown",
      };
    },
  };
}
