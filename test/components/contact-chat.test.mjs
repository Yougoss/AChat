import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ContactChat } from "../../src/components/ContactChat.tsx";

test("renders contact-scoped conversation controls and a draft-only task suggestion action", () => {
  const html = renderToStaticMarkup(React.createElement(ContactChat, {
    contact: { id: "contact-1", name: "Planner", description: "Plans work" },
    messages: [{ id: "message-1", role: "assistant", content: "Ready to review evidence." }],
  }));

  assert.match(html, /aria-label="Message Planner"/);
  assert.match(html, /Send message/);
  assert.match(html, /Ready to review evidence\./);
  assert.match(html, /Draft a task from this conversation/);
  assert.doesNotMatch(html, /Dispatch|Start run/i);
});
