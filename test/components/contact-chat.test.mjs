import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { ContactChat } from "../../src/components/ContactChat.tsx";

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

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function contact(id, name) {
  return { id, name, description: `${name} description` };
}

function evidence(id, title) {
  return {
    taskId: id,
    title,
    lastActivity: "2026-10-15T10:00:00.000Z",
    status: "completed",
    sessionRefs: [],
  };
}

test("switching contact reloads its conversation and sends to the new contact", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  let finishContactASend;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, method: init.method ?? "GET" });
    if (url === "/api/contacts/contact-a/messages" && init.method === "POST") {
      return new Promise((resolve) => {
        finishContactASend = resolve;
      });
    }
    if (url === "/api/contacts/contact-a") {
      return jsonResponse({ contact: contact("contact-a", "Contact A") });
    }
    if (url === "/api/contacts/contact-a/messages") {
      return jsonResponse({ messages: [{
        id: "message-a",
        role: "user",
        content: "Private message for Contact A",
        createdAt: "2026-10-15T10:00:00.000Z",
      }] });
    }
    if (url === "/api/contacts/contact-a/sessions?") {
      return jsonResponse({ items: [evidence("task-a", "Contact A evidence")] });
    }
    if (url === "/api/contacts/contact-b") {
      return jsonResponse({ contact: contact("contact-b", "Contact B") });
    }
    if (url === "/api/contacts/contact-b/messages" && init.method === "POST") {
      return jsonResponse({ exchange: {
        userMessage: {
          id: "sent-b",
          role: "user",
          content: "Send to Contact B",
          createdAt: "2026-10-15T11:01:00.000Z",
        },
        assistantMessage: {
          id: "reply-b",
          role: "assistant",
          content: "Reply from Contact B",
          createdAt: "2026-10-15T11:01:01.000Z",
        },
      } });
    }
    if (url === "/api/contacts/contact-b/messages") {
      return jsonResponse({ messages: [{
        id: "message-b",
        role: "user",
        content: "Private message for Contact B",
        createdAt: "2026-10-15T11:00:00.000Z",
      }] });
    }
    if (url === "/api/contacts/contact-b/sessions?") {
      return jsonResponse({ items: [evidence("task-b", "Contact B evidence")] });
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
  };

  try {
    const view = render(React.createElement(ContactChat, { contactId: "contact-a" }));
    await screen.findByText("Contact A evidence");
    await screen.findByText("Private message for Contact A");

    fireEvent.change(screen.getByRole("textbox", { name: "Message Contact A" }), {
      target: { value: "Pending message for Contact A" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Send message" }).closest("form"));
    assert.ok(finishContactASend);

    view.rerender(React.createElement(ContactChat, { contactId: "contact-b" }));

    await screen.findByRole("heading", { name: "Contact B" });
    await screen.findByText("Private message for Contact B");
    await screen.findByText("Contact B evidence");
    assert.equal(screen.queryByText("Private message for Contact A"), null);
    assert.equal(screen.queryByText("Contact A evidence"), null);
    assert.equal(screen.queryByText("task-a"), null);

    await act(async () => {
      finishContactASend(jsonResponse({ exchange: {
        userMessage: {
          id: "sent-a",
          role: "user",
          content: "Pending message for Contact A",
          createdAt: "2026-10-15T10:01:00.000Z",
        },
        assistantMessage: {
          id: "reply-a",
          role: "assistant",
          content: "Late reply from Contact A",
          createdAt: "2026-10-15T10:01:01.000Z",
        },
      } }));
    });
    assert.equal(screen.queryByText("Pending message for Contact A"), null);
    assert.equal(screen.queryByText("Late reply from Contact A"), null);

    fireEvent.change(screen.getByRole("textbox", { name: "Message Contact B" }), {
      target: { value: "Send to Contact B" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Send message" }).closest("form"));
    await screen.findByText("Reply from Contact B");

    assert.ok(requests.some(({ url, method }) =>
      url === "/api/contacts/contact-b/messages" && method === "POST"));
    assert.ok(requests.some(({ url, method }) =>
      url === "/api/contacts/contact-a/messages" && method === "POST"));
    assert.equal(screen.queryByText("Private message for Contact A"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renders fetched process summaries and uses the same 我 avatar for outgoing messages", async () => {
  const originalFetch = globalThis.fetch;
  const processSummary = { messageCount: 2, models: ["model-a"], usage: { input: 15 } };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "/api/contacts/contact-a") {
      return jsonResponse({ contact: contact("contact-a", "Contact A") });
    }
    if (url === "/api/contacts/contact-a/sessions?") return jsonResponse({ items: [] });
    if (url === "/api/contacts/contact-a/messages" && init.method === "POST") {
      return jsonResponse({
        exchange: {
          userMessage: {
            id: "sent-user",
            role: "user",
            content: "Follow-up",
            createdAt: "2026-10-16T10:06:00.000Z",
          },
          assistantMessage: {
            id: "sent-reply",
            role: "assistant",
            content: "Second exact reply",
            createdAt: "2026-10-16T10:06:01.000Z",
          },
        },
        processSummaries: { "sent-reply": processSummary },
      }, 201);
    }
    if (url === "/api/contacts/contact-a/messages") {
      return jsonResponse({
        messages: [
          {
            id: "first-user",
            role: "user",
            content: "First message",
            createdAt: "2026-10-16T10:00:00.000Z",
          },
          {
            id: "first-reply",
            role: "assistant",
            content: "First exact reply",
            createdAt: "2026-10-16T10:00:01.000Z",
          },
        ],
        processSummaries: { "first-reply": processSummary },
      });
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
  };

  try {
    render(React.createElement(ContactChat, { contactId: "contact-a" }));
    await screen.findByText("First exact reply");
    assert.equal(screen.getAllByRole("button", { name: /process details/i }).length, 1);

    fireEvent.change(screen.getByRole("textbox", { name: "Message Contact A" }), {
      target: { value: "Follow-up" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Send message" }).closest("form"));
    await screen.findByText("Second exact reply");

    const avatars = document.querySelectorAll(".message-line-user .message-avatar");
    assert.deepEqual([...avatars].map((avatar) => avatar.textContent), ["我", "我"]);
    assert.equal(screen.getAllByRole("button", { name: /process details/i }).length, 2);
    assert.equal(screen.getByText("First exact reply").textContent, "First exact reply");
    assert.equal(screen.getByText("Second exact reply").textContent, "Second exact reply");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a private assistant reply and its real sender name together in a left-side reply card", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/contacts/contact-a") {
      return jsonResponse({ contact: contact("contact-a", "Contact A") });
    }
    if (url === "/api/contacts/contact-a/messages") {
      return jsonResponse({ messages: [{
        id: "contact-reply",
        role: "assistant",
        content: "A reply without process details",
        createdAt: "2026-10-16T10:00:00.000Z",
      }] });
    }
    if (url === "/api/contacts/contact-a/sessions?") return jsonResponse({ items: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(React.createElement(ContactChat, { contactId: "contact-a" }));
    const reply = await screen.findByText("A reply without process details");
    const card = reply.closest(".message-assistant");
    assert.ok(card);
    assert.equal(card.querySelector(".message-role").textContent, "Contact A");
    assert.ok(card.previousElementSibling.matches(".message-avatar"));
    assert.equal(card.querySelector(".process-details-card"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renders a compact private-channel contact header with one settings action", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/contacts/contact-a") {
      return jsonResponse({ contact: contact("contact-a", "Contact A") });
    }
    if (url === "/api/contacts/contact-a/messages") return jsonResponse({ messages: [] });
    if (url === "/api/contacts/contact-a/sessions?") return jsonResponse({ items: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(React.createElement(ContactChat, { contactId: "contact-a" }));
    const heading = await screen.findByRole("heading", { name: "Contact A" });
    const header = heading.closest(".conversation-header");
    assert.ok(header);
    assert.equal(header.querySelector("h1").textContent, "Contact A");
    assert.ok(header.textContent.includes("Private contact channel"));
    assert.ok(heading.compareDocumentPosition(header.querySelector(".conversation-subtitle")) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(header.textContent.includes("Contact A description"), false);
    assert.deepEqual(
      [...header.querySelectorAll("a")].map((link) => link.textContent.trim()),
      ["Contact settings"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps contact session evidence in a collapsed thread disclosure above the composer", async () => {
  const originalFetch = globalThis.fetch;
  let finishSecondPage;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/contacts/contact-a") {
      return jsonResponse({ contact: contact("contact-a", "Contact A") });
    }
    if (url === "/api/contacts/contact-a/messages") return jsonResponse({ messages: [] });
    if (url === "/api/contacts/contact-a/sessions?") {
      return jsonResponse({
        items: [{ ...evidence("task-a", "Contact A evidence"), sessionRefs: ["pi-session-a"] }],
        nextCursor: "page-2",
      });
    }
    if (url === "/api/contacts/contact-a/sessions?cursor=page-2") {
      return new Promise((resolve) => {
        finishSecondPage = resolve;
      });
    }
    if (url === "/api/contacts/contact-a/sessions?cursor=page-3") {
      return jsonResponse({ error: "Evidence page failed" }, 503);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(React.createElement(ContactChat, { contactId: "contact-a" }));
    const heading = await screen.findByRole("heading", { name: "Contact A" });
    const conversationPanel = heading.closest(".conversation-panel");
    const disclosure = conversationPanel?.querySelector("details.contact-session-evidence");
    assert.ok(disclosure);
    assert.equal(disclosure.open, false);

    const thread = disclosure.closest(".conversation-thread");
    assert.ok(thread);
    assert.ok(thread.querySelector(".message-list"));
    const composer = conversationPanel.querySelector(".message-composer");
    assert.ok(composer);
    assert.ok(disclosure.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(conversationPanel.lastElementChild, composer);

    fireEvent.click(screen.getByText("Session evidence", { exact: true }));
    await screen.findByText("Contact A evidence");
    fireEvent.click(screen.getByText("Pi session references (1)"));
    await screen.findByText("pi-session-a");
    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
    assert.ok(screen.getByRole("button", { name: "Loading…" }));
    await act(async () => {
      finishSecondPage(jsonResponse({
        items: [evidence("task-b", "Second page evidence")],
        nextCursor: "page-3",
      }));
    });
    await screen.findByText("Second page evidence");
    assert.ok(screen.getByText("Contact A evidence"));
    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
    const error = await screen.findByRole("alert");
    assert.equal(error.textContent, "Evidence page failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
