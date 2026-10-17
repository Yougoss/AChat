"use client";

import { useEffect, useState } from "react";
import { ModelSelector, type SelectableModel } from "../../../../components/ModelSelector.tsx";
import { ProviderAuthControls } from "../../../../components/ProviderAuthControls.tsx";
import { WorkspaceShell } from "../../../../components/WorkspaceShell.tsx";
import type { Contact } from "../../../../server/domain/types.ts";

export default function ContactSettingsPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const [contactId, setContactId] = useState("");
  const [contact, setContact] = useState<Contact | null>(null);
  const [models, setModels] = useState<SelectableModel[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void params.then(({ contactId: id }) => {
      if (!active) return;
      setContactId(id);
      return Promise.all([
        fetch(`/api/contacts/${encodeURIComponent(id)}`).then((response) => response.json()),
        fetch("/api/models").then((response) => response.json()),
      ]).then(([contactResult, modelResult]) => {
        if (!active) return;
        if (contactResult.error) throw new Error(contactResult.error);
        if (modelResult.error) throw new Error(modelResult.error);
        setContact(contactResult.contact);
        setModels(modelResult.models ?? []);
      });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load contact settings");
    });
    return () => {
      active = false;
    };
  }, [params]);

  return (
    <WorkspaceShell activeContactId={contactId || undefined}>
      <main className="settings-page settings-contact-page">
        <header className="page-heading">
          <p className="eyebrow">Contact settings</p>
          <h1>{contact ? contact.name : "Loading contact…"}</h1>
          <p>Model and provider access are scoped to this workspace contact.</p>
        </header>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {contact ? (
          <>
            <ModelSelector
              contactId={contact.id}
              models={models}
              currentModelId={contact.modelId}
              onModelSaved={(model) => setContact((current) => current
                ? { ...current, modelProvider: model.provider, modelId: model.modelId }
                : current)}
            />
            <ProviderAuthControls />
          </>
        ) : null}
      </main>
    </WorkspaceShell>
  );
}
