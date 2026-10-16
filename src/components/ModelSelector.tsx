"use client";

import { useState } from "react";

export interface SelectableModel {
  provider: string;
  modelId: string;
  name: string;
}

export function filterModels<T extends SelectableModel>(models: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return models;
  return models.filter((model) =>
    `${model.name} ${model.modelId} ${model.provider}`.toLocaleLowerCase().includes(normalized));
}

export function groupModelsByProvider<T extends SelectableModel>(
  models: T[],
): Array<[string, T[]]> {
  const providers = new Map<string, T[]>();
  for (const model of models) {
    const group = providers.get(model.provider) ?? [];
    group.push(model);
    providers.set(model.provider, group);
  }
  return [...providers.entries()];
}

interface ModelSelectorProps {
  contactId: string;
  models: SelectableModel[];
  currentModelId: string;
  onModelSaved?: (model: SelectableModel) => void;
}

export function ModelSelector({
  contactId,
  models,
  currentModelId,
  onModelSaved,
}: ModelSelectorProps) {
  const [query, setQuery] = useState("");
  const [selectedModelId, setSelectedModelId] = useState(currentModelId);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const copilotModels = models.filter((model) => model.provider === "github-copilot");
  const currentModel = copilotModels.find((model) => model.modelId === selectedModelId);
  const visibleGroups = groupModelsByProvider(filterModels(copilotModels, query));

  async function saveModel(model: SelectableModel) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/model`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: model.modelId }),
      });
      const result = await response.json() as { error?: string; contact?: { modelId: string } };
      if (!response.ok) throw new Error(result.error ?? "Unable to save model");
      setSelectedModelId(result.contact?.modelId ?? model.modelId);
      onModelSaved?.(model);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save model");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="model-selector" aria-label="Contact model">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Model assignment</p>
          <h2>Choose this contact’s model</h2>
        </div>
        <p className="evidence-meta">
          Current model<br />
          <strong>{currentModel?.name ?? currentModelId}</strong>
        </p>
      </div>
      <label className="field-label" htmlFor={`model-filter-${contactId}`}>Filter models</label>
      <input
        id={`model-filter-${contactId}`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search by model name or ID"
      />
      <div className="model-groups">
        {visibleGroups.length ? visibleGroups.map(([provider, group]) => (
          <fieldset key={provider} className="model-provider">
            <legend>{provider}</legend>
            {group.map((model) => (
              <button
                className="model-option"
                type="button"
                key={`${model.provider}:${model.modelId}`}
                aria-pressed={model.modelId === selectedModelId}
                disabled={saving}
                onClick={() => void saveModel(model)}
              >
                <span className="model-option-copy">
                  <strong>{model.name}</strong>
                  <span className="evidence-meta">{model.modelId}</span>
                </span>
                <span aria-hidden="true">{model.modelId === selectedModelId ? "Selected" : "Use model"}</span>
              </button>
            ))}
          </fieldset>
        )) : <p role="status">No models match that filter.</p>}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="form-hint">This selection is saved to this contact only.</p>
    </section>
  );
}
