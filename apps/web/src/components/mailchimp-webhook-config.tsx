"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Health = "managed_active" | "managed_missing" | "managed_drifted" | "managed_secret_missing" | "manual_unverified" | "unmanaged_provider_webhook" | "disabled";

export function MailchimpWebhookConfig({
  workspaceId, connectionId, callbackUrl, configured, management,
  monitoredHealth, lastCheckedAt, consecutiveFailures, lastMonitorError,
}: {
  workspaceId: string;
  connectionId: string;
  callbackUrl: string;
  configured: boolean;
  management?: string;
  monitoredHealth?: "managed_active" | "managed_missing" | "managed_drifted" | "managed_secret_missing";
  lastCheckedAt?: string;
  consecutiveFailures?: string;
  lastMonitorError?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"check" | "provision" | "disable">();
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState<Health>();
  const [replacementConfirmed, setReplacementConfirmed] = useState(configured || management === "managed");

  async function check() {
    setPending("check"); setMessage("");
    const response = await fetch(`/api/v1/channel-connections/${connectionId}/mailchimp-webhook?workspaceId=${workspaceId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})); setPending(undefined);
    if (!response.ok) return setMessage(payload?.error?.message ?? "Could not check the provider webhook.");
    setHealth(payload.data.health); setMessage(healthMessage(payload.data.health));
  }

  async function provision() {
    setPending("provision"); setMessage("");
    const response = await fetch(`/api/v1/channel-connections/${connectionId}/mailchimp-webhook`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, replaceExisting: replacementConfirmed }),
    });
    const payload = await response.json().catch(() => ({})); setPending(undefined);
    if (!response.ok) {
      if (payload?.error?.code === "provider_webhook_exists") {
        setReplacementConfirmed(true);
        return setMessage("A matching provider webhook already exists. Review the replacement warning, then click again to delete and recreate only that callback.");
      }
      return setMessage(payload?.error?.message ?? "Could not provision the signed webhook.");
    }
    setHealth("managed_active"); setMessage("Managed Campaign-only webhook is active and its one-time signing secret is encrypted."); router.refresh();
  }

  async function disable() {
    if (!window.confirm("Disable signed wakeups and remove the managed provider webhook? Durable report polling will continue.")) return;
    setPending("disable"); setMessage("");
    const response = await fetch(`/api/v1/channel-connections/${connectionId}/mailchimp-webhook`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({})); setPending(undefined);
    if (!response.ok) return setMessage(payload?.error?.message ?? "Could not disable the signed webhook.");
    setHealth("disabled"); setReplacementConfirmed(false); setMessage("Signed wakeups are disabled; durable aggregate polling remains active."); router.refresh();
  }

  const active = configured || health === "managed_active" || health === "manual_unverified";
  return <div className="form-subsection">
    <strong>Signed aggregate-report wakeup</strong>
    <p>Market Me can create and manage an exact Campaign-only Mailchimp webhook. The one-time signing secret is encrypted automatically; recipient events remain disabled.</p>
    {monitoredHealth || lastMonitorError ? <p>
      <strong>Automatic monitor:</strong> {lastMonitorError ? `provider check failed (${lastMonitorError})` : monitoredHealth?.replaceAll("_", " ")}
      {lastCheckedAt ? ` · last verified ${new Date(lastCheckedAt).toLocaleString()}` : ""}
      {consecutiveFailures && consecutiveFailures !== "0" ? ` · ${consecutiveFailures} consecutive unhealthy/error checks` : ""}
    </p> : null}
    <label className="field"><span>Callback URL</span><input readOnly value={callbackUrl} /></label>
    {replacementConfirmed ? <p><strong>Replacement scope:</strong> only this exact callback and the webhook ID previously managed by this connection will be deleted before a new signed webhook is created.</p> : null}
    <div className="button-row">
      <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={provision}>
        {pending === "provision" ? "Provisioning..." : replacementConfirmed ? "Replace with managed webhook" : "Provision managed webhook"}
      </button>
      <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={check}>
        {pending === "check" ? "Checking..." : "Check provider status"}
      </button>
      {active ? <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={disable}>
        {pending === "disable" ? "Disabling..." : "Disable signed wakeups"}
      </button> : null}
    </div>
    {message ? <p aria-live="polite">{message}</p> : null}
  </div>;
}

function healthMessage(health: Health): string {
  const messages: Record<Health, string> = {
    managed_active: "Managed webhook is present with the exact callback, Campaign-only events, approved sources, and a local signing secret.",
    managed_missing: "The managed provider webhook is missing. Replace it to restore signed acceleration.",
    managed_drifted: "The managed provider webhook settings drifted. Replace it to restore the exact Campaign-only boundary.",
    managed_secret_missing: "The provider webhook exists but the local one-time secret is missing. Replace it.",
    manual_unverified: "A signing secret is stored manually; provider identity and secret agreement cannot be proven. Replace it with a managed webhook.",
    unmanaged_provider_webhook: "A provider webhook uses this callback but is not managed locally. Confirm replacement to recreate it safely.",
    disabled: "No matching provider webhook or local signing secret is configured.",
  };
  return messages[health];
}
