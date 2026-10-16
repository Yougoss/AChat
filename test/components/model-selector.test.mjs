import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import {
  ModelSelector,
  filterModels,
  groupModelsByProvider,
} from "../../src/components/ModelSelector.tsx";

const models = [
  { provider: "github-copilot", modelId: "gpt-5.4", name: "GPT 5.4" },
  { provider: "anthropic", modelId: "claude-opus-4", name: "Claude Opus 4" },
];

test("filters available models by visible name and provider model ID", () => {
  assert.deepEqual(filterModels(models, "opus").map(({ modelId }) => modelId), ["claude-opus-4"]);
  assert.deepEqual(filterModels(models, "gpt-5.4").map(({ modelId }) => modelId), ["gpt-5.4"]);
});

test("groups model choices by provider", () => {
  assert.deepEqual(groupModelsByProvider(models).map(([provider, entries]) => [
    provider,
    entries.map(({ modelId }) => modelId),
  ]), [
    ["github-copilot", ["gpt-5.4"]],
    ["anthropic", ["claude-opus-4"]],
  ]);
});

test("renders the saved model as the current selection", () => {
  const html = renderToStaticMarkup(React.createElement(ModelSelector, {
    contactId: "contact-1",
    models,
    currentModelId: "claude-opus-4",
  }));

  assert.match(html, /Current model/);
  assert.match(html, /Claude Opus 4/);
  assert.match(html, /aria-pressed="true"/);
});
