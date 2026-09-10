"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_HOSTED_PROVIDER_TYPES,
  type AiHostedProviderType,
  type AiProviderConnection,
  type AiProviderModelInventoryItem,
  type AiProviderModelInventorySummary,
} from "@market-me/domain";

const LABELS: Readonly<Record<AiHostedProviderType, string>> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google_generative_ai: "Google Generative AI",
};

export function AiProviderConnections({
  workspaceId,
  connections,
  canEdit,
  vaultConfigured,
  modelInventories,
}: {
  workspaceId: string;
  connections: readonly AiProviderConnection[];
  canEdit: boolean;
  vaultConfigured: boolean;
  modelInventories: readonly {
    provider: AiHostedProviderType;
    models: readonly AiProviderModelInventoryItem[];
    summary: AiProviderModelInventorySummary;
  }[];
}) {
  const router = useRouter();
  const [keys, setKeys] = useState<Partial<Record<AiHostedProviderType, string>>>({});
  const [pending, setPending] = useState<AiHostedProviderType>();
  const [message, setMessage] = useState("");

  async function save(provider: AiHostedProviderType) {
    setPending(provider);
    setMessage("");
    const response = await fetch("/api/v1/ai-provider-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, provider, apiKey: keys[provider] ?? "" }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(undefined);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not save the provider credential.");
      return;
    }
    setKeys((current) => ({ ...current, [provider]: "" }));
    setMessage(`${LABELS[provider]} credential encrypted and saved as unverified.`);
    router.refresh();
  }

  async function revoke(provider: AiHostedProviderType) {
    setPending(provider);
    setMessage("");
    const response = await fetch(`/api/v1/ai-provider-connections/${provider}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(undefined);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not revoke the provider credential.");
      return;
    }
    setKeys((current) => ({ ...current, [provider]: "" }));
    setMessage(`${LABELS[provider]} credential revoked and cryptographically erased.`);
    router.refresh();
  }

  async function verify(provider: AiHostedProviderType) {
    setPending(provider);
    setMessage("");
    const response = await fetch(`/api/v1/ai-provider-connections/${provider}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(undefined);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not verify the provider credential.");
      return;
    }
    if (body?.data?.status === "verified")
      setMessage(`${LABELS[provider]} accepted the credential.`);
    else
      setMessage(body?.data?.lastError ?? `${LABELS[provider]} could not verify the credential.`);
    router.refresh();
  }

  async function discoverModels(provider: AiHostedProviderType) {
    setPending(provider);
    setMessage("");
    const response = await fetch(`/api/v1/ai-provider-connections/${provider}/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(undefined);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not discover provider models.");
      return;
    }
    setMessage(`${LABELS[provider]} model inventory refreshed with ${body?.data?.summary?.activeModelCount ?? 0} active records.`);
    router.refresh();
  }

  return (
    <section className="resource-panel ai-provider-connection-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Hosted-provider credential boundary</p>
          <h2>Provider connections</h2>
          <p>
            Keys are encrypted before persistence and are never returned. Saving creates an
            Unverified connection; Verify makes one bounded, non-generative metadata request.
          </p>
        </div>
        <span className={`status-pill ${vaultConfigured ? "status-green" : "status-amber"}`}>
          {vaultConfigured ? "Vault ready" : "Vault not configured"}
        </span>
      </div>
      <div className="ai-provider-connection-grid">
        {AI_HOSTED_PROVIDER_TYPES.map((provider) => {
          const connection = connections.find((candidate) => candidate.provider === provider);
          const inventory = modelInventories.find((candidate) => candidate.provider === provider);
          const activeModels = inventory?.models.filter((model) => !model.retiredAt) ?? [];
          const busy = pending === provider;
          return (
            <article className="metric-card ai-provider-connection-card" key={provider}>
              <div>
                <p>{LABELS[provider]}</p>
                <strong>{connection ? label(connection.status) : "Not configured"}</strong>
                <small>
                  {connection?.status === "verified"
                    ? `Provider accepted the credential${connection.verifiedAt ? ` on ${new Date(connection.verifiedAt).toLocaleString()}` : ""}`
                    : connection?.status === "error"
                      ? connection.lastError ?? "Provider verification failed"
                    : connection?.credentialConfigured
                    ? "Encrypted credential stored; verification required"
                    : connection?.status === "revoked"
                      ? "Credential erased; enter a new key to reconnect"
                      : "No credential is stored"}
                </small>
              </div>
              {inventory && inventory.summary.totalModelCount > 0 && (
                <div className="ai-provider-model-summary">
                  <small>{inventory.summary.activeModelCount} active - {inventory.summary.retiredModelCount} retired workspace-private model records</small>
                  {activeModels.length > 0 && (
                    <ul>
                      {activeModels.slice(0, 5).map((model) => (
                        <li key={model.modelId}>{model.displayName ?? model.modelId}</li>
                      ))}
                    </ul>
                  )}
                  {activeModels.length > 5 && <small>and {activeModels.length - 5} more</small>}
                </div>
              )}
              {canEdit && (
                <div className="ai-provider-connection-actions">
                  <label className="field">
                    <span>API key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      disabled={!vaultConfigured || busy}
                      value={keys[provider] ?? ""}
                      onChange={(event) =>
                        setKeys((current) => ({ ...current, [provider]: event.target.value }))
                      }
                      placeholder="Stored only after encryption"
                    />
                  </label>
                  <button
                    className="button-primary"
                    disabled={!vaultConfigured || busy || (keys[provider]?.trim().length ?? 0) < 20}
                    onClick={() => save(provider)}
                    type="button"
                  >
                    {busy ? "Working..." : connection?.credentialConfigured ? "Rotate key" : "Save key"}
                  </button>
                  {connection?.credentialConfigured && connection.status !== "revoked" && (
                    <button className="button-secondary" disabled={busy} onClick={() => verify(provider)} type="button">
                      {connection.status === "verified" ? "Verify again" : "Verify credential"}
                    </button>
                  )}
                  {connection?.status === "verified" && (
                    <button className="button-secondary" disabled={busy} onClick={() => discoverModels(provider)} type="button">
                      {inventory?.summary.activeModelCount ? "Refresh model inventory" : "Discover models"}
                    </button>
                  )}
                  {connection?.credentialConfigured && connection.status !== "revoked" && (
                    <button className="button-secondary" disabled={busy} onClick={() => revoke(provider)} type="button">
                      Revoke and erase
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {message && <p className={message.includes("Could not") ? "form-error" : "form-success"} role="status">{message}</p>}
      <p className="ai-selection-summary">Verification discards its response body. Explicit discovery retains only bounded normalized workspace-private model records. Adapter activation, rate-card binding, spend reservation, and execution remain separate server-only steps.</p>
    </section>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
