import assert from "node:assert/strict";
import test from "node:test";
import { createTraceExtension } from "../../src/server/pi/trace-extension.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";
import { createTestDatabase, seedContact } from "../db/helpers.mjs";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";

function seedPrivateSession(db) {
  seedContact(db);
  createMessageRepository(db).createConversation({
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
    conversationId: "private-conversation",
    kind: "private",
    piSessionId: "pi-private",
    sessionFile: "/private/session.jsonl",
  });
  return createSessionRepository(db).getSessionMappingById("private-mapping");
}

test("correlates provider request bodies, provider events, final messages, and Pi events", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const scope = seedPrivateSession(db);
  const trace = createTraceExtension(db);

  await trace.recordProviderRequest(scope, "call-1", { model: "test-model", prompt: "synthetic prompt" });
  await trace.recordProviderEvent(scope, "call-1", { type: "content_delta", text: "synthetic reply" });
  await trace.recordSessionEvent(scope, {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "synthetic reply" }] },
  });
  await trace.recordSessionEvent(scope, { type: "agent_settled", aborted: false });
  await trace.recordAchatEvent(scope, "message_persisted", { messageId: "message-1" });

  const page = await createTraceQueryService(db)
    .readContactSession("contact-1", "pi-private");
  assert.deepEqual(page.items.map((item) => item.type), [
    "provider_request",
    "provider_event",
    "final_message",
    "pi_event",
    "achat_event",
  ]);
  assert.ok(page.items.every((item) => item.callId === "call-1"));
});

test("captures provider request and stream hooks with a shared request correlation ID", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const scope = seedPrivateSession(db);
  const trace = createTraceExtension(db);
  const runtime = {
    stream(_model, _context, options) {
      return (async () => {
        await options.onPayload({ model: "test-model", messages: [{ role: "user", content: "synthetic" }] });
        await options.onResponse({ status: 200, headers: { authorization: "synthetic-secret" } });
        await options.onProviderStreamEvent({ type: "text_delta", text: "synthetic response" });
      })();
    },
  };

  await trace.instrumentModelRuntime(runtime, scope).stream({}, {});
  const page = await createTraceQueryService(db).readContactSession("contact-1", "pi-private");
  assert.deepEqual(page.items.map((item) => item.type), [
    "provider_request",
    "provider_event",
    "provider_event",
  ]);
  assert.ok(page.items.every((item) => item.callId && item.callId === page.items[0].callId));
  assert.doesNotMatch(JSON.stringify(page.items), /synthetic-secret|authorization/i);
});

test("excludes auth headers and credential-shaped fields from persisted provider traces", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const scope = seedPrivateSession(db);
  const trace = createTraceExtension(db);
  const syntheticCredential = "synthetic-secret-do-not-store";

  await trace.recordProviderRequest(scope, "call-secret", {
    url: "https://provider.invalid/chat",
    headers: {
      authorization: `Bearer ${syntheticCredential}`,
      "x-api-key": syntheticCredential,
      "content-type": "application/json",
    },
    body: { prompt: "synthetic input", apiKey: syntheticCredential },
  });

  const stored = db.prepare("SELECT payload_json FROM trace_records").all()
    .map(({ payload_json }) => payload_json).join("\n");
  assert.doesNotMatch(stored, /authorization|x-api-key|synthetic-secret-do-not-store/i);
  assert.match(stored, /synthetic input/);
});
