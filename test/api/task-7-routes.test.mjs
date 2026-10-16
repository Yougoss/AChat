import assert from "node:assert/strict";
import test from "node:test";
import { POST as decideApproval } from "../../src/app/api/approvals/[approvalId]/route.ts";
import { GET as streamEvents } from "../../src/app/api/events/route.ts";

test("approval route rejects authority-bearing scope fields before runtime or mutation", async () => {
  const response = await decideApproval(new Request("http://localhost/api/approvals/approval-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision: "approve",
      taskId: "task-1",
      workItemId: "item-1",
      piSessionId: "session-1",
      toolCallId: "call-1",
      action: { toolName: "bash" },
    }),
  }), { params: Promise.resolve({ approvalId: "approval-1" }) });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only decision|scope is server-bound/i);
});

test("event route rejects malformed reconnect cursors without opening the runtime", async () => {
  const response = await streamEvents(new Request("http://localhost/api/events?after=invalid"));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid event cursor/i);
});
