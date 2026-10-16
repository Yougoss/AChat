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

test("shows task state, execution state, unread count, attention, and unknown stuck evidence separately", () => {
  const markup = renderToStaticMarkup(React.createElement(TaskStatusPanel, {
    taskStatus: "open",
    runs: [{
      id: "run-1",
      status: "running",
      contactName: "Builder",
      title: "Implement the feature",
      stuck: "unknown",
      lifecycleEvidence: "unknown",
    }],
    unreadCount: 2,
    pendingAttentionCount: 1,
  }));

  assert.match(markup, /<dt>Task<\/dt><dd>open<\/dd>/);
  assert.match(markup, /<dt>Execution<\/dt><dd>Running<\/dd>/);
  assert.match(markup, /<dt>Attention<\/dt><dd>1 waiting<\/dd>/);
  assert.match(markup, /2 unread runs/);
  assert.match(markup, /Stuck status unknown/);
});

test("gives an explicit empty state when no run has been dispatched", () => {
  const markup = renderToStaticMarkup(React.createElement(TaskStatusPanel, {
    taskStatus: "open",
    runs: [],
    unreadCount: 0,
    pendingAttentionCount: 0,
  }));

  assert.match(markup, /No runs have been dispatched for this task/);
  assert.match(markup, /No requests/);
  assert.match(markup, /No unread runs/);
});

test("manual retry has an explicit action, loading state, and visible request error", async () => {
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
        status: "interrupted",
        workItemStatus: "interrupted",
        contactName: "Builder",
        title: "Continue the task",
        stuck: "not_stuck",
        lifecycleEvidence: "terminal",
      }],
      unreadCount: 0,
      pendingAttentionCount: 0,
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
