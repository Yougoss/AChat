import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
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

test("opens task information to expose task, run and approval state and allow approval decisions", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ approval: { ...approval(), status: "approved" } }),
    };
  };
  try {
    render(React.createElement(TaskStatusPanel, {
      taskId: "task-1",
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
      approvals: [approval()],
    }));

    const disclosure = document.querySelector("details");
    assert.ok(disclosure);
    assert.equal(disclosure.open, false);
    assert.equal(disclosure.querySelector("summary").getAttribute("aria-label"), "Task information");
    fireEvent.click(screen.getByText("Task information"));

    assert.equal(disclosure.open, true);
    assert.match(screen.getByText("open").textContent, /open/);
    assert.match(screen.getByText("Running").textContent, /Running/);
    assert.match(screen.getByText("1 waiting").textContent, /1 waiting/);
    assert.equal(screen.getByLabelText("2 unread runs").textContent, "2");
    assert.ok(screen.getByRole("article", { name: "Tool approval approval-1" }));
    assert.ok(screen.getByRole("heading", { name: "Run history" }));

    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));
    await screen.findByText("approved");
    assert.deepEqual(requests, [{
      url: "/api/approvals/approval-1",
      body: { decision: "approve" },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a clear no-run state inside task information when no work has been dispatched", () => {
  const markup = renderToStaticMarkup(React.createElement(TaskStatusPanel, {
    taskStatus: "open",
    runs: [],
    unreadCount: 0,
    pendingAttentionCount: 0,
  }));

  assert.match(markup, /<summary[^>]*>.*Task information/);
  assert.match(markup, /No runs have been dispatched for this task/);
  assert.match(markup, /No requests/);
  assert.match(markup, /No unread runs/);
});

test("keeps retry reachable and functional inside the task-information disclosure", async () => {
  const originalFetch = globalThis.fetch;
  let finishRetry;
  let request;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), method: init.method, body: init.body };
    return new Promise((resolve) => { finishRetry = resolve; });
  };
  try {
    render(React.createElement(TaskStatusPanel, {
      taskId: "task-1",
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
    }));

    fireEvent.click(screen.getByText("Task information"));
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
