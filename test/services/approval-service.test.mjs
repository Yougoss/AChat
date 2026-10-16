import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "../pi/task-execution-fixtures.mjs";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createApprovalService } from "../../src/server/services/approval-service.ts";
import { createApprovalRepository } from "../../src/server/db/repositories/approval-repository.ts";
import { createAttentionRepository } from "../../src/server/db/repositories/attention-repository.ts";

function context(fixture, overrides = {}) {
  return {
    taskId: fixture.task.id,
    workItemId: fixture.sourceWorkItem.id,
    runId: fixture.sourceRun.id,
    piSessionId: fixture.sourceMapping.piSessionId,
    ...overrides,
  };
}

test("persists and emits the exact approval scope before blocking, then unblocks only after approval", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, {
    idFactory: () => "approval-1",
    now: () => "2026-10-16T02:00:00.000Z",
  });
  let settled = false;
  const pendingAction = service.requestToolApproval(
    context(fixture, { toolCallId: "call-exact" }),
    { toolName: "bash", input: { command: "npm test" } },
  ).then((decision) => {
    settled = true;
    return decision;
  });
  await assert.rejects(service.requestToolApproval(
    context(fixture, { toolCallId: "call-exact" }),
    { toolName: "bash", input: { command: "npm test" } },
  ), /already waiting/i);

  const approval = createApprovalRepository(fixture.db).getApproval("approval-1");
  assert.equal(approval.status, "pending");
  assert.deepEqual({
    taskId: approval.taskId,
    workItemId: approval.workItemId,
    piSessionId: approval.piSessionId,
    toolCallId: approval.toolCallId,
    action: approval.action,
  }, {
    taskId: "task-1",
    workItemId: "developer-work-item",
    piSessionId: "pi-developer-task",
    toolCallId: "call-exact",
    action: { toolName: "bash", input: { command: "npm test" } },
  });
  assert.ok(createEventRepository(fixture.db).listEventsForEntity("approval", approval.id)
    .some(({ type }) => type === "approval.requested"));
  assert.equal(createAttentionRepository(fixture.db).listAttentionRequestsForTask("task-1")
    .filter(({ approvalId }) => approvalId === approval.id && approvalId !== null).length, 1);
  await Promise.resolve();
  assert.equal(settled, false);

  const decided = await service.decideToolApproval(approval.id, { decision: "approve" });
  assert.equal(decided.status, "approved");
  assert.equal(await pendingAction, "approved");
  assert.equal(createAttentionRepository(fixture.db).listAttentionRequestsForTask("task-1")
    .find(({ approvalId }) => approvalId === approval.id).status, "resolved");
});

test("denial resolves the blocked action as denied and does not accept browser scope fields", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, {
    idFactory: () => "approval-denied",
  });
  const pendingAction = service.requestToolApproval(
    context(fixture, { toolCallId: "call-denied" }),
    { toolName: "write", input: { path: "answer.txt", content: "no" } },
  );
  await assert.rejects(
    service.decideToolApproval("approval-denied", {
      decision: "approve",
      taskId: "task-1",
      workItemId: "developer-work-item",
    }),
    /only.*decision|scope fields/i,
  );
  assert.equal(createApprovalRepository(fixture.db).getApproval("approval-denied").status, "pending");
  await service.decideToolApproval("approval-denied", { decision: "deny" });
  assert.equal(await pendingAction, "denied");
});

test("rejects stale run approval, denies its waiter, and closes persistent attention", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, { idFactory: () => "approval-stale-run" });
  let settled = false;
  const pendingAction = service.requestToolApproval(
    context(fixture, { toolCallId: "call-stale-run" }),
    { toolName: "bash", input: { command: "must stay blocked" } },
  ).then((decision) => {
    settled = true;
    return decision;
  });

  fixture.db.prepare("UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?")
    .run("2026-10-16T02:10:00.000Z", fixture.sourceRun.id);

  await assert.rejects(
    service.decideToolApproval("approval-stale-run", { decision: "approve" }),
    /stale/i,
  );
  assert.equal(await Promise.race([pendingAction, Promise.resolve("unsettled")]), "denied");
  assert.equal(settled, true);
  assert.equal(createApprovalRepository(fixture.db).getApproval("approval-stale-run").status, "denied");
  assert.equal(createAttentionRepository(fixture.db)
    .listAttentionRequestsForTask("task-1")
    .find(({ approvalId }) => approvalId === "approval-stale-run").status, "resolved");
  await assert.rejects(
    service.decideToolApproval("approval-stale-run", { decision: "approve" }),
    /stale|pending approval|not found/i,
  );
});

test("rejects stale work-item approval, denies its waiter, and closes persistent attention", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, { idFactory: () => "approval-stale-work-item" });
  let settled = false;
  const pendingAction = service.requestToolApproval(
    context(fixture, { toolCallId: "call-stale-work-item" }),
    { toolName: "bash", input: { command: "must stay blocked" } },
  ).then((decision) => {
    settled = true;
    return decision;
  });

  fixture.db.prepare("UPDATE work_items SET status = 'completed' WHERE id = ?")
    .run(fixture.sourceWorkItem.id);

  await assert.rejects(
    service.decideToolApproval("approval-stale-work-item", { decision: "approve" }),
    /stale/i,
  );
  assert.equal(await Promise.race([pendingAction, Promise.resolve("unsettled")]), "denied");
  assert.equal(settled, true);
  assert.equal(createApprovalRepository(fixture.db).getApproval("approval-stale-work-item").status, "denied");
  assert.equal(createAttentionRepository(fixture.db)
    .listAttentionRequestsForTask("task-1")
    .find(({ approvalId }) => approvalId === "approval-stale-work-item").status, "resolved");
  await assert.rejects(
    service.decideToolApproval("approval-stale-work-item", { decision: "approve" }),
    /stale|pending approval|not found/i,
  );
});

test("rejects mismatched server session scope and stale or already-decided IDs", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, { idFactory: () => "approval-scope" });

  await assert.rejects(service.requestToolApproval(
    context(fixture, { piSessionId: fixture.testerMapping.piSessionId, toolCallId: "wrong-session" }),
    { toolName: "bash", input: { command: "echo nope" } },
  ), /scope|match|session/i);
  assert.equal(createApprovalRepository(fixture.db).listApprovalsForTask("task-1").length, 0);

  await assert.rejects(
    service.decideToolApproval("missing-approval", { decision: "approve" }),
    /stale|pending approval|not found/i,
  );
  const pendingAction = service.requestToolApproval(
    context(fixture, { toolCallId: "call-once" }),
    { toolName: "bash", input: { command: "echo once" } },
  );
  await service.decideToolApproval("approval-scope", { decision: "approve" });
  await pendingAction;
  await assert.rejects(
    service.decideToolApproval("approval-scope", { decision: "deny" }),
    /stale|pending approval|already|not found/i,
  );
});
