import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "../db/helpers.mjs";
import { createSearchService } from "../../src/server/services/search-service.ts";

function insertContact(db, { id, name, description = "" }) {
  db.prepare(
    "INSERT INTO agents (id, model_provider, model_id) VALUES (?, 'test', 'model')",
  ).run(`agent-${id}`);
  db.prepare(
    "INSERT INTO contacts (id, agent_id, name, description) VALUES (?, ?, ?, ?)",
  ).run(id, `agent-${id}`, name, description);
}

function insertProject(db) {
  db.prepare(
    "INSERT INTO projects (id, name, root_path) VALUES ('project-search', 'Search', '/search')",
  ).run();
}

function insertTask(db, { id, groupId, name, groupDescription = "", description, members }) {
  db.prepare(
    "INSERT INTO groups (id, name, description) VALUES (?, ?, ?)",
  ).run(groupId, name, groupDescription);
  db.prepare(`
    INSERT INTO tasks (id, group_id, project_id, description, status)
    VALUES (?, ?, 'project-search', ?, 'open')
  `).run(id, groupId, description);
  for (const contactId of members) {
    db.prepare(
      "INSERT INTO task_members (task_id, contact_id) VALUES (?, ?)",
    ).run(id, contactId);
  }
  db.prepare(`
    INSERT INTO conversations (id, group_id, task_id, kind)
    VALUES (?, ?, ?, 'task')
  `).run(`conversation-${id}`, groupId, id);
}

function insertPrivateConversation(db, contactId) {
  const conversationId = `private-${contactId}`;
  db.prepare(`
    INSERT INTO conversations (id, contact_id, kind)
    VALUES (?, ?, 'private')
  `).run(conversationId, contactId);
  return conversationId;
}

function insertMessage(db, { id, conversationId, content, createdAt, role = "user", metadata = "{}" }) {
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, conversationId, role, content, metadata, createdAt);
}

