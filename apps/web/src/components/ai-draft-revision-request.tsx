"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_DRAFT_REVISION_GOALS,
  type AiDraftRevisionGoal,
  type AiSpendReservation,
  type AiTextInvocationIntent,
  type AiWorkspaceAdapterInvocationBinding,
} from "@market-me/domain";

export function AiDraftRevisionRequest({
  workspaceId,
  contentDraftId,
  contentDraftVersionId,
  bindings,
  reservations,
  intents,
  canEdit,
  executionAvailable,
}: {
  workspaceId: string;
  contentDraftId: string;
  contentDraftVersionId: string;
  bindings: readonly AiWorkspaceAdapterInvocationBinding[];
  reservations: readonly AiSpendReservation[];
  intents: readonly AiTextInvocationIntent[];
  canEdit: boolean;
  executionAvailable: boolean;
}) {
  const router = useRouter();
  const draftIntents = intents.filter((intent) => intent.sourceContentDraftId === contentDraftId);
  const [authorizedReservations, setAuthorizedReservations] = useState<readonly AiSpendReservation[]>(reservations);
  const availableReservations = authorizedReservations.filter((reservation) =>
    reservation.status === "reserved" &&
    reservation.capability === "generate_text" &&
    reservation.feature === "assistant.prepare_copy" &&
    !intents.some((intent) => intent.reservationId === reservation.id),
  );
  const readyBindings = bindings.filter((binding) => binding.healthReady);
  const [invocationBindingId, setInvocationBindingId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [goal, setGoal] = useState<AiDraftRevisionGoal>("clarity");
  const [maxOutputTokens, setMaxOutputTokens] = useState(1024);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();

  async function authorize() {
    const binding = readyBindings.find((candidate) => candidate.id === invocationBindingId);
    if (!binding) return;
    setPending("authorize");
    setMessage(undefined);
    const quoteResponse = await fetch("/api/v1/ai-assistant-cost-quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        action: "prepare_copy",
        rateCardId: binding.rateCardId,
      }),
    });
    const quoteBody = await quoteResponse.json().catch(() => ({}));
    if (!quoteResponse.ok) {
      setPending("");
      setMessage({ kind: "error", text: quoteBody?.error?.message ?? "Could not create the governed prepare-copy quote." });
      return;
    }
    const reserveResponse = await fetch(`/api/v1/ai-cost-quotes/${quoteBody.data.id}/reserve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, idempotencyKey: crypto.randomUUID() }),
    });
    const reserveBody = await reserveResponse.json().catch(() => ({}));
    setPending("");
    if (!reserveResponse.ok) {
      setMessage({ kind: "error", text: reserveBody?.error?.message ?? "The quote was recorded, but its maximum could not be reserved." });
      return;
    }
    const reservation = reserveBody.data as AiSpendReservation;
    setAuthorizedReservations((current) => current.some((item) => item.id === reservation.id)
      ? current
      : [reservation, ...current]);
    setReservationId(reservation.id);
    setMessage({
      kind: "success",
      text: `Reserved the governed prepare-copy maximum: ${reservation.estimatedCostMinor} ${reservation.currency} minor units. No provider request was made.`,
    });
  }

  async function prepare(executeAfterPrepare: boolean) {
    setPending(executeAfterPrepare ? "prepare-execute" : "prepare");
    setMessage(undefined);
    const response = await fetch(`/api/v1/drafts/${contentDraftId}/ai-revision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        invocationBindingId,
        reservationId,
        idempotencyKey: crypto.randomUUID(),
        goal,
        maxOutputTokens,
        executeAfterPrepare,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not create the governed Draft revision request." });
      router.refresh();
      return;
    }
    const status = body?.data?.status;
    setMessage({
      kind: "success",
      text: executeAfterPrepare
        ? status === "succeeded"
          ? "One provider attempt completed. Output remains encrypted for human review."
          : status === "failed"
            ? "The attempt failed before a confirmed provider request; review the retained evidence."
            : "The provider outcome is ambiguous, will not be retried, and requires incident review."
        : "Draft-bound intent prepared without contacting the provider. Its prompt is reproducible from this exact immutable version.",
    });
    router.refresh();
  }

  async function execute(intentId: string) {
    setPending(`execute:${intentId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-invocation-intents/${intentId}/execute-draft-revision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok)
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not execute the governed Draft revision request." });
    else setMessage({
      kind: "success",
      text: body?.data?.status === "succeeded"
        ? "One provider attempt completed. Review the encrypted output in AI & cost controls."
        : "The attempt retained a non-success outcome and will not be retried automatically.",
    });
    router.refresh();
  }

  async function cancel(intentId: string) {
    setPending(`cancel:${intentId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-invocation-intents/${intentId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, reason: "Cancelled from the governed Draft revision panel." }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    setMessage(response.ok
      ? { kind: "success", text: "Draft-bound intent cancelled and its active reservation released." }
      : { kind: "error", text: body?.error?.message ?? "Could not cancel the Draft-bound intent." });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-invocation-intent-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Governed provider assistance</p>
          <h2>Request presentation revision suggestions</h2>
          <p>Market Me assembles the prompt from immutable Draft, claim, and evidence context. The model cannot change facts, approve, or publish.</p>
        </div>
        <span className="status-pill status-neutral">Exact v{contentDraftVersionId.slice(0, 8)}</span>
      </div>
      {canEdit && (
        <div className="settings-form">
          <label>Revision goal
            <select value={goal} onChange={(event) => setGoal(event.target.value as AiDraftRevisionGoal)}>
              {AI_DRAFT_REVISION_GOALS.map((value) => <option value={value} key={value}>{label(value)}</option>)}
            </select>
          </label>
          <label>Healthy implementation
            <select value={invocationBindingId} onChange={(event) => setInvocationBindingId(event.target.value)}>
              <option value="">Select a ready implementation</option>
              {readyBindings.map((binding) => <option value={binding.id} key={binding.id}>{binding.displayName} ({binding.provider})</option>)}
            </select>
          </label>
          <label>Reserved prepare-copy quote
            <select value={reservationId} onChange={(event) => setReservationId(event.target.value)}>
              <option value="">Select an active reservation</option>
              {availableReservations.map((reservation) => <option value={reservation.id} key={reservation.id}>{reservation.estimatedCostMinor} {reservation.currency} minor units</option>)}
            </select>
          </label>
          <button className="button-secondary" type="button" disabled={Boolean(pending) || !invocationBindingId} onClick={authorize}>
            {pending === "authorize" ? "Quoting and reserving..." : "Quote and reserve maximum here"}
          </button>
          <label>Maximum output tokens
            <input type="number" min={1} max={16_384} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(Number(event.target.value))} />
          </label>
          <div className="button-row">
            <button className="button-secondary" type="button" disabled={Boolean(pending) || !invocationBindingId || !reservationId} onClick={() => prepare(false)}>
              {pending === "prepare" ? "Preparing..." : "Prepare governed request"}
            </button>
            <button className="button-primary" type="button" disabled={Boolean(pending) || !executionAvailable || !invocationBindingId || !reservationId} onClick={() => prepare(true)}>
              {pending === "prepare-execute" ? "Preparing and executing..." : "Prepare and execute once"}
            </button>
          </div>
          {!availableReservations.length && <small>Choose a healthy implementation, then authorize its governed maximum here. The full ledger remains in <Link href="/ai-settings">AI &amp; cost controls</Link>.</small>}
          {!executionAvailable && <small>Execution requires the deployment flag, AI vault, active workspace window, and a closed provider circuit. Preparation remains available.</small>}
        </div>
      )}
      <div className="ai-reservation-list">
        {draftIntents.map((intent) => (
          <article key={intent.id}>
            <div>
              <h3>{label(intent.draftRevisionGoal ?? "draft_revision")}</h3>
              <p>{intent.provider} / {intent.modelId} · {label(intent.status)} · {intent.estimatedCostMinor} {intent.currency} minor units</p>
              <small>Exact source version: {intent.sourceContentDraftVersionId === contentDraftVersionId ? "current" : "superseded"} · prompt stored/returned: no · Draft mutation/publishing authority: no</small>
            </div>
            {intent.status === "prepared" ? (
              <div className="ai-provider-connection-actions">
                <button className="button-primary" type="button" disabled={Boolean(pending) || !executionAvailable || !intent.authorizationCurrent} onClick={() => execute(intent.id)}>
                  {pending === `execute:${intent.id}` ? "Executing..." : "Execute exact governed prompt once"}
                </button>
                <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={() => cancel(intent.id)}>
                  {pending === `cancel:${intent.id}` ? "Cancelling..." : "Cancel and release"}
                </button>
              </div>
            ) : <span className="status-pill status-neutral">{label(intent.status)}</span>}
          </article>
        ))}
      </div>
      {!draftIntents.length && <p className="ai-selection-summary">No AI revision request is bound to this Draft.</p>}
      <p className="ai-selection-summary">Successful output stays encrypted. Review and source-locked attachment are available below; an author may then explicitly apply selected presentation fields through the evidence-preserving successor workflow.</p>
      {message && <p className={message.kind === "success" ? "form-success" : "form-error"} role="status">{message.text}</p>}
    </section>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
