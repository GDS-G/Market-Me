"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiOperationalIncident,
  AiOperationalReadiness,
  AiOperationalIncidentResponsePolicy,
  AiOperationalAlertWebhook,
  AiOperationalAlertDelivery,
} from "@market-me/domain";

interface AiOperationalIncidentsProps {
  workspaceId: string;
  incidents: readonly AiOperationalIncident[];
  readiness: AiOperationalReadiness;
  policy: AiOperationalIncidentResponsePolicy;
  canAcknowledge: boolean;
  canManagePolicy: boolean;
  webhook: AiOperationalAlertWebhook;
  deliveries: readonly AiOperationalAlertDelivery[];
  canManageAlert: boolean;
  alertDeploymentConfigured: boolean;
}

export function AiOperationalIncidents({
  workspaceId,
  incidents,
  readiness,
  policy,
  canAcknowledge,
  canManagePolicy,
  webhook,
  deliveries,
  canManageAlert,
  alertDeploymentConfigured,
}: AiOperationalIncidentsProps) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();
  const [policyValues, setPolicyValues] = useState({
    criticalAcknowledgementMinutes: policy.criticalAcknowledgementMinutes,
    highAcknowledgementMinutes: policy.highAcknowledgementMinutes,
    criticalResolutionMinutes: policy.criticalResolutionMinutes,
    highResolutionMinutes: policy.highResolutionMinutes,
    runbookUrl: policy.runbookUrl ?? "",
  });
  const [webhookValues, setWebhookValues] = useState({ endpointUrl: "", signingSecret: "" });

  async function acknowledge(incident: AiOperationalIncident) {
    setPending(incident.id);
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-operational-incidents/acknowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        type: incident.type,
        attemptId: incident.attemptId,
        acknowledgementNote: notes[incident.id] ?? "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not acknowledge the operational incident.",
      });
      return;
    }
    setNotes((current) => ({ ...current, [incident.id]: "" }));
    setMessage({
      kind: "success",
      text: "Incident acknowledged. Its source condition remains active until separately resolved.",
    });
    router.refresh();
  }

  async function savePolicy() {
    setPending("policy");
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-operational-incident-response-policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, ...policyValues }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not save the incident-response policy.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: "Incident-response targets saved. They change deadlines, not source state or execution authority.",
    });
    router.refresh();
  }

  async function alertAction(action: "save" | "verify" | "disable") {
    setPending(`alert-${action}`);
    setMessage(undefined);
    const response = await fetch(
      action === "save"
        ? "/api/v1/ai-operational-alert-webhook"
        : `/api/v1/ai-operational-alert-webhook/${action}`,
      {
        method: action === "save" ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "save" ? { workspaceId, ...webhookValues } : { workspaceId }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not update operational alert delivery." });
      return;
    }
    setWebhookValues((current) => ({ ...current, signingSecret: "" }));
    setMessage({
      kind: "success",
      text: action === "save"
        ? "Webhook saved but disabled until its signed verification delivery succeeds."
        : action === "verify"
          ? "Verification finished. Delivery is enabled only when the receiver returned success."
          : "Operational alert delivery disabled; queued records remain retained for review.",
    });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-operational-incident-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Tenant-scoped operational signal</p>
          <h2>AI operational readiness</h2>
          <p>
            Active circuits, unresolved ambiguous attempts, and quarantined billing are projected
            from source evidence. Acknowledgement records ownership; it does not resolve the source
            condition, reset a circuit, retry a request, or authorize execution.
          </p>
        </div>
        <span className={`status-pill ${readiness.state === "ready" ? "status-green" : readiness.state === "attention" ? "status-amber" : "status-red"}`}>
          {readiness.state === "ready" ? "Ready" : readiness.state === "attention" ? "Attention" : "Execution should remain stopped"}
        </span>
      </div>

      <div className="metric-grid ai-cache-metrics">
        <article className="metric-card"><div><p>Active incidents</p><strong>{readiness.activeIncidentCount.toLocaleString()}</strong><small>Derived from retained source evidence</small></div></article>
        <article className="metric-card"><div><p>Unacknowledged</p><strong>{readiness.unacknowledgedIncidentCount.toLocaleString()}</strong><small>Reviewer ownership not yet recorded</small></div></article>
        <article className="metric-card"><div><p>Critical</p><strong>{readiness.criticalIncidentCount.toLocaleString()}</strong><small>Credential circuit incidents</small></div></article>
        <article className="metric-card"><div><p>Overdue targets</p><strong>{(readiness.acknowledgementOverdueCount + readiness.acknowledgementLateCount + readiness.resolutionOverdueCount).toLocaleString()}</strong><small>Acknowledgement or resolution deadline evidence</small></div></article>
      </div>

      <p className="ai-selection-summary">
        Response targets: critical acknowledgement {policy.criticalAcknowledgementMinutes} min / resolution {policy.criticalResolutionMinutes} min;
        high acknowledgement {policy.highAcknowledgementMinutes} min / resolution {policy.highResolutionMinutes} min.
        External alert delivery is {webhook.deliveryEnabled ? "verified and enabled" : "not enabled"}.
        {policy.runbookUrl && <> <a href={policy.runbookUrl} target="_blank" rel="noreferrer">Open incident runbook</a>.</>}
      </p>

      {canManagePolicy && (
        <div className="ai-operational-policy-form">
          <label className="field"><span>Critical acknowledgement (minutes)</span><input type="number" min={1} max={60} value={policyValues.criticalAcknowledgementMinutes} onChange={(event) => setPolicyValues((current) => ({ ...current, criticalAcknowledgementMinutes: Number(event.target.value) }))} /></label>
          <label className="field"><span>Critical resolution (minutes)</span><input type="number" min={5} max={10_080} value={policyValues.criticalResolutionMinutes} onChange={(event) => setPolicyValues((current) => ({ ...current, criticalResolutionMinutes: Number(event.target.value) }))} /></label>
          <label className="field"><span>High acknowledgement (minutes)</span><input type="number" min={1} max={1_440} value={policyValues.highAcknowledgementMinutes} onChange={(event) => setPolicyValues((current) => ({ ...current, highAcknowledgementMinutes: Number(event.target.value) }))} /></label>
          <label className="field"><span>High resolution (minutes)</span><input type="number" min={5} max={43_200} value={policyValues.highResolutionMinutes} onChange={(event) => setPolicyValues((current) => ({ ...current, highResolutionMinutes: Number(event.target.value) }))} /></label>
          <label className="field ai-operational-runbook-field"><span>HTTPS runbook URL</span><input type="url" maxLength={2_000} value={policyValues.runbookUrl} onChange={(event) => setPolicyValues((current) => ({ ...current, runbookUrl: event.target.value }))} /></label>
          <button className="button-secondary" type="button" disabled={pending !== "" || !policyValues.runbookUrl.startsWith("https://")} onClick={savePolicy}>{pending === "policy" ? "Saving…" : "Save response targets"}</button>
        </div>
      )}

      <div className="ai-operational-policy-form">
        <div>
          <strong>Signed incident webhook</strong>
          <p>
            Status: {webhook.configured ? webhook.status : "not configured"}
            {webhook.endpointOrigin ? ` · receiver ${webhook.endpointOrigin}` : ""}.
            Endpoint paths, signing secrets, and delivery payloads are never returned here.
          </p>
          {webhook.lastTestedAt && <small>Last tested {new Date(webhook.lastTestedAt).toLocaleString()}</small>}
          {webhook.safeError && <small>{webhook.safeError}</small>}
          {!alertDeploymentConfigured && <small>Deployment encryption and exact host allowlisting must be configured before setup.</small>}
        </div>
        {canManageAlert && (
          <>
            <label className="field ai-operational-runbook-field">
              <span>Allowlisted HTTPS webhook URL</span>
              <input type="url" maxLength={2_000} value={webhookValues.endpointUrl}
                onChange={(event) => setWebhookValues((current) => ({ ...current, endpointUrl: event.target.value }))} />
            </label>
            <label className="field ai-operational-runbook-field">
              <span>Signing secret (32–256 characters)</span>
              <input type="password" minLength={32} maxLength={256} autoComplete="new-password"
                value={webhookValues.signingSecret}
                onChange={(event) => setWebhookValues((current) => ({ ...current, signingSecret: event.target.value }))} />
            </label>
            <div className="ai-provider-connection-actions">
              <button className="button-secondary" type="button"
                disabled={pending !== "" || !alertDeploymentConfigured || !webhookValues.endpointUrl.startsWith("https://") || webhookValues.signingSecret.length < 32}
                onClick={() => alertAction("save")}>{pending === "alert-save" ? "Saving…" : "Save unverified webhook"}</button>
              <button className="button-secondary" type="button"
                disabled={pending !== "" || !alertDeploymentConfigured || !webhook.configured || webhook.status === "verified"}
                onClick={() => alertAction("verify")}>{pending === "alert-verify" ? "Verifying…" : "Send signed verification"}</button>
              <button className="button-secondary" type="button"
                disabled={pending !== "" || !webhook.configured || webhook.status === "disabled"}
                onClick={() => alertAction("disable")}>{pending === "alert-disable" ? "Disabling…" : "Disable delivery"}</button>
            </div>
          </>
        )}
      </div>

      {deliveries.length > 0 && (
        <div className="ai-provider-circuit-list">
          <strong>Recent alert delivery evidence</strong>
          {deliveries.map((delivery) => (
            <article className="metric-card" key={delivery.id}>
              <div>
                <strong>{delivery.eventType.replaceAll("_", " ")}</strong>
                <small>{formatProvider(delivery.provider)} · {delivery.incidentType.replaceAll("_", " ")} · attempt {delivery.attemptCount}/5</small>
                <small>Created {new Date(delivery.createdAt).toLocaleString()}{delivery.deliveredAt ? ` · delivered ${new Date(delivery.deliveredAt).toLocaleString()}` : ""}</small>
                {delivery.safeError && <small>{delivery.safeError}</small>}
              </div>
              <span className={`status-pill ${delivery.status === "delivered" ? "status-green" : delivery.status === "dead_letter" ? "status-red" : "status-amber"}`}>
                {delivery.status.replaceAll("_", " ")}
              </span>
            </article>
          ))}
        </div>
      )}

      {readiness.oldestActiveAt && (
        <p className="ai-selection-summary">
          Oldest active incident: {new Date(readiness.oldestActiveAt).toLocaleString()}.
          Keep execution stopped until every source condition has been separately resolved.
        </p>
      )}

      <div className="ai-provider-circuit-list ai-operational-incident-list">
        {incidents.length === 0 ? (
          <p>No active AI operational incident is present in this workspace.</p>
        ) : incidents.map((incident) => (
          <article className="metric-card" key={incident.id}>
            <div>
              <strong>{incidentTitle(incident)}</strong>
              <p>{incident.summary}</p>
              <small>{formatProvider(incident.provider)} &middot; {incident.reason.replaceAll("_", " ")} &middot; opened {new Date(incident.openedAt).toLocaleString()}</small>
              <small>Acknowledge by {new Date(incident.acknowledgementDueAt).toLocaleString()} &middot; resolve by {new Date(incident.resolutionDueAt).toLocaleString()} &middot; {incident.responseState.replaceAll("_", " ")}</small>
              <small>Attempt {incident.attemptId} &middot; provider request retry forbidden</small>
              {incident.acknowledged && (
                <small>Acknowledged {incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toLocaleString() : ""}: {incident.acknowledgementNote}</small>
              )}
            </div>
            <span className={`status-pill ${incident.acknowledged ? "status-amber" : "status-red"}`}>
              {incident.acknowledged ? "Acknowledged · active" : `${incident.severity} · unacknowledged`}
            </span>
            {canAcknowledge && !incident.acknowledged && (
              <div className="ai-provider-connection-actions">
                <label className="field">
                  <span>Acknowledgement note</span>
                  <textarea
                    value={notes[incident.id] ?? ""}
                    maxLength={1_000}
                    onChange={(event) => setNotes((current) => ({
                      ...current,
                      [incident.id]: event.target.value,
                    }))}
                  />
                </label>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={pending !== "" || (notes[incident.id]?.trim().length ?? 0) < 3}
                  onClick={() => acknowledge(incident)}
                >
                  {pending === incident.id ? "Acknowledging…" : "Acknowledge active incident"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {message && <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">{message.text}</p>}
    </section>
  );
}

function incidentTitle(incident: AiOperationalIncident) {
  if (incident.type === "provider_circuit_open") return "Open provider circuit";
  if (incident.type === "invocation_ambiguous") return "Unresolved ambiguous invocation";
  return "Quarantined provider billing";
}

function formatProvider(provider: string) {
  return provider.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}
