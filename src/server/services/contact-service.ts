import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Contact } from "../domain/types.ts";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";
import { createAgentRepository } from "../db/repositories/agent-repository.ts";
import { getPiModelRuntime } from "../pi/model-runtime.ts";

type ContactModelRuntime = Pick<
  import("@earendil-works/pi-coding-agent").ModelRuntime,
  "getAvailable"
>;

export interface CreateContactInput {
  name: string;
  description: string;
  modelProvider: string;
  modelId: string;
}

export interface TaskDraft {
  name: string;
  description: string;
  contactIds: string[];
}

interface ContactServiceOptions {
  runtime: ContactModelRuntime;
  idFactory?: () => string;
}

export function createContactService(
  db: Database.Database,
  options: ContactServiceOptions,
) {
  const contacts = createAgentRepository(db);
  const idFactory = options.idFactory ?? randomUUID;

  return {
    async createContact(input: CreateContactInput): Promise<Contact> {
      const name = input.name.trim();
      const modelId = input.modelId.trim();
      if (!name) throw new Error("Contact name is required");
      if (input.modelProvider !== "github-copilot") {
        throw new Error("AChat POC v1 supports only github-copilot contact models");
      }
      if (!modelId) throw new Error("Contact model is required");
      const models = await options.runtime.getAvailable("github-copilot");
      const selectedModel = models.find(
        (model) => model.provider === "github-copilot" && model.id === modelId,
      );
      if (!selectedModel) {
        throw new Error(`Model ${modelId} is not currently available from github-copilot`);
      }
      return contacts.createContact({
        id: idFactory(),
        name,
        description: input.description.trim(),
        modelProvider: "github-copilot",
        modelId: selectedModel.id,
      });
    },
    getContact(contactId: string): Contact {
      const contact = contacts.getContact(contactId);
      if (!contact) throw new Error(`Contact not found: ${contactId}`);
      return contact;
    },
    listContacts(): Contact[] {
      return contacts.listContacts();
    },
    proposeLongTask(contactId: string, sourceMessage: string): TaskDraft {
      const contact = this.getContact(contactId);
      const description = sourceMessage.trim();
      if (!description) throw new Error("A source message is required to draft a task");
      const firstLine = description.split(/\r?\n/, 1)[0].trim();
      const name = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
      return { name: name || `Work for ${contact.name}`, description, contactIds: [contact.id] };
    },
  };
}

async function withContactService<T>(
  operation: (service: ReturnType<typeof createContactService>) => Promise<T> | T,
): Promise<T> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return await operation(createContactService(db, {
      runtime: await getPiModelRuntime(),
    }));
  } finally {
    db.close();
  }
}

export function createContact(input: CreateContactInput): Promise<Contact> {
  return withContactService((service) => service.createContact(input));
}

export function getContact(contactId: string): Promise<Contact> {
  return withContactService((service) => service.getContact(contactId));
}

export function listContacts(): Promise<Contact[]> {
  return withContactService((service) => service.listContacts());
}

export function proposeLongTask(contactId: string, sourceMessage: string): Promise<TaskDraft> {
  return withContactService((service) => service.proposeLongTask(contactId, sourceMessage));
}
