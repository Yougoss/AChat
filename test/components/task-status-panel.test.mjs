import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { TaskStatusPanel } from "../../src/components/TaskStatusPanel.tsx";

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
