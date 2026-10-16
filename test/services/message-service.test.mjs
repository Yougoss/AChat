import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact } from "../db/helpers.mjs";
import { createContactMessageService } from "../../src/server/services/message-service.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createTraceExtension } from "../../src/server/pi/trace-extension.ts";

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

test("persists the exact trace sequence range emitted by the prompt for its assistant reply", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db);
  const messages = createMessageRepository(db);
  const conversation = messages.createConversation({
    id: "private-conversation",
    groupId: null,
    taskId: null,
    contactId: "contact-1",
    kind: "private",
  });
  const mapping = createSessionRepository(db).createSessionMapping({
    id: "private-mapping",
    contactId: "contact-1",
    taskId: null,
    conversationId: conversation.id,
    kind: "private",
    piSessionId: "pi-private",
    sessionFile: "sessions/contact-1/private.jsonl",
  });
  const trace = createTraceExtension(db);
  await trace.recordSessionEvent(mapping, {
    type: "message_end",
    message: {
      role: "assistant",
      content: "The same answer",
      usage: { input: 900, output: 700 },
    },
  });
  const afterSequence = db.prepare("SELECT MAX(sequence) AS value FROM trace_records").get().value;
  const session = {
    messages: [{
      role: "assistant",
      content: [{ type: "text", text: "The same answer" }],
    }],
    async prompt(content) {
      assert.equal(content, "Question?");
      await trace.recordSessionEvent(mapping, {
        type: "message_start",
        message: { role: "user", content: [{ type: "text", text: content }] },
      });
      session.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "The same answer" }],
      });
      await trace.recordSessionEvent(mapping, {
        type: "message_end",
        message: {
          role: "assistant",
          model: "current-model",
          content: [{ type: "text", text: "The same answer" }],
          usage: { input: 3, output: 2 },
        },
      });
    },
  };
  const service = createContactMessageService(db, {
    createContactSession: async () => session,
    idFactory: (() => {
      const ids = ["user-message", "assistant-message"];
      return () => ids.shift();
    })(),
  });

  const exchange = await service.sendContactMessage("contact-1", { content: "Question?" });
  const throughSequence = db.prepare("SELECT MAX(sequence) AS value FROM trace_records").get().value;

  assert.deepEqual(exchange.assistantMessage.metadata.processTraceRange, {
    afterSequence,
    throughSequence,
  });
});

test("persists an empty trace range when a mapped private prompt emits no trace records", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedContact(db);
  const conversation = createMessageRepository(db).createConversation({
    id: "private-conversation",
    groupId: null,
    taskId: null,
    contactId: "contact-1",
    kind: "private",
  });
  createSessionRepository(db).createSessionMapping({
    id: "private-mapping",
    contactId: "contact-1",
    taskId: null,
    conversationId: conversation.id,
    kind: "private",
    piSessionId: "pi-private",
    sessionFile: "sessions/contact-1/private.jsonl",
  });
  const service = createContactMessageService(db, {
    createContactSession: async () => {
      const session = {
        messages: [],
        async prompt() {
          session.messages.push({ role: "assistant", content: "No trace available" });
        },
      };
      return session;
    },
    idFactory: (() => {
      const ids = ["user-message", "assistant-message"];
      return () => ids.shift();
    })(),
  });

  const exchange = await service.sendContactMessage("contact-1", { content: "Question?" });

  assert.deepEqual(exchange.assistantMessage.metadata.processTraceRange, {
    afterSequence: 0,
    throughSequence: 0,
  });
});
