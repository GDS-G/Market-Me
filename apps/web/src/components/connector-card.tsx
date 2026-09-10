"use client";

import { useState } from "react";
import type { ConnectorStatus } from "@market-me/connectors";

export function ConnectorCard({ manifest, workspaceId, connected, webhooksConfigured }: {
  manifest: ConnectorStatus;
  workspaceId: string;
  connected: boolean;
  webhooksConfigured: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/connectors/${manifest.provider}/oauth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, returnTo: "/integrations" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not start the connection.");
      setPending(false);
      return;
    }
    window.location.assign(payload.data.authorizationUrl);
  }

  return (
    <article className="connector-card">
      <div className="connector-title"><span>{manifest.label.slice(0, 2).toUpperCase()}</span><div><h2>{manifest.label}</h2><p>{connected ? "Connected" : manifest.configured ? "Ready to connect" : "Credentials required"}</p></div></div>
      <ul><li>Incremental changes</li><li>{webhooksConfigured ? "Webhook delivery ready" : "Polling fallback active"}</li><li>{manifest.supportsSharedLibraries ? "Shared libraries" : "Personal storage"}</li></ul>
      {!manifest.configured && <p className="connector-missing">Missing: {manifest.missingVariables.join(", ")}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className={connected ? "button-secondary" : "button-primary"} disabled={pending || connected || !manifest.configured} onClick={connect} type="button">
        {connected ? "Connected" : pending ? "Opening provider…" : "Connect"}
      </button>
    </article>
  );
}
