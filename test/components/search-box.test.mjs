import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { SearchBox } from "../../src/components/SearchBox.tsx";

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

test("search box submits the active contact scope and renders message deep links", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return {
      ok: true,
      json: async () => ({
        results: [{
          ownerType: "group",
          ownerId: "group-1",
          taskId: "task-1",
          title: "Planning",
          preview: "The matching visible message",
          messageId: "message-hit",
          matchedAt: "2026-10-16T10:00:00.000Z",
          matchingMessageCount: 1,
          href: "/groups/group-1#message-message-hit",
        }],
      }),
    };
  };
  try {
    render(React.createElement(SearchBox, { contactId: "contact-1" }));
    fireEvent.change(screen.getByLabelText("Search messages and tasks"), {
      target: { value: "needle" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form"));

    const result = await screen.findByRole("link", { name: /Planning/ });
    assert.equal(result.getAttribute("href"), "/groups/group-1#message-message-hit");
    assert.ok(screen.getByText("The matching visible message"));
    assert.deepEqual(requests, ["/api/search?q=needle&contactId=contact-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discards pending search results when the active contact changes", async () => {
  let finishSearch;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise((resolve) => {
    finishSearch = () => resolve({
      ok: true,
      json: async () => ({
        results: [{
          ownerType: "contact",
          ownerId: "contact-one",
          taskId: null,
          title: "Private Contact One",
          preview: "Contact One private result",
          messageId: "private-hit",
          matchedAt: "2026-10-16T10:00:00.000Z",
          matchingMessageCount: 1,
          href: "/contacts/contact-one#message-private-hit",
        }],
      }),
    });
  });
  try {
    const view = render(React.createElement(SearchBox, { contactId: "contact-one" }));
    fireEvent.change(screen.getByLabelText("Search messages and tasks"), {
      target: { value: "private" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form"));
    assert.ok(finishSearch);

    view.rerender(React.createElement(SearchBox, { contactId: "contact-two" }));
    await act(async () => {
      finishSearch();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.doesNotMatch(document.body.textContent, /Private Contact One|Contact One private result/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("announces the active search state to assistive technology", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise(() => {});
  try {
    render(React.createElement(SearchBox));
    fireEvent.change(screen.getByLabelText("Search messages and tasks"), {
      target: { value: "needle" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form"));

    assert.equal(screen.getByRole("status").textContent, "Searching messages…");
    assert.equal(screen.getByRole("region", { name: "Workspace search" }).getAttribute("aria-busy"), "true");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
