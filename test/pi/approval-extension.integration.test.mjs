import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "./task-execution-fixtures.mjs";
import { createApprovalService } from "../../src/server/services/approval-service.ts";
import { createApprovalExtension } from "../../src/server/pi/approval-extension.ts";
import { createApprovalRepository } from "../../src/server/db/repositories/approval-repository.ts";
import { createAttentionRepository } from "../../src/server/db/repositories/attention-repository.ts";

function fakePiToolPipeline(extension, action) {
  let intercept;
  extension({
    on(event, handler) {
      assert.equal(event, "tool_call");
      intercept = handler;
      return () => {};
    },
  });
  return async function callTool(event) {
    const result = await intercept(event);
    if (result?.block) return { executed: false, reason: result.reason };
    return { executed: true, value: action(event.input) };
  };
}

test("blocks side-effecting tools until exact approval, and denial never executes the action", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, {
    idFactory: (() => {
      let id = 0;
      return () => `approval-${++id}`;
    })(),
  });
  const extension = createApprovalExtension({
    service,
    context: {
      taskId: fixture.task.id,
      workItemId: fixture.sourceWorkItem.id,
      runId: fixture.sourceRun.id,
      piSessionId: fixture.sourceMapping.piSessionId,
    },
  });
  let executionCount = 0;
  const execute = fakePiToolPipeline(extension, () => {
    executionCount += 1;
    return "side effect";
  });
  let settled = false;
  const first = execute({
    type: "tool_call",
    toolName: "bash",
    toolCallId: "call-approve",
    input: { command: "echo approved" },
  }).then((result) => {
    settled = true;
    return result;
  });
  const approval = createApprovalRepository(fixture.db).listApprovalsForTask("task-1")[0];
  assert.equal(approval.toolCallId, "call-approve");
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(executionCount, 0);
  await service.decideToolApproval(approval.id, { decision: "approve" });
  assert.deepEqual(await first, { executed: true, value: "side effect" });
  assert.equal(executionCount, 1);

  const denied = execute({
    type: "tool_call",
    toolName: "write",
    toolCallId: "call-deny",
    input: { path: "protected.txt", content: "denied" },
  });
  const denial = createApprovalRepository(fixture.db).listApprovalsForTask(fixture.task.id)
    .find(({ toolCallId }) => toolCallId === "call-deny");
  await service.decideToolApproval(denial.id, { decision: "deny" });
  assert.deepEqual(await denied, {
    executed: false,
    reason: "This action was denied by the user.",
  });
  assert.equal(executionCount, 1);
});

test("stale approval denies the blocked tool and never executes its action", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = createApprovalService(fixture.db, {
    idFactory: () => "approval-stale-extension",
  });
  const extension = createApprovalExtension({
    service,
    context: {
      taskId: fixture.task.id,
      workItemId: fixture.sourceWorkItem.id,
      runId: fixture.sourceRun.id,
      piSessionId: fixture.sourceMapping.piSessionId,
    },
  });
  let executionCount = 0;
  const execute = fakePiToolPipeline(extension, () => {
    executionCount += 1;
    return "side effect";
  });
  const blockedTool = execute({
    type: "tool_call",
    toolName: "bash",
    toolCallId: "call-stale",
    input: { command: "must not execute" },
  });
  const approval = createApprovalRepository(fixture.db)
    .getApproval("approval-stale-extension");
  fixture.db.prepare("UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?")
    .run("2026-10-16T02:10:00.000Z", fixture.sourceRun.id);

  await assert.rejects(
    service.decideToolApproval(approval.id, { decision: "approve" }),
    /stale/i,
  );
  assert.deepEqual(await Promise.race([
    blockedTool,
    new Promise((resolve) => setTimeout(() => resolve("unsettled"), 50)),
  ]), {
    executed: false,
    reason: "This action was denied by the user.",
  });
  assert.equal(executionCount, 0);
  assert.equal(createApprovalRepository(fixture.db)
    .getApproval(approval.id).status, "denied");
  assert.equal(createAttentionRepository(fixture.db)
    .listAttentionRequestsForTask(fixture.task.id)
    .find(({ approvalId }) => approvalId === approval.id).status, "resolved");
  await assert.rejects(
    service.decideToolApproval(approval.id, { decision: "approve" }),
    /stale|pending approval|not found/i,
  );
});
