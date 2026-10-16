import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact } from "../db/helpers.mjs";
import { createContactMessageService } from "../../src/server/services/message-service.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";

test("persists a contact exchange and invokes only that contact's contact-chat session", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db, "contact-one");
  seedContact(db, "contact-two");
  const invocations = [];
  const service = createContactMessageService(db, {
    createContactSession: async (contactId, options) => {
      invocations.push({ contactId, options });
      const session = {
        messages: [],
        async prompt(content) {
          assert.equal(content, "Summarize the evidence.");
          session.messages.push({
            role: "assistant",
            content: [{ type: "text", text: "The evidence supports that conclusion." }],
          });
        },
      };
      return session;
    },
    idFactory: (() => {
      const ids = ["private-conversation", "user-message", "assistant-message"];
      return () => ids.shift();
    })(),
    now: (() => {
      let tick = 0;
      return () => new Date(Date.parse("2026-10-16T00:00:00.000Z") + tick++).toISOString();
    })(),
  });

  const exchange = await service.sendContactMessage("contact-one", {
    content: "Summarize the evidence.",
  });

  assert.deepEqual(invocations, [{
    contactId: "contact-one",
    options: { sessionKind: "contact_chat" },
  }]);
  assert.equal(exchange.userMessage.content, "Summarize the evidence.");
  assert.equal(exchange.assistantMessage.content, "The evidence supports that conclusion.");
  assert.deepEqual(
    createMessageRepository(db).listMessages(exchange.userMessage.conversationId)
      .map(({ role, content }) => [role, content]),
    [
      ["user", "Summarize the evidence."],
      ["assistant", "The evidence supports that conclusion."],
    ],
  );
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM conversations WHERE kind = 'private' AND contact_id = 'contact-two'",
  ).get().count, 0);
});

test("rejects blank contact messages before opening a Pi session", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db);
  let openedSession = false;
  const service = createContactMessageService(db, {
    createContactSession: async () => {
      openedSession = true;
      return { async prompt() {}, messages: [] };
    },
  });

  await assert.rejects(service.sendContactMessage("contact-1", { content: "  " }), /message cannot be empty/i);
  assert.equal(openedSession, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 0);
});
