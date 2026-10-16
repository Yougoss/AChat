"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Contact } from "../server/domain/types.ts";

interface WorkspaceShellProps {
  activeContactId?: string;
  children?: React.ReactNode;
}

interface ModelChoice {
  provider: string;
  modelId: string;
  name: string;
}

export function WorkspaceShell({ activeContactId, children }: WorkspaceShellProps) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/contacts").then((response) => response.json()),
      fetch("/api/models").then((response) => response.json()),
    ]).then(([contactResult, modelResult]) => {
      if (!active) return;
      if (contactResult.error) throw new Error(contactResult.error);
      if (modelResult.error) throw new Error(modelResult.error);
      const availableModels = modelResult.models ?? [];
      setContacts(contactResult.contacts ?? []);
      setModels(availableModels);
      setModelId((current) => current || availableModels[0]?.modelId || "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load contacts");
    }).finally(() => {
      if (active) setLoadingContacts(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelId.trim()) {
      setError("Choose a model before creating a contact.");
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          modelProvider: "github-copilot",
          modelId,
        }),
      });
      const result = await response.json() as { contact?: Contact; error?: string };
      if (!response.ok || !result.contact) {
        throw new Error(result.error ?? "Unable to create contact");
      }
      router.push(`/contacts/${encodeURIComponent(result.contact.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create contact");
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="contact-rail" aria-label="Contact navigation">
        <div className="rail-brand">
          <Link href="/" aria-label="AChat workspace home">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span>AChat<span className="brand-subtitle">dispatch desk</span></span>
          </Link>
        </div>
        <div className="roster-heading">
          <div>
            <p className="eyebrow">Roster</p>
            <h2>Contacts</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={creating ? "Close new contact form" : "Add contact"}
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "×" : "+"}
          </button>
        </div>
        <nav className="contact-roster" aria-label="Contact roster">
          {loadingContacts ? <p className="roster-note">Loading contacts…</p> : null}
          {!loadingContacts && !contacts.length ? (
            <p className="roster-note">No contacts yet. Add one to open a conversation.</p>
          ) : null}
          {contacts.map((contact) => (
            <Link
              className={`contact-link ${activeContactId === contact.id ? "is-active" : ""}`}
              href={`/contacts/${encodeURIComponent(contact.id)}`}
              key={contact.id}
              aria-current={activeContactId === contact.id ? "page" : undefined}
            >
              <span className="contact-avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</span>
              <span className="contact-link-copy">
                <strong>{contact.name}</strong>
                <span>{contact.description || "Available for dispatch"}</span>
              </span>
              <span className="contact-presence" aria-label="Ready" />
            </Link>
          ))}
        </nav>
        {creating ? (
          <form className="contact-create-form" onSubmit={(event) => void createContact(event)}>
            <p className="eyebrow">New contact</p>
            <label className="field-label" htmlFor="new-contact-name">
              Name
              <input id="new-contact-name" value={name} onChange={(event) => setName(event.currentTarget.value)} required />
            </label>
            <label className="field-label" htmlFor="new-contact-description">
              Description
              <textarea
                id="new-contact-description"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                rows={2}
              />
            </label>
            <label className="field-label" htmlFor="new-contact-model">
              Model
              <select id="new-contact-model" value={modelId} onChange={(event) => setModelId(event.currentTarget.value)} required>
                <option value="">Choose a model</option>
                {models.map((model) => (
                  <option key={`${model.provider}:${model.modelId}`} value={model.modelId}>
                    {model.name} · {model.modelId}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-primary" type="submit" disabled={!models.length}>Create contact</button>
          </form>
        ) : null}
        {error ? <p className="form-error rail-error" role="alert">{error}</p> : null}
        <div className="rail-footer">
          <Link href="/settings/projects">Registered projects</Link>
          {activeContactId ? (
            <Link href={`/settings/contacts/${encodeURIComponent(activeContactId)}`}>Active contact settings</Link>
          ) : null}
          <span className="evidence-meta">Local workspace · evidence stays scoped</span>
        </div>
      </aside>
      <div className="workspace-content">
        {children ?? (
          <main className="empty-workspace">
            <p className="eyebrow">Dispatch workbench</p>
            <h1>Select a contact to open the conversation.</h1>
            <p>Choose a person from the roster or create a contact to begin.</p>
          </main>
        )}
      </div>
    </div>
  );
}
