"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiProviderRateCard,
  AiWorkspaceAdapterRateBinding,
  AiWorkspaceAdapterRegistration,
} from "@market-me/domain";

interface AiAdapterRateBindingsProps {
  workspaceId: string;
  registrations: readonly AiWorkspaceAdapterRegistration[];
  bindings: readonly AiWorkspaceAdapterRateBinding[];
  rateCards: readonly AiProviderRateCard[];
  canManage: boolean;
}

export function AiAdapterRateBindings({
  workspaceId,
  registrations,
  bindings,
  rateCards,
  canManage,
}: AiAdapterRateBindingsProps) {
  const router = useRouter();
  const [registrationId, setRegistrationId] = useState("");
  const [rateCardId, setRateCardId] = useState("");
  const [retirementReasons, setRetirementReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();
  const currentCurrencyKeys = useMemo(
    () => new Set(
      bindings
        .filter((binding) => binding.status === "bound")
        .map((binding) => `${binding.registrationId}:${binding.currency}`),
    ),
    [bindings],
  );
  const registered = registrations.filter((registration) => registration.status === "registered");
  const selectedRegistration = registered.find((registration) => registration.id === registrationId);
  const matchingRateCards = selectedRegistration
    ? rateCards.filter(
        (card) =>
          card.provider === selectedRegistration.provider &&
          card.modelFamily === selectedRegistration.modelId &&
          !currentCurrencyKeys.has(`${selectedRegistration.id}:${card.currency}`),
      )
    : [];

  async function bind() {
    if (!registrationId || !rateCardId) return;
    setPending("bind");
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-adapter-rate-bindings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, registrationId, rateCardId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not bind the pricing evidence.",
      });
      return;
    }
    setRegistrationId("");
    setRateCardId("");
    setMessage({
      kind: "success",
      text: "Source-verified pricing bound; routing and execution remain disabled.",
    });
    router.refresh();
  }

  async function retire(binding: AiWorkspaceAdapterRateBinding) {
    setPending(binding.id);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-adapter-rate-bindings/${binding.id}/retire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        retirementReason: retirementReasons[binding.id] ?? "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not retire the pricing evidence.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: "Pricing evidence retired; routing and execution remain disabled.",
    });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-adapter-rate-binding-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Source-verified hosted pricing</p>
          <h2>Workspace adapter pricing evidence</h2>
          <p>
            Bind an exact effective provider/model rate card to deployment staging. Pricing
            readiness does not configure invocation, availability, routing, or execution.
          </p>
        </div>
        <span className="status-pill status-amber">Non-routable</span>
      </div>

      {canManage && (
        <div className="ai-adapter-rate-binding-form">
          <label className="field">
            <span>Registered workspace adapter</span>
            <select
              value={registrationId}
              onChange={(event) => {
                setRegistrationId(event.target.value);
                setRateCardId("");
              }}
            >
              <option value="">Choose deployment staging</option>
              {registered.map((registration) => (
                <option key={registration.id} value={registration.id}>
                  {registration.provider} / {registration.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Effective matching rate card</span>
            <select
              value={rateCardId}
              disabled={!registrationId}
              onChange={(event) => setRateCardId(event.target.value)}
            >
              <option value="">Choose exact provider/model pricing</option>
              {matchingRateCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.currency} / {card.modelVersion} / {formatComponents(card)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button-primary"
            type="button"
            disabled={!registrationId || !rateCardId || pending === "bind"}
            onClick={bind}
          >
            {pending === "bind" ? "Binding..." : "Bind pricing evidence"}
          </button>
        </div>
      )}

      <div className="ai-adapter-rate-binding-list">
        {bindings.length === 0 ? (
          <p>No hosted pricing evidence is bound to workspace deployment staging.</p>
        ) : (
          bindings.map((binding) => (
            <article className="metric-card" key={binding.id}>
              <div>
                <strong>{binding.displayName}</strong>
                <p>{binding.provider} / {binding.modelId} / {binding.currency}</p>
                <small>
                  {binding.status} &middot; {binding.pricingReady ? "Pricing ready" : "Pricing unavailable"}
                  {" "}&middot; version {binding.modelVersion}
                </small>
                <small>{formatBindingComponents(binding)}</small>
                <small>
                  Source: <a href={binding.sourceReference} target="_blank" rel="noreferrer">{binding.sourceReference}</a>
                  {" "}&middot; SHA-256 {binding.sourceHash}
                </small>
                <small>Routing unavailable &middot; invocation absent &middot; execution disabled</small>
                {binding.retirementReason && <small>Retirement: {binding.retirementReason}</small>}
              </div>
              {canManage && binding.status === "bound" && (
                <div className="ai-provider-connection-actions">
                  <label className="field">
                    <span>Pricing retirement reason</span>
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
                    Retire pricing evidence
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

function formatComponents(card: AiProviderRateCard) {
  return card.components.map((component) =>
    `${formatMoney(component.priceMicros, card.currency)} / ${component.unitQuantity.toLocaleString()} ${component.unit}`,
  ).join("; ");
}

function formatBindingComponents(binding: AiWorkspaceAdapterRateBinding) {
  return binding.components.map((component) =>
    `${component.kind}: ${formatMoney(component.priceMicros, binding.currency)} / ${component.unitQuantity.toLocaleString()} ${component.unit}`,
  ).join(" · ");
}

function formatMoney(priceMicros: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(priceMicros / 1_000_000);
}
