import assert from "node:assert/strict";
import test from "node:test";
import {
  RetryConflictError,
  retryErrorStatus,
  TaskNotFoundError,
} from "../../src/server/lifecycle/retry-errors.ts";

const { POST: retryTask } = await import(
  "../../src/app/api/tasks/[taskId]/retry/route.ts"
);

test("maps retry conflicts and missing tasks separately from unexpected failures", () => {
  assert.equal(typeof retryErrorStatus, "function");
  assert.equal(retryErrorStatus(new TaskNotFoundError("Task not found: missing")), 404);
  assert.equal(retryErrorStatus(new RetryConflictError("Work item is not eligible")), 409);
  assert.equal(retryErrorStatus(new Error("Database unavailable")), 500);
});

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
