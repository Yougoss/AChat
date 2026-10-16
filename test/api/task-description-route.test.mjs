import assert from "node:assert/strict";
import test from "node:test";

test("task description route rejects blank descriptions and authority-bearing fields before runtime startup", async () => {
  const { PATCH: updateTask } = await import("../../src/app/api/tasks/[taskId]/route.ts");
  const params = { params: Promise.resolve({ taskId: "task-1" }) };
  const blank = await updateTask(new Request("http://localhost/api/tasks/task-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "  " }),
  }), params);

  assert.equal(blank.status, 400);
  assert.match((await blank.json()).error, /description.*required/i);

  const extraField = await updateTask(new Request("http://localhost/api/tasks/task-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "Complete the Feature.", status: "complete" }),
  }), params);

  assert.equal(extraField.status, 400);
  assert.match((await extraField.json()).error, /only description/i);
});
