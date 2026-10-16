"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export interface AuthProvider {
  providerId: string;
  name: string;
  authState: "authenticated" | "unauthenticated";
}

interface LoginPrompt {
  token: string;
  message: string;
  placeholder: string | null;
  options?: readonly { id: string; label: string; description?: string }[];
}

interface ProviderAuthControlsProps {
  providers?: AuthProvider[];
}

function copilotProviders(providers: AuthProvider[] | undefined): AuthProvider[] {
  return (providers ?? []).filter((provider) => provider.providerId === "github-copilot");
}

export function ProviderAuthControls({ providers: initialProviders }: ProviderAuthControlsProps) {
  const [providers, setProviders] = useState(() => copilotProviders(initialProviders));
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyProvider, setBusyProvider] = useState("");
  const eventSource = useRef<EventSource | null>(null);

  async function refreshProviders() {
    try {
      const response = await fetch("/api/auth/providers");
      const result = await response.json() as { providers?: AuthProvider[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to load provider status");
      setProviders(copilotProviders(result.providers));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load provider status");
    }
  }

  useEffect(() => {
    if (initialProviders) return () => eventSource.current?.close();
    let active = true;
    void fetch("/api/auth/providers")
      .then(async (response) => {
        const result = await response.json() as { providers?: AuthProvider[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Unable to load provider status");
        return result;
      })
      .then((result) => {
        if (active) setProviders(copilotProviders(result.providers));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load provider status");
      });
    return () => {
      active = false;
      eventSource.current?.close();
    };
  }, [initialProviders]);

  function startLogin(providerId: string) {
    setError("");
    setMessage("");
    setBusyProvider(providerId);
    setPrompt(null);
    const source = new EventSource(`/api/auth/login/${encodeURIComponent(providerId)}`);
    eventSource.current = source;
    source.onmessage = (event) => {
      const update = JSON.parse(event.data) as {
        type: string;
        token?: string;
        message?: string;
        placeholder?: string | null;
        options?: readonly { id: string; label: string; description?: string }[];
      };
      if (update.type === "prompt_request" || update.type === "select_request") {
        if (!update.token) return;
        setPrompt({
          token: update.token,
          message: update.message ?? "Enter the requested sign-in response.",
          placeholder: update.placeholder ?? null,
          options: update.options,
        });
        return;
      }
      if (update.type === "success") {
        source.close();
        eventSource.current = null;
        setBusyProvider("");
        setPrompt(null);
        setMessage("GitHub Copilot sign-in completed.");
        void refreshProviders();
      } else if (update.type === "error" || update.type === "cancelled") {
        source.close();
        eventSource.current = null;
        setBusyProvider("");
        setError(update.message ?? "Sign-in was cancelled.");
      } else if (update.message) {
        setMessage(update.message);
      }
    };
    source.onerror = () => {
      source.close();
      eventSource.current = null;
      setBusyProvider("");
      setError("The provider sign-in stream ended unexpectedly.");
    };
  }

  function cancelLogin() {
    eventSource.current?.close();
    eventSource.current = null;
    setPrompt(null);
    setPromptValue("");
    setBusyProvider("");
    setMessage("Sign-in cancelled.");
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt || !promptValue.trim()) return;
    setError("");
    try {
      const response = await fetch(`/api/auth/login/github-copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: prompt.token, input: promptValue }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to submit sign-in response");
      setPrompt(null);
      setPromptValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit sign-in response");
    }
  }

  async function signOut(providerId: string) {
    setBusyProvider(providerId);
    setError("");
    try {
      const response = await fetch(`/api/auth/logout/${encodeURIComponent(providerId)}`, {
        method: "POST",
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to sign out");
      await refreshProviders();
      setMessage("Provider signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign out");
    } finally {
      setBusyProvider("");
    }
  }

  return (
    <section className="auth-controls" aria-labelledby="provider-auth-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Provider access</p>
          <h2 id="provider-auth-title">Authentication</h2>
        </div>
      </div>
      {providers.length ? providers.map((provider) => {
        const connected = provider.authState === "authenticated";
        return (
          <article className="provider-card" key={provider.providerId}>
            <div>
              <h3>{provider.name}</h3>
              <p className="provider-status" role="status">
                <span className={`status-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />
                {connected ? "Connected" : "Not connected"}
              </p>
            </div>
            {connected ? (
              <button
                type="button"
                className="button button-secondary"
                disabled={busyProvider === provider.providerId}
                onClick={() => void signOut(provider.providerId)}
                aria-label={`Sign out of ${provider.name}`}
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary"
                disabled={busyProvider === provider.providerId}
                onClick={() => startLogin(provider.providerId)}
                aria-label={`Sign in to ${provider.name}`}
              >
                {busyProvider === provider.providerId ? "Waiting for provider…" : "Sign in"}
              </button>
            )}
          </article>
        );
      }) : <p className="form-hint">Loading provider status…</p>}
      {prompt ? (
        <form className="auth-prompt" onSubmit={(event) => void submitPrompt(event)}>
          <label className="field-label" htmlFor="provider-auth-input">{prompt.message}</label>
          {prompt.options?.length ? (
            <select
              id="provider-auth-input"
              value={promptValue}
              onChange={(event) => setPromptValue(event.currentTarget.value)}
              required
            >
              <option value="">Choose an option</option>
              {prompt.options.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          ) : (
            <input
              id="provider-auth-input"
              value={promptValue}
              onChange={(event) => setPromptValue(event.currentTarget.value)}
              placeholder={prompt.placeholder ?? "Enter sign-in response"}
              autoComplete="one-time-code"
              required
            />
          )}
          <button type="submit" className="button button-primary">Continue sign-in</button>
          <button type="button" className="button button-quiet" onClick={cancelLogin}>Cancel sign-in</button>
        </form>
      ) : null}
      {message ? <p className="form-hint" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
