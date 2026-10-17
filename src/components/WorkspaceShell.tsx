"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Contact } from "../server/domain/types.ts";
import type { ConversationListItem } from "../server/services/conversation-list-service.ts";
import { SearchBox } from "./SearchBox.tsx";

interface WorkspaceShellProps {
  activeContactId?: string;
  activeGroupId?: string;
  children?: React.ReactNode;
}

interface ModelChoice {
  provider: string;
  modelId: string;
  name: string;
}

type ConversationFilter = "recent" | "contact" | "task";

export function WorkspaceShell({
  activeContactId,
  activeGroupId,
  children,
}: WorkspaceShellProps) {
  const router = useRouter();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [filter, setFilter] = useState<ConversationFilter>("recent");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/conversations").then((response) => response.json()),
      fetch("/api/models").then((response) => response.json()),
    ]).then(([conversationResult, modelResult]) => {
      if (!active) return;
      if (conversationResult.error) throw new Error(conversationResult.error);
      if (modelResult.error) throw new Error(modelResult.error);
      const availableModels = modelResult.models ?? [];
      setItems(conversationResult.items ?? []);
      setModels(availableModels);
      setModelId((current) => current || availableModels[0]?.modelId || "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load conversations");
    }).finally(() => {
      if (active) setLoadingConversations(false);
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
      const contact = result.contact;
      setItems((current) => [
        {
          kind: "contact",
          id: contact.id,
          title: contact.name,
          preview: "",
          updatedAt: new Date().toISOString(),
          href: `/contacts/${encodeURIComponent(contact.id)}`,
          avatarText: contact.name.trim().slice(0, 1).toLocaleUpperCase() || "?",
          unreadCount: 0,
        },
        ...current.filter((item) => !(item.kind === "contact" && item.id === contact.id)),
      ]);
      router.push(`/contacts/${encodeURIComponent(contact.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create contact");
    }
  }

  const visibleItems = items.filter((item) =>
    filter === "recent" || item.kind === filter);
  const activeId = activeContactId ?? activeGroupId;
  const hasActiveConversation = Boolean(activeId);

  return (
    <div className={`workspace-shell${hasActiveConversation ? " has-active-conversation" : ""}`}>
      <aside className="contact-rail" aria-label="Conversation navigation">
        <div className="rail-brand">
          <Link href="/" aria-label="AChat workspace home">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span>AChat<span className="brand-subtitle">dispatch desk</span></span>
          </Link>
        </div>
        <SearchBox contactId={activeContactId} />
        <div className="roster-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Conversations</h2>
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
        <div className="conversation-filters" role="group" aria-label="Filter conversations">
          {(["recent", "contact", "task"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "recent" ? "Recent" : value === "contact" ? "Contacts" : "Tasks"}
            </button>
          ))}
        </div>
        <nav className="contact-roster" aria-label="Conversation list">
          {loadingConversations ? <p className="roster-note">Loading conversations…</p> : null}
          {!loadingConversations && !items.length ? (
            <p className="roster-note">No contacts yet. Add one to open a conversation.</p>
          ) : null}
          {!loadingConversations && items.length > 0 && !visibleItems.length ? (
            <p className="roster-note">No conversations match this filter.</p>
          ) : null}
          {visibleItems.map((item) => {
            const isActive = activeId === item.id
              && ((item.kind === "contact" && activeContactId === item.id)
                || (item.kind === "task" && activeGroupId === item.id));
            return (
            <Link
              className={`contact-link conversation-link ${isActive ? "is-active" : ""}`}
              href={item.href}
              key={`${item.kind}:${item.id}`}
              aria-current={isActive ? "page" : undefined}
            >
              <span className={`contact-avatar ${item.kind === "task" ? "task-avatar" : ""}`} aria-hidden="true">
                {item.avatarText}
              </span>
              <span className="contact-link-copy">
                <strong>{item.title}</strong>
                <span>{item.preview || (item.kind === "task" ? "No task messages yet" : "No messages yet")}</span>
              </span>
              {item.unreadCount > 0 ? (
                <span className="conversation-unread" aria-label={`${item.unreadCount} unread`}>
                  {item.unreadCount}
                </span>
              ) : null}
            </Link>
            );
          })}
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
      </aside>
      <div className="workspace-content">
        {hasActiveConversation ? (
          <Link className="workspace-back-link button button-quiet" href="/">
            <span aria-hidden="true">←</span>
            Back to conversations
          </Link>
        ) : null}
        {children ?? (
          <main className="empty-workspace" aria-label="No conversation selected" />
        )}
      </div>
    </div>
  );
}
