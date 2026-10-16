import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "../pi/task-execution-fixtures.mjs";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createAttentionRepository } from "../../src/server/db/repositories/attention-repository.ts";
import { createApprovalService } from "../../src/server/services/approval-service.ts";
import { createTaskStatusService } from "../../src/server/services/task-status-service.ts";

const start = "2026-10-16T02:00:00.000Z";

function appendRunEvent(db, id, type, createdAt, payload = {}) {
  return createEventRepository(db).appendEvent({
    id,
    entityType: "run",
    entityId: "developer-run",
    type,
    payload: { runId: "developer-run", taskId: "task-1", ...payload },
    idempotencyKey: id,
    createdAt,
  });
}

test("marks a run stuck at 30 minutes from an unfinished tool start, not before it", (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  appendRunEvent(fixture.db, "tool-start", "tool.started", start, {
    toolCallId: "call-1",
    toolName: "bash",
  });
  let now = "2026-10-16T02:29:59.999Z";
  const status = createTaskStatusService(fixture.db, { now: () => now });

  assert.equal(status.getRunExecutionStatus("developer-run").stuck, "not_stuck");
  now = "2026-10-16T02:30:00.000Z";
  assert.equal(status.getRunExecutionStatus("developer-run").stuck, "stuck");
});

test("does not mark tool approval or input waits stuck and keeps streaming distinct from completion", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  appendRunEvent(fixture.db, "tool-start", "tool.started", start, {
    toolCallId: "call-1",
    toolName: "bash",
  });
  appendRunEvent(fixture.db, "streaming", "text.delta", "2026-10-16T02:29:59.000Z", {
    text: "Still generating",
  });
  fixture.db.prepare(`
    INSERT INTO attention_requests (id, task_id, work_item_id, run_id, kind, status, created_at)
    VALUES ('input-wait', 'task-1', 'developer-work-item', 'developer-run', 'input', 'open', ?)
  `).run(start);
  const status = createTaskStatusService(fixture.db, {
    now: () => "2026-10-16T02:30:00.000Z",
  }).getRunExecutionStatus("developer-run");

  assert.equal(status.runStatus, "running");
  assert.equal(status.stuck, "not_stuck");
  assert.equal(status.lifecycleEvidence, "tool_waiting");
  fixture.db.prepare(`
    UPDATE attention_requests SET status = 'resolved', resolved_at = ?
    WHERE id = 'input-wait'
  `).run("2026-10-16T02:30:00.000Z");
  const approvalService = createApprovalService(fixture.db, { idFactory: () => "approval-wait" });
  const pendingApproval = approvalService.requestToolApproval({
    taskId: fixture.task.id,
    workItemId: fixture.sourceWorkItem.id,
    runId: fixture.sourceRun.id,
    piSessionId: fixture.sourceMapping.piSessionId,
    toolCallId: "approval-tool-call",
  }, { toolName: "bash", input: { command: "wait" } });
  assert.equal(createTaskStatusService(fixture.db, {
    now: () => "2026-10-16T02:30:00.000Z",
  }).getRunExecutionStatus("developer-run").stuck, "not_stuck");
  await approvalService.decideToolApproval("approval-wait", { decision: "deny" });
  await pendingApproval;
});

test("reports unknown when no tool lifecycle evidence exists and does not infer completion from streaming", (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  appendRunEvent(fixture.db, "streaming", "text.delta", start, { text: "Working" });
  const status = createTaskStatusService(fixture.db, {
    now: () => "2026-10-16T04:00:00.000Z",
  }).getRunExecutionStatus("developer-run");

  assert.equal(status.runStatus, "running");
  assert.equal(status.taskStatus, "open");
  assert.equal(status.stuck, "unknown");
  assert.equal(status.lifecycleEvidence, "unknown");
});

test("an end, failure, or cancellation closes the tool lifecycle before the stuck threshold", (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  for (const [suffix, terminalType] of [
    ["end", "tool.completed"],
    ["failure", "tool.failed"],
    ["cancel", "tool.cancelled"],
  ]) {
    appendRunEvent(fixture.db, `start-${suffix}`, "tool.started", start, {
      toolCallId: suffix,
      toolName: "bash",
    });
    appendRunEvent(fixture.db, `close-${suffix}`, terminalType, "2026-10-16T02:01:00.000Z", {
      toolCallId: suffix,
    });
  }
  const status = createTaskStatusService(fixture.db, {
    now: () => "2026-10-16T04:00:00.000Z",
  });

  assert.equal(status.getRunExecutionStatus("developer-run").stuck, "not_stuck");
  assert.equal(createAttentionRepository(fixture.db).listAttentionRequestsForTask("task-1").length, 0);
});
