"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MEASUREMENT_EVENT_TYPES,
  type MeasurementEventType,
} from "@market-me/domain";

type MeasurementKey = {
  id: string;
  name: string;
  keyPrefix: string;
  status: "active" | "expired" | "revoked";
  allowedEventTypes: readonly MeasurementEventType[];
  campaignScopeMode: "all" | "restricted";
  allowedCampaignIds: readonly string[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
};

export function MeasurementKeyForm({
  workspaceId,
  keys,
  campaigns,
}: {
  workspaceId: string;
  keys: readonly MeasurementKey[];
  campaigns: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [creating, setCreating] = useState(false);
  const [allowedEventTypes, setAllowedEventTypes] = useState<
    MeasurementEventType[]
  >([...MEASUREMENT_EVENT_TYPES]);
  const [expiresAt, setExpiresAt] = useState("");
  const [campaignScopeMode, setCampaignScopeMode] = useState<
    "all" | "restricted"
  >("all");
  const [allowedCampaignIds, setAllowedCampaignIds] = useState<string[]>([]);
  function toggleEventType(eventType: MeasurementEventType) {
    setAllowedEventTypes((current) =>
      current.includes(eventType)
        ? current.filter((candidate) => candidate !== eventType)
        : [...current, eventType],
    );
  }
  function toggleCampaign(campaignId: string) {
    setAllowedCampaignIds((current) =>
      current.includes(campaignId)
        ? current.filter((candidate) => candidate !== campaignId)
        : [...current, campaignId],
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSecret("");
    if (!allowedEventTypes.length) {
      setError("Select at least one allowed event type.");
      return;
    }
    if (campaignScopeMode === "restricted" && !allowedCampaignIds.length) {
      setError("Select at least one allowed Campaign.");
      return;
    }
    setCreating(true);
    const response = await fetch("/api/v1/measurement/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        name,
        allowedEventTypes,
        allowedCampaignIds:
          campaignScopeMode === "restricted" ? allowedCampaignIds : [],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setCreating(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not create the key.");
      return;
    }
    setSecret(payload.data.secret);
    setName("");
    setExpiresAt("");
    setAllowedEventTypes([...MEASUREMENT_EVENT_TYPES]);
    setCampaignScopeMode("all");
    setAllowedCampaignIds([]);
    router.refresh();
  }
  async function revoke(id: string) {
    setPendingId(id);
    setError("");
    setSecret("");
    const response = await fetch(`/api/v1/measurement/keys/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    setPendingId("");
    if (!response.ok)
      return setError(payload?.error?.message ?? "Could not revoke the key.");
    router.refresh();
  }
  return (
    <>
      <div className="field-wide">
        {keys.length ? (
          keys.map((key) => (
            <div className="list-card" key={key.id}>
              <div>
                <strong>{key.name}</strong>
                <p>
                  {key.keyPrefix}… · {key.status}
                  {key.lastUsedAt
                    ? ` · last used ${new Date(key.lastUsedAt).toLocaleString()}`
                    : ""}
                  {key.expiresAt
                    ? ` · expires ${new Date(key.expiresAt).toLocaleString()}`
                    : ""}
                  {key.revokedAt
                    ? ` · revoked ${new Date(key.revokedAt).toLocaleString()}`
                    : ""}
                </p>
                <p>
                  Event scope:{" "}
                  {key.allowedEventTypes.length ===
                  MEASUREMENT_EVENT_TYPES.length
                    ? "all normalized events"
                    : key.allowedEventTypes
                        .map((eventType) => eventType.replaceAll("_", " "))
                        .join(", ")}
                </p>
                <p>
                  Campaign scope:{" "}
                  {key.campaignScopeMode === "all"
                    ? "all Campaigns"
                    : key.allowedCampaignIds.length
                      ? key.allowedCampaignIds
                          .map(
                            (campaignId) =>
                              campaigns.find(
                                (campaign) => campaign.id === campaignId,
                              )?.name ?? campaignId,
                          )
                          .join(", ")
                      : "no remaining Campaigns (deny all)"}
                </p>
                <small>
                  {key.status === "active"
                    ? key.expiresAt
                      ? "Secret remains valid only until its expiration or revocation."
                      : "Secret remains valid until revoked."
                    : "This secret can no longer ingest events."}
                </small>
              </div>
              {key.status === "active" && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={pendingId === key.id}
                  onClick={() => revoke(key.id)}
                >
                  {pendingId === key.id ? "Revoking…" : "Revoke key"}
                </button>
              )}
            </div>
          ))
        ) : (
          <p>No measurement keys configured.</p>
        )}
      </div>
      <form
        className="form-subsection field-wide measurement-key-form"
        onSubmit={submit}
      >
        <h3>Create replacement or new key</h3>
        <p>
          Server integrations send normalized conversion events with this bearer
          key. The secret is shown once. Create a replacement before revoking an
          in-use key.
        </p>
        <label className="field">
          <span>Key name</span>
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Production conversions"
          />
        </label>
        <label className="field">
          <span>Expiration (optional)</span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
          <small>Expired keys fail authentication automatically.</small>
        </label>
        <fieldset className="measurement-scope field-wide">
          <legend>Allowed event types</legend>
          <div className="measurement-scope-actions">
            <button
              className="button-secondary"
              type="button"
              onClick={() => setAllowedEventTypes([...MEASUREMENT_EVENT_TYPES])}
            >
              Select all
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => setAllowedEventTypes([])}
            >
              Clear
            </button>
            <small>
              {allowedEventTypes.length} of {MEASUREMENT_EVENT_TYPES.length}{" "}
              selected
            </small>
          </div>
          <div className="measurement-scope-grid">
            {MEASUREMENT_EVENT_TYPES.map((eventType) => (
              <label className="checkbox-row" key={eventType}>
                <input
                  type="checkbox"
                  checked={allowedEventTypes.includes(eventType)}
                  onChange={() => toggleEventType(eventType)}
                />
                {eventType.replaceAll("_", " ")}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="measurement-scope field-wide">
          <legend>Allowed Campaigns</legend>
          <div className="measurement-scope-grid">
            <label className="checkbox-row">
              <input
                type="radio"
                name="campaign-scope-mode"
                checked={campaignScopeMode === "all"}
                onChange={() => {
                  setCampaignScopeMode("all");
                  setAllowedCampaignIds([]);
                }}
              />
              All Campaigns
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                name="campaign-scope-mode"
                checked={campaignScopeMode === "restricted"}
                onChange={() => setCampaignScopeMode("restricted")}
              />
              Selected Campaigns
            </label>
          </div>
          {campaignScopeMode === "restricted" && (
            <>
              <div className="measurement-scope-actions">
                <small>
                  {allowedCampaignIds.length} of {campaigns.length} selected
                </small>
              </div>
              {campaigns.length ? (
                <div className="measurement-scope-grid">
                  {campaigns.map((campaign) => (
                    <label className="checkbox-row" key={campaign.id}>
                      <input
                        type="checkbox"
                        checked={allowedCampaignIds.includes(campaign.id)}
                        onChange={() => toggleCampaign(campaign.id)}
                      />
                      {campaign.name}
                    </label>
                  ))}
                </div>
              ) : (
                <small>
                  Create a Campaign before creating a Campaign-restricted key.
                </small>
              )}
            </>
          )}
          <small>
            Restricted keys reject events without a resolvable allowed Campaign.
          </small>
        </fieldset>
        <button
          className="button-secondary"
          disabled={
            creating ||
            !allowedEventTypes.length ||
            (campaignScopeMode === "restricted" && !allowedCampaignIds.length)
          }
        >
          {creating ? "Creating…" : "Create key"}
        </button>
        {secret && (
          <div className="callout">
            <strong>Copy now</strong>
            <code>{secret}</code>
            <p>Only a SHA-256 hash is stored.</p>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  );
}
