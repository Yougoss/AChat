import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { ContactChat } from "../../src/components/ContactChat.tsx";
import { GroupConversation } from "../../src/components/GroupConversation.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.EventSource = class {
  close() {}
};
const { cleanup, render } = await import("@testing-library/react");

afterEach(cleanup);

test("private and task conversation rows expose stable search fragment targets", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ items: [] }),
  });
  try {
    const privateView = render(React.createElement(ContactChat, {
      contactId: "contact-1",
      contact: { id: "contact-1", name: "Builder", description: "" },
      messages: [{
        id: "private-hit",
        conversationId: "private-1",
        role: "user",
        content: "private search hit",
        createdAt: "2026-10-16T10:00:00.000Z",
      }],
    }));
    assert.ok(document.getElementById("message-private-hit"));
    privateView.unmount();

    render(React.createElement(GroupConversation, {
      group: { id: "group-1", name: "Planning", description: "" },
      task: {
        id: "task-1",
        groupId: "group-1",
        projectId: "project-1",
        description: "Plan",
        status: "open",
      },
      messages: [{
        id: "task-hit",
        conversationId: "task-conversation",
        role: "user",
        content: "task search hit",
        createdAt: "2026-10-16T10:00:00.000Z",
      }],
      runs: [],
      contacts: [],
      taskStatus: "open",
      unreadCount: 0,
      pendingAttentionCount: 0,
      approvals: [],
      eventCursor: 0,
    }));
    assert.ok(document.getElementById("message-task-hit"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
