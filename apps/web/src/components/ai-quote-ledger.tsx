"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AI_BUDGET_HISTORY_MISMATCH, AI_BUDGET_UNIT_MISMATCH, isAiBudgetQuoteUnitCompatible, type AiBudgetUnitIntegrity, type AiCostQuoteLedgerItem } from "@market-me/domain";
import unitStyles from "./ai-money-units.module.css";

export function AiQuoteLedger({
  workspaceId,
  quotes,
  canEdit,
  budgetUnitIntegrity,
  budgetCurrency,
}: {
  workspaceId: string;
  quotes: readonly AiCostQuoteLedgerItem[];
  canEdit: boolean;
  budgetUnitIntegrity: AiBudgetUnitIntegrity;
  budgetCurrency: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string>();
  const [message, setMessage] = useState("");
  const ledgerCompatible = budgetUnitIntegrity?.status === "compatible" && budgetUnitIntegrity.ledgerExponent === 2 && budgetUnitIntegrity.incompatibleReservationCount === 0;
  const canReserve = (quote: AiCostQuoteLedgerItem) => canEdit && ledgerCompatible && validQuoteMoney(quote) && quote.currency === budgetCurrency && isAiBudgetQuoteUnitCompatible(quote.minorUnitExponent);

  async function reserve(quote: AiCostQuoteLedgerItem) {
    if (!canReserve(quote)) return;
    setPendingId(quote.id);
    setMessage("");
    const response = await fetch(`/api/v1/ai-cost-quotes/${quote.id}/reserve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPendingId(undefined);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not reserve the quoted maximum.");
      return;
    }
    setMessage(`Reservation ${body.data.id} created.`);
    router.refresh();
  }

  return (
    <section className="resource-panel ai-quote-ledger-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Immutable authorization evidence</p>
          <h2>Recent cost quotes</h2>
          <p>
            The ledger shows minimized scope and cost only. A positive active quote
            may be reserved once; a quote or reservation still cannot execute work.
          </p>
        </div>
        <span className="status-pill status-green">{quotes.length} recent</span>
      </div>
      {!ledgerCompatible && <p role="alert" className={unitStyles.warning}>{budgetUnitIntegrity?.status === "incompatible_history" ? AI_BUDGET_HISTORY_MISMATCH : "Money-unit verification is unavailable. New reservations are disabled."}</p>}
      {quotes.length === 0 ? (
        <p className="ai-selection-summary">
          No durable AI cost quote has been created in this workspace.
        </p>
      ) : (
        <div className="ai-reservation-list">
          {quotes.map((quote) => (
            <article key={quote.id}>
              <div>
                <h3>{label(quote.feature)}</h3>
                <p>
                  {label(quote.capability)} - {formatQuote(quote)} - {label(quote.status)}
                </p>
                <small>
                  Quoted {new Date(quote.quotedAt).toLocaleString()} - expires {new Date(quote.expiresAt).toLocaleString()}
                </small>
                {!isAiBudgetQuoteUnitCompatible(quote.minorUnitExponent) && <p className={unitStyles.notice}>{AI_BUDGET_UNIT_MISMATCH}</p>}
                {quote.currency !== budgetCurrency && <p className={unitStyles.notice}>This quote currency differs from the current budget currency. No currency conversion is performed.</p>}
              </div>
              {quote.reservationId ? (
                <span className={`status-pill ${canReserve(quote) ? "status-green" : "status-amber"}`}>Reservation linked — not execution authority</span>
              ) : quote.reservationRequired && quote.status === "active" && canReserve(quote) ? (
                <button
                  className="button-secondary"
                  disabled={Boolean(pendingId)}
                  onClick={() => reserve(quote)}
                  type="button"
                >
                  {pendingId === quote.id ? "Reserving..." : "Reserve maximum"}
                </button>
              ) : (
                <span className="status-pill">
                  {quote.reservationRequired ? "Not reservable" : "No reservation needed"}
                </span>
              )}
            </article>
          ))}
        </div>
      )}
      {message && <p className={message.includes("created") ? "form-success" : "form-error"} role="status">{message}</p>}
    </section>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " ").replace(/^./, (character) => character.toUpperCase());
}

function validQuoteMoney(quote: AiCostQuoteLedgerItem) {
  return Number.isInteger(quote.minorUnitExponent) && quote.minorUnitExponent >= 0 && quote.minorUnitExponent <= 4 &&
    /^[A-Z]{3}$/.test(quote.currency) && Number.isSafeInteger(quote.minimumCostMinor) && Number.isSafeInteger(quote.maximumCostMinor) &&
    quote.minimumCostMinor >= 0 && quote.maximumCostMinor >= quote.minimumCostMinor && quote.maximumCostMinor <= 1_000_000_000;
}
function formatQuote(quote: AiCostQuoteLedgerItem) {
  if (!validQuoteMoney(quote)) return "Quote amount unavailable";
  const divisor = 10 ** quote.minorUnitExponent;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: quote.currency,
    minimumFractionDigits: quote.minorUnitExponent,
    maximumFractionDigits: quote.minorUnitExponent,
  });
  const minimum = formatter.format(quote.minimumCostMinor / divisor);
  const maximum = formatter.format(quote.maximumCostMinor / divisor);
  return minimum === maximum ? minimum : `${minimum}-${maximum}`;
}
