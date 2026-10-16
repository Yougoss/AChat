import path from "node:path";
import type Database from "better-sqlite3";
import type { Contact } from "../domain/types.ts";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";
import { createAgentRepository } from "../db/repositories/agent-repository.ts";
import { getPiModelRuntime } from "../pi/model-runtime.ts";

type ContactModelRuntime = Pick<ModelRuntime, "getAvailable">;
type ModelRuntime = import("@earendil-works/pi-coding-agent").ModelRuntime;

export function createModelService(db: Database.Database, runtime: ContactModelRuntime) {
  const contacts = createAgentRepository(db);

  function getContactModel(contactId: string): Contact {
    const contact = contacts.getContact(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    return contact;
  }

  return {
    getContactModel,
    async setContactModel(contactId: string, modelId: string): Promise<Contact> {
      const contact = getContactModel(contactId);
      const models = await runtime.getAvailable("github-copilot");
      const selectedModel = models.find(
        (model) => model.provider === "github-copilot" && model.id === modelId,
      );
      if (!selectedModel) {
        throw new Error(`Model ${modelId} is not currently available from github-copilot`);
      }
      const agentId = contacts.getContactAgentId(contactId);
      if (!agentId) throw new Error(`Contact agent not found: ${contactId}`);
      db.prepare(`
        UPDATE agents
        SET model_provider = 'github-copilot', model_id = ?
        WHERE id = ?
      `).run(selectedModel.id, agentId);
      return contacts.getContact(contact.id)!;
    },
  };
}

async function withDefaultModelService<T>(
  operation: (service: ReturnType<typeof createModelService>) => Promise<T> | T,
): Promise<T> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return await operation(createModelService(db, await getPiModelRuntime()));
  } finally {
    db.close();
  }
}

export function getContactModel(contactId: string): Promise<Contact> {
  return withDefaultModelService((service) => service.getContactModel(contactId));
}

export function setContactModel(contactId: string, modelId: string): Promise<Contact> {
  return withDefaultModelService((service) => service.setContactModel(contactId, modelId));
}