function seedMetadataFixture(db) {
  insertContact(db, {
    id: "contact-ada",
    name: "Ada Lovelace",
    description: "Reliable systems architect",
  });
  insertProject(db);
  const privateConversation = insertPrivateConversation(db, "contact-ada");
  insertMessage(db, {
    id: "private-hit",
    conversationId: privateConversation,
    content: "Discuss the launch plan",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
  insertTask(db, {
    id: "task-orchid",
    groupId: "group-orchid",
    name: "Orchid migration",
    groupDescription: "Infrastructure sprint",
    description: "Document recovery workflows",
    members: ["contact-ada"],
  });
  insertMessage(db, {
    id: "task-hit",
    conversationId: "conversation-task-orchid",
    content: "Preserve the conversation context",
    createdAt: "2026-10-16T10:01:00.000Z",
  });
}

test("searches contact, group, task metadata and user-visible messages with message locations", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const { searchVisibleMessages } = createSearchService(db);
  seedMetadataFixture(db);
  assert.deepEqual(await searchVisibleMessages(" \t "), []);

  const contactHit = (await searchVisibleMessages("Lovelace")).find(
    (result) => result.ownerType === "contact" && result.ownerId === "contact-ada",
  );
  assert.ok(contactHit);
  assert.equal(contactHit.messageId, "private-hit");
  assert.equal(contactHit.href, "/contacts/contact-ada#message-private-hit");
  assert.match(contactHit.preview, /Discuss the launch plan/);

  assert.ok((await searchVisibleMessages("Reliable")).some(
    (result) => result.ownerType === "contact" && result.ownerId === "contact-ada",
  ));
  const groupHit = (await searchVisibleMessages("Orchid")).find(
    (result) => result.ownerType === "group" && result.ownerId === "group-orchid",
  );
  assert.ok(groupHit);
  assert.equal(groupHit.title, "Orchid migration");
  assert.equal(groupHit.messageId, "task-hit");
  assert.equal(groupHit.href, "/groups/group-orchid#message-task-hit");
  assert.match(groupHit.preview, /Preserve the conversation context/);
  assert.ok((await searchVisibleMessages("Infrastructure")).some(
    (result) => result.ownerType === "group" && result.ownerId === "group-orchid",
  ));
  assert.ok((await searchVisibleMessages("recovery")).some(
    (result) => result.ownerType === "group" && result.ownerId === "group-orchid",
  ));
  assert.ok((await searchVisibleMessages("conversation context")).some(
    (result) => result.messageId === "task-hit",
  ));
});

test("ranks by matching message count, most recent match, then exact phrase weight", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const { searchVisibleMessages } = createSearchService(db);
  insertContact(db, { id: "contact-rank", name: "Rank contact" });
  insertProject(db);
  insertTask(db, {
    id: "task-many",
    groupId: "group-many",
    name: "Many matches",
    description: "",
    members: ["contact-rank"],
  });
  insertTask(db, {
    id: "task-exact",
    groupId: "group-exact",
    name: "Exact phrase",
    description: "",
    members: ["contact-rank"],
  });
  insertTask(db, {
    id: "task-recent",
    groupId: "group-recent",
    name: "Recent phrase",
    description: "",
    members: ["contact-rank"],
  });
  insertMessage(db, {
    id: "many-one",
    conversationId: "conversation-task-many",
    content: "crystal appeared here",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  insertMessage(db, {
    id: "many-two",
    conversationId: "conversation-task-many",
    content: "harbor also appeared",
    createdAt: "2026-10-16T09:01:00.000Z",
  });
  insertMessage(db, {
    id: "exact-match",
    conversationId: "conversation-task-exact",
    content: "crystal harbor in one phrase",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
  insertMessage(db, {
    id: "recent-non-exact",
    conversationId: "conversation-task-recent",
    content: "crystal light crossed the harbor",
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const results = await searchVisibleMessages("crystal harbor");
  assert.deepEqual(
    results.slice(0, 3).map(({ ownerId }) => ownerId),
    ["group-many", "group-exact", "group-recent"],
  );
  assert.equal(results[0].matchingMessageCount, 2);
  assert.equal(results[1].matchingMessageCount, 1);
});

test("applies contact and task-member scope before generating results", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const { searchVisibleMessages } = createSearchService(db);
  insertContact(db, { id: "contact-one", name: "Contact One" });
  insertContact(db, { id: "contact-two", name: "Contact Two" });
  insertProject(db);
  const oneConversation = insertPrivateConversation(db, "contact-one");
  const twoConversation = insertPrivateConversation(db, "contact-two");
  insertMessage(db, {
    id: "private-one",
    conversationId: oneConversation,
    content: "shared keyword in one private chat",
    createdAt: "2026-10-16T09:00:00.000Z",
  });
  insertMessage(db, {
    id: "private-two",
    conversationId: twoConversation,
    content: "shared keyword in another private chat",
    createdAt: "2026-10-16T10:00:00.000Z",
  });
  insertTask(db, {
    id: "task-one",
    groupId: "group-one",
    name: "One task",
    description: "",
    members: ["contact-one"],
  });
  insertMessage(db, {
    id: "task-one-message",
    conversationId: "conversation-task-one",
    content: "shared keyword inside one member task",
    createdAt: "2026-10-16T08:00:00.000Z",
  });
  insertTask(db, {
    id: "task-two",
    groupId: "group-two",
    name: "Other task",
    description: "",
    members: ["contact-two"],
  });
  insertMessage(db, {
    id: "task-two-message",
    conversationId: "conversation-task-two",
    content: "shared keyword outside the selected member scope",
    createdAt: "2026-10-16T11:00:00.000Z",
  });

  const scoped = await searchVisibleMessages("shared", "contact-one");
  assert.deepEqual(
    scoped.map(({ messageId }) => messageId).sort(),
    ["private-one", "task-one-message"],
  );
  assert.ok((await searchVisibleMessages("shared")).some(
    (result) => result.messageId === "private-two",
  ));
  assert.ok((await searchVisibleMessages("shared")).some(
    (result) => result.messageId === "task-two-message",
  ));
});

test("does not search raw provider traces or non-visible message metadata", async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const { searchVisibleMessages } = createSearchService(db);
  insertContact(db, { id: "contact-trace", name: "Trace contact" });
  const conversationId = insertPrivateConversation(db, "contact-trace");
  insertMessage(db, {
    id: "visible-message",
    conversationId,
    content: "Only visible conversation text",
    createdAt: "2026-10-16T10:00:00.000Z",
    metadata: JSON.stringify({ privateMetadata: "metadata-only-sentinel" }),
  });
  db.prepare(`
    INSERT INTO pi_session_mappings (
      id, contact_id, task_id, conversation_id, kind, pi_session_id, session_file
    ) VALUES (
      'mapping-trace', 'contact-trace', NULL, ?, 'private', 'pi-session-trace', '/sessions/trace.jsonl'
    )
  `).run(conversationId);
  db.prepare(`
    INSERT INTO trace_records (id, mapping_id, type, payload_json)
    VALUES ('raw-request', 'mapping-trace', 'provider_request', ?)
  `).run(JSON.stringify({ prompt: "raw-trace-only-sentinel" }));

  assert.deepEqual(await searchVisibleMessages("metadataonlysentinel"), []);
  assert.deepEqual(await searchVisibleMessages("rawtraceonlysentinel"), []);
});
