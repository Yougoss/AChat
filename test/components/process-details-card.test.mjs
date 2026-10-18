import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { ProcessDetailsCard } from "../../src/components/ProcessDetailsCard.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const summary = {
  messageCount: 3,
  models: ["model-a"],
  usage: { input: 120, output: 30, cacheRead: 40, cacheWrite: 25, cost: 0.002 },
};

function event(id, createdAt, label, detail, kind = "tool") {
  return { id, createdAt, kind, label, detail };
}

function card(props = {}) {
  return React.createElement(ProcessDetailsCard, {
    summary,
    detailUrl: "/api/process",
    ...props,
  });
}

test("starts collapsed and shows only available summary usage", () => {
  render(card());

  assert.equal(screen.getByRole("button", { name: /process details/i }).getAttribute("aria-expanded"), "false");
  assert.equal(screen.getByText(/3 messages/).textContent.includes("3 messages"), true);
  assert.match(document.body.textContent, /120/);
  assert.match(document.body.textContent, /30/);
  assert.match(document.body.textContent, /40/);
  assert.match(document.body.textContent, /25/);
  assert.match(document.body.textContent, /0\.002/);
});

test("fetches process details only after first expansion and presents events chronologically", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return ({
    ok: true,
    json: async () => ({
      summary,
      events: [
        event("later", "2026-10-16T10:02:00.000Z", "Later event", "<img src=x onerror=alert(1)>"),
        event("earlier", "2026-10-16T10:01:00.000Z", "Earlier event", "earlier detail"),
      ],
    }),
    });
  };
  render(card());

  assert.equal(requests, 0);
  fireEvent.click(screen.getByRole("button", { name: /process details/i }));

  const earlier = await screen.findByText("Earlier event");
  const later = await screen.findByText("Later event");
  assert.equal(document.querySelector("img"), null);
  assert.ok(screen.getByText("<img src=x onerror=alert(1)>"));
  assert.equal(requests, 1);
  assert.ok(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("shows a loading state while lazy details are being fetched", async () => {
  let finishRequest;
  globalThis.fetch = () => new Promise((resolve) => {
    finishRequest = resolve;
  });
  render(card());

  fireEvent.click(screen.getByRole("button", { name: /process details/i }));
  assert.ok(screen.getByRole("status").textContent.toLowerCase().includes("loading"));

  await act(async () => {
    finishRequest({
      ok: true,
      json: async () => ({ summary, events: [] }),
    });
  });
});

test("shows an error and retries a failed lazy detail request", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network unavailable");
    return {
      ok: true,
      json: async () => ({
        summary,
        events: [event("retry", "2026-10-16T10:00:00.000Z", "Retried event", "safe output")],
      }),
    };
  };
  render(card());
  fireEvent.click(screen.getByRole("button", { name: /process details/i }));

  assert.match((await screen.findByRole("alert")).textContent, /network unavailable/i);
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByText("Retried event");
  assert.equal(attempts, 2);
});

test("shows an explicit unavailable state when no usage was captured", () => {
  render(card({ summary: { messageCount: 1, models: ["model-a"] } }));

  assert.equal(screen.getByText("Usage unavailable").textContent, "Usage unavailable");
  assert.doesNotMatch(document.body.textContent, /input\s*0|output\s*0|cache\s*0|cost\s*0/i);
});

test("shows only the available usage fields when usage is partial", () => {
  render(card({
    summary: {
      messageCount: 1,
      models: ["model-a"],
      usage: { input: 12, cacheRead: 4 },
    },
  }));

  const usage = document.querySelector(".process-usage");
  assert.ok(usage);
  assert.match(usage.textContent, /Input\s*12/);
  assert.match(usage.textContent, /Cache read\s*4/);
  assert.doesNotMatch(usage.textContent, /Output|Cache write|Cost/);
  assert.equal(screen.queryByText("Usage unavailable"), null);
});

test("keeps long tool output in a secondary disclosure without duplicating the reply", async () => {
  const longOutput = "safe output ".repeat(100);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      summary,
      events: [event("long", "2026-10-16T10:00:00.000Z", "Tool output", longOutput, "tool_result")],
    }),
  });
  render(card());
  fireEvent.click(screen.getByRole("button", { name: /process details/i }));

  const disclosure = await screen.findByText(/show full output/i);
  assert.equal(document.querySelector(".process-reply"), null);
  assert.equal(disclosure.closest("details").open, false);
  assert.equal(disclosure.closest("details").querySelector("pre").textContent, longOutput);
});
