import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { ConversationTimeline } from "../../src/components/ConversationTimeline.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { cleanup, render, screen } = await import("@testing-library/react");

afterEach(cleanup);

function message(id, role, createdAt, content = id) {
  return { id, role, content, createdAt };
}

test("shows contact and user avatars with the same 我 avatar for every outgoing message", () => {
  render(React.createElement(ConversationTimeline, {
    messages: [
      message("out-1", "user", "2026-10-16T10:00:00.000Z"),
      message("reply", "assistant", "2026-10-16T10:01:00.000Z"),
      message("out-2", "user", "2026-10-16T10:02:00.000Z"),
    ],
    senderLabels: { user: "You", assistant: "Ari" },
  }));

  const outgoing = document.querySelectorAll(".message-user .message-avatar");
  assert.equal(outgoing.length, 2);
  assert.deepEqual([...outgoing].map((avatar) => avatar.textContent), ["我", "我"]);
  assert.equal(screen.getByLabelText("Ari avatar").textContent, "A");
});

test("adds a centered timestamp when the gap is exactly five minutes", () => {
  render(React.createElement(ConversationTimeline, {
    messages: [
      message("first", "user", "2026-10-16T10:00:00.000Z"),
      message("second", "assistant", "2026-10-16T10:05:00.000Z"),
    ],
    senderLabels: { user: "You", assistant: "Ari" },
  }));

  assert.equal(document.querySelectorAll("[data-timeline-separator='time']").length, 2);
});

test("suppresses a centered timestamp when the gap is shorter than five minutes", () => {
  render(React.createElement(ConversationTimeline, {
    messages: [
      message("first", "user", "2026-10-16T10:00:00.000Z"),
      message("second", "assistant", "2026-10-16T10:04:59.999Z"),
    ],
    senderLabels: { user: "You", assistant: "Ari" },
  }));

  assert.equal(document.querySelectorAll("[data-timeline-separator='time']").length, 1);
});

test("shows a date separator at a day boundary even when messages are under five minutes apart", () => {
  const beforeMidnight = new Date(2026, 9, 16, 23, 58).toISOString();
  const afterMidnight = new Date(2026, 9, 17, 0, 1).toISOString();
  render(React.createElement(ConversationTimeline, {
    messages: [
      message("before-midnight", "user", beforeMidnight),
      message("after-midnight", "assistant", afterMidnight),
    ],
    senderLabels: { user: "You", assistant: "Ari" },
  }));

  assert.equal(document.querySelectorAll("[data-timeline-separator='date']").length, 1);
});
