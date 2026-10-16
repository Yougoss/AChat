import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "./task-execution-fixtures.mjs";

const toolModule = await import("../../src/server/pi/tools/delegate-to-member.ts")
  .catch(() => ({}));
const handoffModule = await import("../../src/server/services/handoff-service.ts")
  .catch(() => ({}));

test("delegate_to_member derives source identity from server context and routes only structured calls", async (t) => {
  assert.equal(typeof toolModule.createDelegateToMemberTool, "function",
    "createDelegateToMemberTool must bind server-owned task and Pi session context");
  assert.equal(typeof handoffModule.createHandoffService, "function");
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = handoffModule.createHandoffService(fixture.db, {
    idFactory: (() => {
      const ids = ["handoff-1", "message-1", "work-item-1", "handoff-event"];
      return () => ids.shift();
    })(),
  });
  const tool = toolModule.createDelegateToMemberTool(() => fixture.context, service);
  const result = await tool.execute("tool-call-1", {
    recipientAgentId: "tester",
    instruction: "Check the failure path.",
    expectedOutput: "A regression assertion",
  });

  assert.equal(result.isError, false);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 1);
  const persisted = fixture.db.prepare(`
    SELECT from_contact_id AS sourceContactId, from_run_id AS sourceRunId,
           from_agent_id AS sourceAgentId, to_agent_id AS recipientAgentId,
           source_pi_session_id AS sourcePiSessionId, tool_call_id AS toolCallId
    FROM handoffs WHERE id = 'handoff-1'
  `).get();
  assert.deepEqual(persisted, {
    sourceContactId: "developer",
    sourceRunId: "developer-run",
    sourceAgentId: "developer",
    recipientAgentId: "tester",
    sourcePiSessionId: "pi-developer-task",
    toolCallId: "tool-call-1",
  });
  assert.doesNotMatch(JSON.stringify(tool.parameters), /sourceAgentId|sourceContactId|taskId|piSessionId|runId/);
});

test("ordinary model text mentioning another contact does not enqueue work", async (t) => {
  assert.equal(typeof toolModule.createDelegateToMemberTool, "function");
  assert.equal(typeof handoffModule.createHandoffService, "function");
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const service = handoffModule.createHandoffService(fixture.db);

  fixture.messages.appendMessage({
    id: "plain-model-message",
    conversationId: fixture.conversation.id,
    role: "assistant",
    content: "I will ask @Tester to run the tests.",
    createdAt: "2026-10-16T02:00:00.000Z",
  });

  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 1);
  assert.ok(service);
});
