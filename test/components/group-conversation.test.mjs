import assert from "node:assert/strict";
import React from "react";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
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
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

const processSummary = { messageCount: 2, models: ["model-a"], usage: { input: 12, output: 4 } };

function props(overrides = {}) {
  return {
    group: { id: "group-1", name: "Planning", description: "Planning group" },
    task: { id: "task-1", groupId: "group-1", projectId: "project-1", description: "Improve the app", status: "open" },
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "Please @Builder review the change.",
        createdAt: "2026-10-16T10:00:00.000Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "I am checking it.",
        metadata: { runId: "run-1", contactId: "contact-builder" },
        createdAt: "2026-10-16T10:01:00.000Z",
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "The change looks good.",
        metadata: { runId: "run-1", contactId: "contact-builder" },
        createdAt: "2026-10-16T10:02:00.000Z",
      },
      {
        id: "handoff-1",
        role: "handoff",
        content: "@Builder → @Reviewer: Review the change for regressions.",
        metadata: {
          sourceRunId: "run-1",
          fromContactId: "contact-builder",
          toContactId: "contact-reviewer",
        },
        createdAt: "2026-10-16T10:02:30.000Z",
      },
      {
        id: "assistant-3",
        role: "assistant",
        content: "The review is complete.",
        metadata: { runId: "run-2", contactId: "contact-reviewer" },
        createdAt: "2026-10-16T10:09:00.000Z",
      },
    ],
    runs: [],
    contacts: [
      { id: "contact-builder", name: "Builder" },
      { id: "contact-reviewer", name: "Reviewer" },
    ],
    taskStatus: "open",
    unreadCount: 0,
    pendingAttentionCount: 0,
    approvals: [],
    eventCursor: 0,
    processSummaries: { "run-1": processSummary, "run-2": processSummary },
    ...overrides,
  };
}

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

test("uses one outgoing avatar and timestamp separators at five minutes and date boundaries", () => {
  const firstTime = new Date(2026, 9, 16, 23, 52).toISOString();
  const fiveMinutesLater = new Date(2026, 9, 16, 23, 57).toISOString();
  const afterMidnight = new Date(2026, 9, 17, 0, 1).toISOString();
  render(React.createElement(GroupConversation, {
    ...props(),
    messages: [
      { id: "user-a", role: "user", content: "First", createdAt: firstTime },
      { id: "assistant-a", role: "assistant", content: "Reply", createdAt: fiveMinutesLater },
      { id: "user-b", role: "user", content: "Next day", createdAt: afterMidnight },
    ],
  }));

  assert.deepEqual(
    [...document.querySelectorAll(".message-line-user .message-avatar")].map((avatar) => avatar.textContent),
    ["我", "我"],
  );
  assert.ok(document.querySelector(".conversation-header"));
  assert.equal(document.querySelector(".group-status-column"), null);
  assert.equal(document.querySelectorAll("[data-timeline-separator='time']").length, 2);
  assert.equal(document.querySelectorAll("[data-timeline-separator='date']").length, 1);
});

