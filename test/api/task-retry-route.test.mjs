import assert from "node:assert/strict";
import test from "node:test";
import { POST as retryTask } from "../../src/app/api/tasks/[taskId]/retry/route.ts";

test("retry route rejects unrelated or malformed selection fields before starting runtime", async () => {
  const response = await retryTask(new Request("http://localhost/api/tasks/task-1/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: "task-1", workItemIds: [null] }),
  }), { params: Promise.resolve({ taskId: "task-1" }) });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only workItemIds|non-empty strings/i);
});

test("retry route rejects authority-bearing fields rather than trusting body task scope", async () => {
  const response = await retryTask(new Request("http://localhost/api/tasks/task-1/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: "task-2", workItemIds: ["item-1"] }),
  }), { params: Promise.resolve({ taskId: "task-1" }) });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only workItemIds/i);
});
