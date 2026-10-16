import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { ApprovalCard } from "../../src/components/ApprovalCard.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");

afterEach(cleanup);

function approval() {
  return {
    id: "approval-1",
    taskId: "task-1",
    workItemId: "work-item-1",
    piSessionId: "session-1",
    toolCallId: "call-1",
    action: { toolName: "bash", input: { command: "npm test" } },
    status: "pending",
    createdAt: "2026-10-16T02:00:00.000Z",
    decidedAt: null,
  };
}

test("approval controls submit only the approval ID and decision and show server errors", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(init.body) });
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: "Approval is stale" }),
    };
  };
  try {
    render(React.createElement(ApprovalCard, { approval: approval() }));
    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));
    await screen.findByRole("alert");

    assert.deepEqual(requests, [{
      url: "/api/approvals/approval-1",
      body: { decision: "approve" },
    }]);
    assert.equal(screen.getByRole("alert").textContent, "Approval is stale");
    assert.equal(screen.getByRole("status").textContent, "pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("presents the action and explicit approve and deny choices accessibly", () => {
  const view = render(React.createElement(ApprovalCard, { approval: approval() }));
  assert.ok(screen.getByRole("article", { name: "Tool approval approval-1" }));
  assert.ok(screen.getByRole("heading", { name: "bash" }));
  assert.ok(screen.getByRole("button", { name: "Approve action" }));
  assert.ok(screen.getByRole("button", { name: "Deny action" }));
  assert.match(view.container.textContent, /npm test/);
});
