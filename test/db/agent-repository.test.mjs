import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./helpers.mjs";
import { createAgentRepository } from "../../src/server/db/repositories/agent-repository.ts";

test("maps a user-facing contact ID to its stable agent identity", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const repository = createAgentRepository(db);
  repository.createAgent({
    id: "agent-stable-1",
    modelProvider: "test-provider",
    modelId: "test-model",
  });
  const contact = repository.createContact({
    id: "contact-ui-1",
    name: "Builder",
    description: "Project builder",
    modelProvider: "contact-provider",
    modelId: "contact-model",
  }, "agent-stable-1");

  assert.equal(contact.id, "contact-ui-1");
  assert.equal(contact.modelProvider, "test-provider");
  assert.equal(contact.modelId, "test-model");
  assert.equal(repository.getContactAgentId(contact.id), "agent-stable-1");
  assert.deepEqual(repository.getContact(contact.id), contact);
});
