import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { AppRouterContext } from "next/navigation";
import HomePage from "../../src/app/page.tsx";
import { WorkspaceShell } from "../../src/components/WorkspaceShell.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

const items = [
  {
    kind: "contact",
    id: "contact-ada",
    title: "Ada Lovelace",
    preview: "Latest private note",
    updatedAt: "2026-10-16T10:00:00.000Z",
    href: "/contacts/contact-ada",
    avatarText: "A",
    unreadCount: 0,
  },
  {
    kind: "task",
    id: "group-orchid",
    title: "Orchid migration",
    preview: "Task group update",
    updatedAt: "2026-10-16T09:00:00.000Z",
    href: "/groups/group-orchid",
    avatarText: "O",
    unreadCount: 2,
  },
];

function provideRouter(element) {
  return React.createElement(AppRouterContext.Provider, {
    value: {
      back() {},
      forward() {},
      refresh() {},
      push() {},
      replace() {},
      prefetch() {},
    },
  }, element);
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function withWorkspaceFetch(callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/conversations") return jsonResponse({ items });
    if (url === "/api/contacts") {
      return jsonResponse({
        contacts: items.filter(({ kind }) => kind === "contact").map(({ id, title }) => ({
          id,
          name: title,
          description: "",
          modelProvider: "github-copilot",
          modelId: "model-a",
        })),
      });
    }
    if (url === "/api/models") {
      return jsonResponse({
        models: [{ provider: "github-copilot", modelId: "model-a", name: "Model A" }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("filters the shared conversation list by recent, contacts, and tasks", async () => {
  await withWorkspaceFetch(async () => {
    render(provideRouter(React.createElement(WorkspaceShell)));
    await screen.findByRole("link", { name: /Ada Lovelace/ });
    await screen.findByRole("link", { name: /Orchid migration/ });

    assert.equal(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/contacts/contact-ada"), true);
    fireEvent.click(screen.getByRole("button", { name: "Contacts" }));
    assert.ok(screen.getByRole("link", { name: /Ada Lovelace/ }));
    assert.equal(screen.queryByRole("link", { name: /Orchid migration/ }), null);

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    assert.ok(screen.getByRole("link", { name: /Orchid migration/ }));
    assert.equal(screen.queryByRole("link", { name: /Ada Lovelace/ }), null);

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    assert.ok(screen.getByRole("link", { name: /Ada Lovelace/ }));
    assert.ok(screen.getByRole("link", { name: /Orchid migration/ }));
  });
});

test("marks contact and task routes active and opens the existing add-contact form", async () => {
  await withWorkspaceFetch(async () => {
    render(provideRouter(React.createElement(WorkspaceShell, {
      activeGroupId: "group-orchid",
    })));
    const activeTaskLink = await screen.findByRole("link", { name: /Orchid migration/ });
    assert.equal(activeTaskLink.getAttribute("aria-current"), "page");
    assert.equal(activeTaskLink.getAttribute("href"), "/groups/group-orchid");

    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    assert.ok(screen.getByLabelText("Name"));
    assert.ok(screen.getByLabelText("Description"));
    assert.ok(screen.getByRole("combobox", { name: "Model" }));
    await waitFor(() => assert.ok(screen.getByRole("option", { name: /Model A · model-a/ })));
  });
});

test("renders the root route with a blank main pane and no setup instructions", async () => {
  await withWorkspaceFetch(async () => {
    render(provideRouter(React.createElement(HomePage)));
    const main = await screen.findByRole("main");
    await screen.findByRole("link", { name: /Ada Lovelace/ });
    assert.equal(main.textContent, "");
    assert.doesNotMatch(document.body.textContent, /Start with a local project root|sign in to GitHub Copilot/);
    assert.equal(screen.queryByRole("link", { name: "Back to conversations" }), null);
  });
});

test("provides a return-to-list control when a conversation is active", async () => {
  await withWorkspaceFetch(async () => {
    render(provideRouter(React.createElement(
      WorkspaceShell,
      { activeContactId: "contact-ada" },
      React.createElement("main", null, "Active conversation"),
    )));

    const backLink = await screen.findByRole("link", { name: "Back to conversations" });
    assert.equal(backLink.getAttribute("href"), "/");
    assert.equal(backLink.classList.contains("workspace-back-link"), true);
    assert.ok(screen.getByText("Active conversation"));
  });
});
