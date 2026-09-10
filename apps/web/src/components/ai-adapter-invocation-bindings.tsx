"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiProviderInvocationContract,
  AiWorkspaceAdapterInvocationBinding,
  AiWorkspaceAdapterRateBinding,
} from "@market-me/domain";

interface AiAdapterInvocationBindingsProps {
  workspaceId: string;
  rateBindings: readonly AiWorkspaceAdapterRateBinding[];
  contracts: readonly AiProviderInvocationContract[];
  bindings: readonly AiWorkspaceAdapterInvocationBinding[];
  canManage: boolean;
}

export function AiAdapterInvocationBindings({
  workspaceId,
  rateBindings,
  contracts,
  bindings,
  canManage,
}: AiAdapterInvocationBindingsProps) {
  const router = useRouter();
  const [rateBindingId, setRateBindingId] = useState("");
  const [contractId, setContractId] = useState("");
  const [retirementReasons, setRetirementReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();
  const configuredRegistrationIds = useMemo(
    () => new Set(
      bindings
        .filter((binding) => binding.status === "configured")
        .map((binding) => binding.registrationId),
    ),
    [bindings],
  );
  const eligiblePricing = rateBindings.filter(
    (binding) =>
      binding.status === "bound" &&
      binding.pricingReady &&
      !configuredRegistrationIds.has(binding.registrationId),
  );
  const selectedPricing = eligiblePricing.find((binding) => binding.id === rateBindingId);
  const matchingContracts = selectedPricing
    ? contracts.filter(
        (contract) =>
          contract.provider === selectedPricing.provider &&
          contract.status === "approved" &&
          contract.codecAvailable &&
          contract.transportAvailable &&
          contract.implementationAvailable,
      )
    : [];

  async function configure() {
    if (!selectedPricing || !contractId) return;
    setPending("configure");
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-adapter-invocation-bindings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        registrationId: selectedPricing.registrationId,
        rateBindingId: selectedPricing.id,
        contractId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not stage the invocation contract.",
      });
      return;
    }
    setRateBindingId("");
    setContractId("");
    setMessage({
      kind: "success",
      text: "Server-owned invocation contract staged; implementation, health, routing, and execution remain disabled.",
    });
    router.refresh();
  }

  async function retire(binding: AiWorkspaceAdapterInvocationBinding) {
    setPending(binding.id);
    setMessage(undefined);
    const response = await fetch(
      `/api/v1/ai-adapter-invocation-bindings/${binding.id}/retire`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          retirementReason: retirementReasons[binding.id] ?? "",
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not retire the invocation configuration.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: "Invocation configuration retired; no provider execution was available.",
    });
    router.refresh();
  }

  async function probe(binding: AiWorkspaceAdapterInvocationBinding) {
    setPending(`probe:${binding.id}`);
    setMessage(undefined);
    const response = await fetch(
      `/api/v1/ai-adapter-invocation-bindings/${binding.id}/probe`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not record provider reachability evidence.",
      });
      return;
    }
    setMessage({
      kind: body?.data?.status === "healthy" ? "success" : "error",
      text: body?.data?.status === "healthy"
        ? "Provider reachability evidence is current for five minutes; implementation and routing remain disabled."
        : body?.data?.safeMessage ?? "Provider reachability was not healthy; routing remains disabled.",
    });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-adapter-invocation-binding-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Server-owned invocation contract</p>
          <h2>Workspace invocation configuration</h2>
          <p>
            Stage one reviewed provider contract against current deployment and pricing
            evidence. Reviewed codec and fixed HTTPS transport produce an internal
            implementation-readiness signal, but no public generation route, routing, or spend-triggered execution exists.
          </p>
        </div>
        <span className="status-pill status-amber">Internal implementation only</span>
      </div>

      {canManage && (
        <div className="ai-adapter-rate-binding-form">
          <label className="field">
            <span>Pricing-ready workspace adapter</span>
            <select
              value={rateBindingId}
              onChange={(event) => {
                setRateBindingId(event.target.value);
                setContractId("");
              }}
            >
              <option value="">Choose current deployment and pricing</option>
              {eligiblePricing.map((binding) => (
                <option key={binding.id} value={binding.id}>
                  {binding.provider} / {binding.displayName} / {binding.currency}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Approved server-owned contract</span>
            <select
              value={contractId}
              disabled={!selectedPricing}
              onChange={(event) => setContractId(event.target.value)}
            >
              <option value="">Choose provider contract</option>
              {matchingContracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.contractKey} / {contract.contractVersion}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button-primary"
            type="button"
            disabled={!selectedPricing || !contractId || pending === "configure"}
            onClick={configure}
          >
            {pending === "configure" ? "Staging..." : "Stage invocation contract"}
          </button>
        </div>
      )}

      <div className="ai-adapter-rate-binding-list">
        {bindings.length === 0 ? (
          <p>No server-owned invocation contract is staged for a workspace adapter.</p>
        ) : (
          bindings.map((binding) => (
            <article className="metric-card" key={binding.id}>
              <div>
                <strong>{binding.displayName}</strong>
                <p>{binding.provider} / {binding.modelId} / {binding.pricingCurrency}</p>
                <small>
                  {binding.status} &middot; {binding.configurationCurrent ? "Contract current" : "Configuration unavailable"}
                  {" "}&middot; {binding.contractKey} / {binding.contractVersion}
                </small>
                <small>
                  {binding.transport} &middot; {binding.credentialMode} &middot; request {binding.requestSchemaVersion} &middot; response {binding.responseSchemaVersion}
                </small>
                <small>
                  Codec: {binding.codecAvailable ? binding.codecVersion ?? "reviewed" : "unavailable"}
                  {" "}&middot; text only &middot; non-streaming &middot; tools and media disabled
                </small>
                <small>
                  Transport: {binding.transportAvailable ? binding.transportVersion ?? "reviewed" : "unavailable"}
                  {binding.endpointPolicy ? ` · ${binding.endpointPolicy}` : ""}
                  {" "}&middot; fixed HTTPS &middot; header credential &middot; no retry
                </small>
                <small>
                  Implementation: {binding.implementationAvailable
                    ? binding.implementationVersion ?? "reviewed"
                    : "unavailable"}
                  {" "}&middot; tenant health {binding.healthReady ? "ready" : "not ready"}
                </small>
                <small>Source: {binding.sourceReference} &middot; SHA-256 {binding.sourceHash}</small>
                {binding.latestHealthObservation ? (
                  <small>
                    Provider reachability: {binding.latestHealthObservation.status}
                    {binding.latestHealthObservation.evidenceCurrent ? " (current evidence)" : " (stale evidence)"}
                    {" "}&middot; checked {new Date(binding.latestHealthObservation.checkedAt).toLocaleString()}
                    {" "}&middot; expires {new Date(binding.latestHealthObservation.expiresAt).toLocaleString()}
                    {binding.latestHealthObservation.safeMessage ? ` · ${binding.latestHealthObservation.safeMessage}` : ""}
                  </small>
                ) : (
                  <small>Provider reachability: not checked</small>
                )}
                <small>Activation unavailable &middot; routing disabled &middot; public execution disabled</small>
                {binding.retirementReason && <small>Retirement: {binding.retirementReason}</small>}
              </div>
              {canManage && binding.status === "configured" && (
                <div className="ai-provider-connection-actions">
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={pending === `probe:${binding.id}` || !binding.configurationCurrent}
                    onClick={() => probe(binding)}
                  >
                    {pending === `probe:${binding.id}` ? "Probing..." : "Probe provider reachability"}
                  </button>
                  <label className="field">
                    <span>Invocation retirement reason</span>
                    <textarea
                      value={retirementReasons[binding.id] ?? ""}
                      maxLength={500}
                      onChange={(event) =>
                        setRetirementReasons((current) => ({
                          ...current,
                          [binding.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={pending === binding.id || !retirementReasons[binding.id]?.trim()}
                    onClick={() => retire(binding)}
                  >
                    Retire invocation configuration
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
      {message && (
        <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
