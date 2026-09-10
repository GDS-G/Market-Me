"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiCostQuoteLedgerItem } from "@market-me/domain";

export function AiQuoteLedger({
  workspaceId,
  quotes,
  canEdit,
}: {
  workspaceId: string;
  quotes: readonly AiCostQuoteLedgerItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string>();
  const [message, setMessage] = useState("");

  async function reserve(quote: AiCostQuoteLedgerItem) {
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
              </div>
              {quote.reservationId ? (
                <span className="status-pill status-green">Reservation linked</span>
              ) : quote.reservationRequired && quote.status === "active" && canEdit ? (
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

function formatQuote(quote: AiCostQuoteLedgerItem) {
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
