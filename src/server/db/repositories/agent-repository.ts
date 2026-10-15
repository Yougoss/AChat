import type Database from "better-sqlite3";
import type { Agent, Contact } from "../../domain/types.ts";
import { asRecord } from "./repository-utils.ts";

interface ContactRow {
  id: string;
  name: string;
  description: string;
  modelProvider: string;
  modelId: string;
}

export function createAgentRepository(db: Database.Database) {
  function getContact(id: string): Contact | undefined {
    const row = db.prepare(`
      SELECT contacts.id, contacts.name, contacts.description,
             agents.model_provider AS modelProvider, agents.model_id AS modelId
      FROM contacts JOIN agents ON agents.id = contacts.agent_id
      WHERE contacts.id = ?
    `).get(id);
    const contact = asRecord<ContactRow | undefined>(row);
    return contact ? { ...contact } : undefined;
  }

  return {
    createAgent(agent: Agent): Agent {
      db.prepare(`
        INSERT INTO agents (id, model_provider, model_id) VALUES (?, ?, ?)
      `).run(agent.id, agent.modelProvider, agent.modelId);
      return { ...agent };
    },
    getAgent(id: string): Agent | undefined {
      const row = db.prepare(`
        SELECT id, model_provider AS modelProvider, model_id AS modelId
        FROM agents WHERE id = ?
      `).get(id);
      return row ? { ...asRecord<Agent>(row) } : undefined;
    },
    createContact(
      contact: Contact,
      agentId = contact.id,
    ): Contact {
      const insert = db.transaction(() => {
        if (!db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agentId)) {
          db.prepare(`
            INSERT INTO agents (id, model_provider, model_id) VALUES (?, ?, ?)
          `).run(agentId, contact.modelProvider, contact.modelId);
        }
        db.prepare(`
          INSERT INTO contacts (id, agent_id, name, description) VALUES (?, ?, ?, ?)
        `).run(contact.id, agentId, contact.name, contact.description);
      });
      insert();
      return getContact(contact.id)!;
    },
    getContact,
    listContacts(): Contact[] {
      return db.prepare(`
        SELECT contacts.id, contacts.name, contacts.description,
               agents.model_provider AS modelProvider, agents.model_id AS modelId
        FROM contacts JOIN agents ON agents.id = contacts.agent_id
        ORDER BY contacts.id
      `).all().map((row) => ({ ...asRecord<ContactRow>(row) }));
    },
    getContactAgentId(contactId: string): string | undefined {
      const row = db.prepare("SELECT agent_id AS agentId FROM contacts WHERE id = ?").get(contactId);
      return row ? asRecord<{ agentId: string }>(row).agentId : undefined;
    },
  };
}
