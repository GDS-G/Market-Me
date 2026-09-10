"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiAssistantAction,
  AiAssistantSelection,
  AiProviderAdapterDescriptor,
  AiRoutingPreference,
} from "@market-me/domain";

export function AiRoutingPreferences({
  workspaceId,
  preferences,
  selections,
  adapters,
  canEdit,
}: {
  workspaceId: string;
  preferences: readonly AiRoutingPreference[];
  selections: readonly AiAssistantSelection[];
  adapters: readonly AiProviderAdapterDescriptor[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<AiAssistantAction, string>>(
    Object.fromEntries(
      selections.map((selection) => {
        const preference = preferences.find(
          (candidate) => candidate.action === selection.action,
        );
        return [
          selection.action,
          preference ? identity(preference.provider, preference.model) : "",
        ];
      }),
    ) as Record<AiAssistantAction, string>,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const preferenceWrites = Object.entries(values)
      .filter(([, value]) => value)
      .map(([action, value]) => {
        const adapter = adapters.find(
          (candidate) => identity(candidate.provider, candidate.model) === value,
        );
        if (!adapter) throw new Error("The selected processing route is unavailable.");
        return {
          action: action as AiAssistantAction,
          provider: adapter.provider,
          model: adapter.model,
        };
      });
    const response = await fetch("/api/v1/ai-routing-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, preferences: preferenceWrites }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not save processing-route preferences.");
      return;
    }
    setMessage("Processing-route preferences saved.");
    router.refresh();
  }

  return (
    <form className="resource-panel ai-routing-preference-panel" onSubmit={submit}>
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Advanced governed routing</p>
          <h2>Processing-route preferences</h2>
          <p>
            Automatic is recommended. An explicit route applies only after capability,
            privacy, approval, availability, tools, and context filters and never grants
            credentials or execution authority.
          </p>
        </div>
        <span className="status-pill status-green">
          {Object.values(values).some(Boolean) ? "Explicit preferences" : "Automatic"}
        </span>
      </div>
      <div className="ai-routing-preference-grid">
        {selections.map((selection) => {
          const compatible = adapters.filter(
            (adapter) =>
              adapter.approved &&
              adapter.capabilities.includes(selection.requiredCapability),
          );
          return (
            <label className="field" key={selection.action}>
              <span>{label(selection.action)}</span>
              <select
                disabled={!canEdit || pending}
                value={values[selection.action]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [selection.action]: event.target.value,
                  }))
                }
              >
                <option value="">Automatic</option>
                {compatible.map((adapter) => (
                  <option
                    key={identity(adapter.provider, adapter.model)}
                    value={identity(adapter.provider, adapter.model)}
                  >
                    {adapter.displayName} ({adapter.provider}/{adapter.model})
                    {adapter.available ? "" : " - unavailable"}
                  </option>
                ))}
              </select>
              <small>{label(selection.requiredCapability)} only</small>
            </label>
          );
        })}
      </div>
      {canEdit && (
        <button className="button-primary" disabled={pending} type="submit">
          {pending ? "Saving..." : "Save processing routes"}
        </button>
      )}
      {message && (
        <p className={message.includes("saved") ? "form-success" : "form-error"} role="status">
          {message}
        </p>
      )}
    </form>
  );
}

function identity(provider: string, model: string) {
  return `${encodeURIComponent(provider)}|${encodeURIComponent(model)}`;
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
