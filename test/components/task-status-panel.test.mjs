import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { TaskStatusPanel } from "../../src/components/TaskStatusPanel.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");

afterEach(cleanup);

function approval() {
  return {
    id: "approval-1",
    taskId: "task-1",
    workItemId: "work-1",
    piSessionId: "session-1",
    toolCallId: "call-1",
    action: { toolName: "bash", input: { command: "npm test" } },
    status: "pending",
    createdAt: "2026-10-16T02:00:00.000Z",
    decidedAt: null,
  };
}

test("renders task goal, participants, run state and unread state in the open drawer", () => {
  const onClose = () => {};
  render(React.createElement(TaskStatusPanel, {
      open: true,
      taskId: "task-1",
      taskGoal: "Improve the app",
      participants: ["Builder", "Reviewer"],
      taskStatus: "open",
      runs: [{
        id: "run-1",
        taskId: "task-1",
        workItemId: "work-1",
        contactId: "contact-1",
        attempt: 1,
        status: "running",
        startedAt: "2026-10-16T10:00:00.000Z",
        completedAt: null,
        workItemStatus: "running",
        contactName: "Builder",
        title: "Implement the feature",
        stuck: "unknown",
        lifecycleEvidence: "unknown",
      }],
      unreadCount: 2,
      pendingAttentionCount: 1,
      onClose,
    }));

    const drawer = screen.getByRole("complementary", { name: "Task information" });
    assert.match(drawer.textContent, /Improve the app/);
    assert.match(drawer.textContent, /Builder.*Reviewer/);
    assert.match(drawer.textContent, /open/);
    assert.match(drawer.textContent, /Running/);
    assert.equal(screen.getByLabelText("2 unread runs").textContent, "2");
    assert.ok(screen.getByRole("heading", { name: "Run history" }));
    fireEvent.click(screen.getByRole("button", { name: "Close task information" }));
});

test("keeps the task-information drawer closed when it is not requested", () => {
  render(React.createElement(TaskStatusPanel, {
    open: false,
    taskId: "task-1",
    taskGoal: "Improve the app",
    participants: [],
    taskStatus: "open",
    runs: [],
    unreadCount: 0,
    pendingAttentionCount: 0,
    onClose() {},
  }));
  assert.equal(screen.queryByRole("complementary", { name: "Task information" }), null);
  assert.equal(screen.queryByRole("heading", { name: "Run history" }), null);
});

test("keeps explicit retry reachable and functional inside the task-information drawer", async () => {
  const originalFetch = globalThis.fetch;
  let finishRetry;
  let request;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), method: init.method, body: init.body };
    return new Promise((resolve) => { finishRetry = resolve; });
  };
  try {
    render(React.createElement(TaskStatusPanel, {
      open: true,
      taskId: "task-1",
      taskGoal: "Continue the task",
      participants: ["Builder"],
      taskStatus: "open",
      runs: [{
        id: "interrupted-run",
        taskId: "task-1",
        workItemId: "work-1",
        contactId: "contact-1",
        attempt: 1,
        status: "interrupted",
        startedAt: "2026-10-16T10:00:00.000Z",
        completedAt: null,
        workItemStatus: "interrupted",
        contactName: "Builder",
        title: "Continue the task",
        stuck: "not_stuck",
        lifecycleEvidence: "terminal",
      }],
      unreadCount: 0,
      pendingAttentionCount: 0,
      onClose() {},
    }));

    const retryButton = screen.getByRole("button", { name: "Retry interrupted work" });
    fireEvent.click(retryButton);
    assert.equal(retryButton.disabled, true);
    assert.equal(retryButton.textContent, "Retrying interrupted work…");
    assert.deepEqual(request, {
      url: "/api/tasks/task-1/retry",
      method: "POST",
      body: "{}",
    });

    await act(async () => {
      finishRetry({
        ok: false,
        json: async () => ({ error: "No mapped Pi session is available" }),
      });
    });

    assert.match(screen.getByRole("alert").textContent, /No mapped Pi session is available/);
    assert.equal(retryButton.disabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
