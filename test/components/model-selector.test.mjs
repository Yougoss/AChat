import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import {
  ModelSelector,
  filterModels,
  groupModelsByProvider,
} from "../../src/components/ModelSelector.tsx";

const models = [
  { provider: "github-copilot", modelId: "gpt-5.4", name: "GPT 5.4" },
  { provider: "github-copilot", modelId: "gpt-5.3", name: "GPT 5.3" },
  { provider: "anthropic", modelId: "claude-opus-4", name: "Claude Opus 4" },
];

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

test("filters available models by visible name and provider model ID", () => {
  assert.deepEqual(filterModels(models, "opus").map(({ modelId }) => modelId), ["claude-opus-4"]);
  assert.deepEqual(filterModels(models, "gpt-5.4").map(({ modelId }) => modelId), ["gpt-5.4"]);
});

test("groups model choices by provider", () => {
  assert.deepEqual(groupModelsByProvider(models).map(([provider, entries]) => [
    provider,
    entries.map(({ modelId }) => modelId),
  ]), [
    ["github-copilot", ["gpt-5.4", "gpt-5.3"]],
    ["anthropic", ["claude-opus-4"]],
  ]);
});

test("renders the saved model as the current selection", () => {
  const html = renderToStaticMarkup(React.createElement(ModelSelector, {
    contactId: "contact-1",
    models,
    currentModelId: "gpt-5.4",
  }));

  assert.match(html, /Current model/);
  assert.match(html, /GPT 5\.4/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /Claude Opus 4|claude-opus-4|anthropic/);
});

test("only renders GitHub Copilot models in the POC model picker", () => {
  const html = renderToStaticMarkup(React.createElement(ModelSelector, {
    contactId: "contact-1",
    models,
    currentModelId: "gpt-5.4",
  }));

  assert.match(html, /GPT 5\.4/);
  assert.doesNotMatch(html, /Claude Opus 4|claude-opus-4|anthropic/);
});

test("selecting a GitHub Copilot model saves it for this contact", async () => {
  const originalFetch = globalThis.fetch;
  let savedRequest;
  globalThis.fetch = async (url, init) => {
    savedRequest = { url: String(url), body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({ contact: { modelId: "gpt-5.3" } }),
    };
  };

  try {
    render(React.createElement(ModelSelector, {
      contactId: "contact-1",
      models,
      currentModelId: "gpt-5.4",
    }));
    fireEvent.click(screen.getByRole("button", { name: /GPT 5\.3/ }));

    await waitFor(() => {
      assert.equal(savedRequest?.body.modelId, "gpt-5.3");
      assert.equal(
        screen.getByRole("button", { name: /GPT 5\.3/ }).getAttribute("aria-pressed"),
        "true",
      );
    });
    assert.equal(savedRequest.url, "/api/contacts/contact-1/model");
    assert.equal(screen.queryByText("Claude Opus 4"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
