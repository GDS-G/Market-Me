"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiWorkspaceExecutionControl,
  AiWorkspaceProviderCircuit,
} from "@market-me/domain";

interface AiExecutionControlProps {
  workspaceId: string;
  control: AiWorkspaceExecutionControl;
  circuits: readonly AiWorkspaceProviderCircuit[];
  deploymentExecutionEnabled: boolean;
  canManage: boolean;
}

export function AiExecutionControl({
  workspaceId,
  control,
  circuits,
  deploymentExecutionEnabled,
  canManage,
}: AiExecutionControlProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [enabledForMinutes, setEnabledForMinutes] = useState(60);
  const [resetNotes, setResetNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();
  const workspaceAllowed = control.executionAllowed;
  const openCircuits = circuits.filter((circuit) => circuit.state === "open");
  const effectiveAllowed = deploymentExecutionEnabled && workspaceAllowed && openCircuits.length === 0;

  async function save(state: "stopped" | "enabled") {
    setPending(state);
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-execution-control", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        state,
        reason,
        ...(state === "enabled" ? { enabledForMinutes } : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not update AI execution control." });
      return;
    }
    setReason("");
    setMessage({
      kind: "success",
      text: state === "enabled"
        ? "Workspace execution enabled for the selected time window. The deployment stop and provider circuits still apply."
        : "Workspace AI provider execution stopped immediately.",
    });
    router.refresh();
  }

  async function reset(circuit: AiWorkspaceProviderCircuit) {
    setPending(`reset:${circuit.provider}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-provider-circuits/${circuit.provider}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, resetNote: resetNotes[circuit.provider] ?? "" }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not reset the provider circuit." });
      return;
    }
    setResetNotes((current) => ({ ...current, [circuit.provider]: "" }));
    setMessage({ kind: "success", text: `${formatProvider(circuit.provider)} circuit reset. Workspace and deployment stops still apply.` });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-execution-control-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Fail-closed provider boundary</p>
          <h2>AI execution stop &amp; circuits</h2>
          <p>
            Provider calls require deployment enablement, an unexpired workspace window, and a
            closed provider circuit. Stopping during a call prevents its output from being accepted.
          </p>
        </div>
        <span className={`status-pill ${effectiveAllowed ? "status-green" : "status-red"}`}>
          {effectiveAllowed ? "Execution allowed" : "Execution blocked"}
        </span>
      </div>

      <div className="metric-grid ai-cache-metrics">
        <article className="metric-card"><div><p>Deployment stop</p><strong>{deploymentExecutionEnabled ? "Released" : "Active"}</strong><small>AI_PROVIDER_EXECUTION_ENABLED</small></div></article>
        <article className="metric-card"><div><p>Workspace control</p><strong>{workspaceAllowed ? "Enabled" : "Stopped"}</strong><small>{control.enabledUntil ? `Until ${new Date(control.enabledUntil).toLocaleString()}` : "No active window"}</small></div></article>
        <article className="metric-card"><div><p>Open circuits</p><strong>{openCircuits.length.toLocaleString()}</strong><small>Manual review and reset required</small></div></article>
        <article className="metric-card"><div><p>Effective state</p><strong>{effectiveAllowed ? "Allowed" : "Blocked"}</strong><small>All three gates must allow execution</small></div></article>
      </div>

      {control.reason && <p className="ai-selection-summary">Latest operator reason: {control.reason}</p>}

      {canManage && (
        <div className="ai-execution-control-actions">
          <label className="field">
            <span>Operator reason</span>
            <textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label className="field">
            <span>Enablement window</span>
            <select value={enabledForMinutes} onChange={(event) => setEnabledForMinutes(Number(event.target.value))}>
              <option value={15}>15 minutes</option>
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
              <option value={1440}>24 hours</option>
            </select>
          </label>
          <div className="ai-execution-control-buttons">
            <button className="button-secondary" type="button" disabled={pending !== "" || reason.trim().length < 3} onClick={() => save("stopped")}>Stop now</button>
            <button className="button-primary" type="button" disabled={pending !== "" || reason.trim().length < 3} onClick={() => save("enabled")}>Enable temporarily</button>
          </div>
        </div>
      )}

      <div className="ai-provider-circuit-list">
        {circuits.length === 0 ? (
          <p>No provider circuit has recorded an execution outcome in this workspace.</p>
        ) : circuits.map((circuit) => (
          <article className="metric-card" key={circuit.provider}>
            <div>
              <strong>{formatProvider(circuit.provider)}</strong>
              <p>{circuit.state} &middot; {circuit.consecutiveUnsafeOutcomes} consecutive unsafe outcome(s)</p>
              <small>{circuit.lastFailureCode ? `Last failure: ${circuit.lastFailureCode.replaceAll("_", " ")}` : "No current failure"}</small>
              {circuit.openedAt && <small>Opened {new Date(circuit.openedAt).toLocaleString()}</small>}
            </div>
            {canManage && circuit.state === "open" && (
              <div className="ai-provider-connection-actions">
                <label className="field">
                  <span>Reset note</span>
                  <textarea value={resetNotes[circuit.provider] ?? ""} maxLength={500} onChange={(event) => setResetNotes((current) => ({ ...current, [circuit.provider]: event.target.value }))} />
                </label>
                <button className="button-secondary" type="button" disabled={pending !== "" || (resetNotes[circuit.provider]?.trim().length ?? 0) < 3} onClick={() => reset(circuit)}>Reset reviewed circuit</button>
              </div>
            )}
          </article>
        ))}
      </div>
      {message && <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">{message.text}</p>}
    </section>
  );
}

function formatProvider(provider: string) {
  return provider.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}