test("keeps the group composer after send-error feedback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === "/api/groups/group-1/messages" && init.method === "POST") {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "Group message failed" }),
      };
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${String(input)}`);
  };

  try {
    render(React.createElement(GroupConversation, props({ messages: [], processSummaries: {} })));
    fireEvent.change(screen.getByRole("textbox", { name: "Message task members" }), {
      target: { value: "A group message" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Send to group" }).closest("form"));

    const error = await screen.findByRole("alert");
    assert.equal(error.textContent, "Group message failed");
    const panel = error.closest(".conversation-panel");
    assert.ok(panel);
    assert.ok(
      panel.lastElementChild === panel.querySelector(".message-composer"),
      "group composer must remain the final panel child while feedback is visible",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shows persisted task participants in the compact header and opens task information on demand", async () => {
  const longName = "A deliberately long persisted participant name that should remain beside the task action";
  render(React.createElement(GroupConversation, props({
    contacts: [
      { id: "contact-builder", name: longName },
      { id: "contact-reviewer", name: "Reviewer" },
    ],
    runs: [{
      id: "interrupted-run",
      taskId: "task-1",
      workItemId: "work-1",
      contactId: "contact-builder",
      attempt: 1,
      status: "interrupted",
      startedAt: "2026-10-16T10:00:00.000Z",
      completedAt: null,
      workItemStatus: "interrupted",
      contactName: longName,
      title: "Continue the task",
      stuck: "not_stuck",
      lifecycleEvidence: "terminal",
    }],
  })));

  const header = document.querySelector(".conversation-header");
  assert.equal(header.querySelector("h1").textContent, "Planning");
  assert.equal(header.querySelector(".conversation-subtitle").textContent, `Task group · ${longName}, Reviewer`);
  assert.doesNotMatch(header.textContent, /developer|reviewer role|（开发）|（评审）/i);
  assert.equal(header.querySelectorAll("button").length, 1);
  assert.equal(header.querySelector("button").textContent, "Task information");
  assert.equal(header.querySelector(".conversation-subtitle").classList.contains("conversation-subtitle"), true);
  assert.equal(document.querySelector(".group-member-strip"), null);
  assert.equal(document.querySelector(".group-live-status:not(.visually-hidden)"), null);
  assert.equal(document.querySelector("[aria-label='Task information']"), null);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Task information" }));
  });
  const drawer = screen.getByRole("complementary", { name: "Task information" });
  assert.equal(drawer.hidden, false);
  assert.match(drawer.textContent, /Improve the app/);
  assert.ok(screen.getByRole("button", { name: "Retry interrupted work" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Close task information" }));
  });
  assert.equal(screen.queryByRole("complementary", { name: "Task information" }), null);
  assert.equal(screen.getByRole("button", { name: "Task information" }).getAttribute("aria-expanded"), "false");
});

test("keeps pending approval cards actionable in the task conversation with existing approval identity and payload", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/approvals/approval-1") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ approval: { ...approval(), status: "approved" } }),
      };
    }
    if (url === "/api/groups/group-1/messages") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [], runs: [], processSummaries: {}, approvals: [] }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    render(React.createElement(GroupConversation, props({
      messages: [],
      processSummaries: {},
      approvals: [approval()],
    })));

    const approvalCard = screen.getByRole("article", { name: "Tool approval approval-1" });
    assert.ok(document.querySelector(".conversation-thread").contains(approvalCard));
    assert.equal(document.querySelector(".task-information-drawer"), null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve action" }));
    });
    await waitFor(() => assert.equal(
      screen.queryByRole("article", { name: "Tool approval approval-1" }),
      null,
    ));
    assert.deepEqual(requests[0], {
      url: "/api/approvals/approval-1",
      body: { decision: "approve" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps task-description editing available from task information", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), method: init.method, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ task: { ...props().task, description: request.body.description } }),
    };
  };
  try {
    render(React.createElement(GroupConversation, props()));
    fireEvent.click(screen.getByRole("button", { name: "Task information" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit task description" }));
    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Keep the existing task contract." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    assert.deepEqual(request, {
      url: "/api/tasks/task-1",
      method: "PATCH",
      body: { description: "Keep the existing task contract." },
    });
    assert.match(screen.getByRole("complementary", { name: "Task information" }).textContent, /Keep the existing task contract\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shows one run process card on the final assistant reply and pairs its persisted handoff", () => {
  render(React.createElement(GroupConversation, props()));

  assert.equal(screen.getAllByRole("region", { name: "Process details" }).length, 2);
  const firstAssistant = document.getElementById("message-assistant-1");
  const lastAssistant = document.getElementById("message-assistant-2");
  assert.equal(firstAssistant.querySelector('[aria-label="Process details"]'), null);
  assert.ok(lastAssistant.querySelector('[aria-label="Process details"]'));
  assert.match(lastAssistant.textContent, /@Builder → @Reviewer: Review the change for regressions\./);
  assert.equal(document.getElementById("message-handoff-1").textContent, "");
  assert.ok(lastAssistant.contains(document.getElementById("message-handoff-1")));
  assert.ok(lastAssistant.previousElementSibling.matches(".message-avatar"));
  const replyText = lastAssistant.querySelector(".message-content > p");
  const handoffText = lastAssistant.querySelector(".message-handoff-context .process-handoff p");
  const processSummary = lastAssistant.querySelector(".process-details-summary");
  assert.ok(replyText.compareDocumentPosition(handoffText) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(
    handoffText.compareDocumentPosition(processSummary) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.doesNotMatch(lastAssistant.textContent, /(?:src|test|docs)\/[\w./-]+/);
  assert.equal(
    screen.getAllByRole("button", { name: "Show process details" }).length,
    2,
  );
});

test("keeps an unmatched structured handoff as its own message and preserves its fragment target", () => {
  render(React.createElement(GroupConversation, {
    ...props({
      messages: [{
        id: "handoff-without-reply",
        role: "handoff",
        content: "@Builder → @Reviewer: Inspect the stored report.",
        metadata: {
          sourceRunId: "missing-run",
          fromContactId: "contact-builder",
          toContactId: "contact-reviewer",
        },
        createdAt: "2026-10-16T10:00:00.000Z",
      }],
      processSummaries: {},
    }),
  }));

  const handoff = document.getElementById("message-handoff-without-reply");
  assert.ok(handoff);
  assert.match(handoff.textContent, /@Builder → @Reviewer: Inspect the stored report\./);
  assert.equal(screen.queryByRole("region", { name: "Process details" }), null);
});

test("replaces run process summaries with the group messages refresh response", async () => {
  const originalFetch = globalThis.fetch;
  let refreshCount = 0;
  globalThis.fetch = async () => {
    refreshCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{
          id: "assistant-refresh",
          role: "assistant",
          content: "Refreshed reply",
          metadata: { runId: "run-1", contactId: "contact-builder" },
          createdAt: "2026-10-16T10:02:00.000Z",
        }],
        runs: [],
        processSummaries: refreshCount === 1 ? { "run-1": processSummary } : {},
        approvals: [],
      }),
    };
  };
  try {
    render(React.createElement(GroupConversation, props({
      messages: [{
        id: "assistant-refresh",
        role: "assistant",
        content: "Refreshed reply",
        metadata: { runId: "run-1", contactId: "contact-builder" },
        createdAt: "2026-10-16T10:02:00.000Z",
      }],
      processSummaries: {},
    })));

    assert.equal(screen.queryByRole("region", { name: "Process details" }), null);
    fireEvent.click(screen.getByRole("button", { name: "Task information" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
    await screen.findByRole("region", { name: "Process details" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
    await screen.findByText("Refreshed reply");
    assert.equal(screen.queryByRole("region", { name: "Process details" }), null);
    assert.equal(refreshCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves explicit mention text when dispatching a group message", async () => {
  const originalFetch = globalThis.fetch;
  let postedBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "/api/groups/group-1/messages" && init.method === "POST") {
      postedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          message: {
            id: "sent-1",
            role: "user",
            content: postedBody.content,
            createdAt: "2026-10-16T10:10:00.000Z",
          },
        }),
      };
    }
    if (url === "/api/groups/group-1/messages") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [], runs: [], processSummaries: {}, approvals: [] }),
      };
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
  };
  try {
    render(React.createElement(GroupConversation, props({ messages: [], processSummaries: {} })));
    const input = screen.getByRole("textbox", { name: "Message task members" });
    fireEvent.change(input, { target: { value: "Please @Reviewer inspect the persisted report." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to group" }));
    });

    assert.deepEqual(postedBody, { content: "Please @Reviewer inspect the persisted report." });
    assert.equal(screen.getByText(/Mentioned members only/).textContent, "Mentioned members only · no inferred delegation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
