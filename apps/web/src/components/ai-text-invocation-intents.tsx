"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiSpendReservation,
  AiTextInvocationAttempt,
  AiTextInvocationIntent,
  AiTextInvocationReconciliation,
  AiTextInvocationResolution,
  AiTextOutputArtifact,
  AiTextDraftProposal,
  AiWorkspaceAdapterInvocationBinding,
} from "@market-me/domain";

export function AiTextInvocationIntents({
  workspaceId,
  bindings,
  reservations,
  intents,
  attempts,
  outputArtifacts,
  reconciliations,
  resolutions,
  draftTargets,
  draftProposals,
  canEdit,
  canApprove,
  executionAvailable,
}: {
  workspaceId: string;
  bindings: readonly AiWorkspaceAdapterInvocationBinding[];
  reservations: readonly AiSpendReservation[];
  intents: readonly AiTextInvocationIntent[];
  attempts: readonly AiTextInvocationAttempt[];
  outputArtifacts: readonly AiTextOutputArtifact[];
  reconciliations: readonly AiTextInvocationReconciliation[];
  resolutions: readonly AiTextInvocationResolution[];
  draftTargets: readonly { id: string; label: string }[];
  draftProposals: readonly AiTextDraftProposal[];
  canEdit: boolean;
  canApprove: boolean;
  executionAvailable: boolean;
}) {
  const router = useRouter();
  const readyBindings = bindings.filter((binding) => binding.healthReady);
  const availableReservations = reservations.filter((reservation) =>
    reservation.status === "reserved" &&
    reservation.capability === "generate_text" &&
    reservation.feature.startsWith("assistant.") &&
    !intents.some((intent) => intent.reservationId === reservation.id),
  );
  const [invocationBindingId, setInvocationBindingId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [systemText, setSystemText] = useState("");
  const [userText, setUserText] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState(1024);
  const [pending, setPending] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [outputPreview, setOutputPreview] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [draftSelection, setDraftSelection] = useState("");
  const [resolutionDispositions, setResolutionDispositions] = useState<Record<string, "confirmed_no_charge" | "settled_provider_charge">>({});
  const [resolutionCharges, setResolutionCharges] = useState<Record<string, string>>({});
  const [resolutionEvidence, setResolutionEvidence] = useState<Record<string, string>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();

  async function prepare(executeAfterPrepare = false) {
    setPending(executeAfterPrepare ? "prepare-execute" : "prepare");
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-text-invocation-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        invocationBindingId,
        reservationId,
        idempotencyKey: crypto.randomUUID(),
        userText,
        ...(systemText ? { systemText } : {}),
        maxOutputTokens,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setPending("");
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not prepare the intent." });
      return;
    }
    if (executeAfterPrepare) {
      const execution = await executeRequest(body.data.id);
      setPending("");
      if (!execution.ok) {
        setMessage({ kind: "error", text: execution.message });
        router.refresh();
        return;
      }
      setSystemText("");
      setUserText("");
      setMessage({ kind: "success", text: execution.message });
    } else {
      setPending("");
      setMessage({ kind: "success", text: "Invocation intent prepared without contacting the provider. Keep or re-enter the exact prompt to execute it once." });
    }
    router.refresh();
  }

  async function execute(intentId: string) {
    setPending(`execute:${intentId}`);
    setMessage(undefined);
    const result = await executeRequest(intentId);
    setPending("");
    setMessage({ kind: result.ok ? "success" : "error", text: result.message });
    if (result.ok) {
      setSystemText("");
      setUserText("");
    }
    router.refresh();
  }

  async function executeRequest(intentId: string): Promise<{ ok: boolean; message: string }> {
    const response = await fetch(`/api/v1/ai-text-invocation-intents/${intentId}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        userText,
        ...(systemText ? { systemText } : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return { ok: false, message: body?.error?.message ?? "Could not execute the prepared intent." };
    const status = body?.data?.status ?? "completed";
    return {
      ok: true,
      message: status === "succeeded"
        ? "One provider attempt completed. Its output remains encrypted and requires review."
        : status === "failed"
          ? "The attempt failed before a confirmed provider request; review the retained evidence."
          : "The provider outcome is ambiguous. It will not be retried automatically and requires incident review.",
    };
  }

  async function cancel(intentId: string) {
    setPending(intentId);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-invocation-intents/${intentId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, reason: "Cancelled from AI settings." }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not cancel the intent." });
      return;
    }
    setMessage({ kind: "success", text: "Intent cancelled and its active reservation released." });
    router.refresh();
  }

  async function inspectOutput(artifactId: string) {
    setPending(`read:${artifactId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-outputs/${artifactId}?workspaceId=${workspaceId}`);
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not open the encrypted output." });
      return;
    }
    setSelectedArtifactId(artifactId);
    setOutputPreview(body.data.outputText);
  }

  async function reviewOutput(artifactId: string, decision: "accepted" | "discarded") {
    setPending(`review:${artifactId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-outputs/${artifactId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, decision, reviewNote }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not record the output review." });
      return;
    }
    setSelectedArtifactId("");
    setOutputPreview("");
    setReviewNote("");
    setMessage({ kind: "success", text: decision === "accepted" ? "Output accepted for later draft integration." : "Output discarded." });
    router.refresh();
  }

  async function attachToDraft(artifactId: string) {
    setPending(`attach:${artifactId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-outputs/${artifactId}/attach-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, contentDraftId: draftSelection }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not attach the accepted output to the Draft." });
      return;
    }
    setDraftSelection("");
    setMessage({ kind: "success", text: "Accepted output attached as a read-only governed Draft proposal." });
    router.refresh();
  }

  async function resolveAttempt(attemptId: string) {
    const disposition = resolutionDispositions[attemptId] ?? "confirmed_no_charge";
    setPending(`resolve:${attemptId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-invocation-attempts/${attemptId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        disposition,
        ...(disposition === "settled_provider_charge"
          ? { providerChargeMinor: Number(resolutionCharges[attemptId]) }
          : {}),
        evidenceReference: resolutionEvidence[attemptId] ?? "",
        resolutionNote: resolutionNotes[attemptId] ?? "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not resolve the invocation evidence." });
      return;
    }
    setMessage({
      kind: "success",
      text: disposition === "settled_provider_charge"
        ? "Provider charge recorded from reviewed evidence without inventing token usage or retrying the request."
        : "No-charge evidence recorded and the unresolved hold closed without retrying the request.",
    });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-invocation-intent-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Pre-execution authorization ledger</p>
          <h2>Text invocation intents</h2>
          <p>A prepared intent binds current provider health, implementation evidence, and one exact spend reservation. It stores prompt hashes—not prompt text—and never sends a provider request.</p>
        </div>
        <span className="status-pill status-green">{intents.length} recorded</span>
      </div>
      {canEdit && (
        <div className="settings-form">
          <label>Healthy implementation
            <select value={invocationBindingId} onChange={(event) => setInvocationBindingId(event.target.value)}>
              <option value="">Select a ready implementation</option>
              {readyBindings.map((binding) => <option key={binding.id} value={binding.id}>{binding.displayName} ({binding.provider})</option>)}
            </select>
          </label>
          <label>Reserved quote
            <select value={reservationId} onChange={(event) => setReservationId(event.target.value)}>
              <option value="">Select an active text reservation</option>
              {availableReservations.map((reservation) => <option key={reservation.id} value={reservation.id}>{label(reservation.feature)} - {reservation.estimatedCostMinor} {reservation.currency} minor units</option>)}
            </select>
          </label>
          <label>System text (optional)
            <textarea value={systemText} maxLength={20_000} onChange={(event) => setSystemText(event.target.value)} />
          </label>
          <label>User text
            <textarea required value={userText} maxLength={200_000} onChange={(event) => setUserText(event.target.value)} />
          </label>
          <label>Maximum output tokens
            <input type="number" min={1} max={16_384} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(Number(event.target.value))} />
          </label>
          <button className="button-secondary" type="button" disabled={Boolean(pending) || !invocationBindingId || !reservationId || !userText} onClick={() => prepare(false)}>
            {pending === "prepare" ? "Preparing..." : "Prepare intent only"}
          </button>
          <button className="button-primary" type="button"
            disabled={Boolean(pending) || !executionAvailable || !invocationBindingId || !reservationId || !userText}
            onClick={() => prepare(true)}>
            {pending === "prepare-execute" ? "Preparing and executing..." : "Prepare and execute once"}
          </button>
          {!executionAvailable && <small>One-shot execution requires the deployment gate, encryption vault, and a current workspace enablement window.</small>}
        </div>
      )}
      <div className="ai-reservation-list">
        {intents.map((intent) => (
          <article key={intent.id}>
            <div>
              <h3>{label(intent.feature)}</h3>
              <p>{intent.provider} / {intent.modelId} - {intent.estimatedCostMinor} {intent.currency} minor units - {label(intent.status)}</p>
              <small>Prompt retained: no - provider request: no - authorization {intent.authorizationCurrent ? "current" : "not current"}</small>
              {intent.productBound && <small>Governed Draft revision: {label(intent.draftRevisionGoal ?? "revision")} - execute from the exact source Draft - source context hash retained privately</small>}
            </div>
            {intent.status === "prepared" && canEdit && !intent.productBound ? (
              <div className="ai-provider-connection-actions">
                <button className="button-primary" type="button"
                  disabled={Boolean(pending) || !executionAvailable || !userText}
                  onClick={() => execute(intent.id)}>
                  {pending === `execute:${intent.id}` ? "Executing..." : "Execute exact prompt above once"}
                </button>
                <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={() => cancel(intent.id)}>{pending === intent.id ? "Cancelling..." : "Cancel and release"}</button>
              </div>
            ) : <span className={`status-pill ${intent.authorizationCurrent ? "status-green" : "status-amber"}`}>{intent.authorizationCurrent ? "Current" : label(intent.status)}</span>}
          </article>
        ))}
      </div>
      {intents.length === 0 && <p className="ai-selection-summary">No text invocation intent has been prepared.</p>}
      <h3>Provider-attempt evidence</h3>
      <p className="ai-selection-summary">Attempts are created only by the internal executor. Ambiguous or abandoned claims are never retried automatically.</p>
      <div className="ai-reservation-list">
        {attempts.map((attempt) => (
          <article key={attempt.id}>
            <div>
              <h3>{attempt.provider} / {attempt.modelId}</h3>
              <p>{label(attempt.status)} - provider request {label(attempt.providerRequestStatus)} - retry no</p>
              <small>Output retained encrypted: {attempt.outputEncrypted ? "yes" : "no"} - hash evidence: {attempt.outputHashStored ? "yes" : "no"}</small>
              {resolutions.find((resolution) => resolution.attemptId === attempt.id) && (
                <small>
                  Resolved: {label(resolutions.find((resolution) => resolution.attemptId === attempt.id)!.disposition)} - reservation {label(resolutions.find((resolution) => resolution.attemptId === attempt.id)!.reservationFinalStatus)} - retry no
                </small>
              )}
              {canApprove && !resolutions.some((resolution) => resolution.attemptId === attempt.id) &&
                (attempt.status === "ambiguous" || reconciliations.some((reconciliation) => reconciliation.attemptId === attempt.id && reconciliation.status === "quarantined")) && (
                <div className="settings-form ai-invocation-resolution-form">
                  <label>Reviewed billing outcome
                    <select value={resolutionDispositions[attempt.id] ?? "confirmed_no_charge"} onChange={(event) => setResolutionDispositions((current) => ({ ...current, [attempt.id]: event.target.value as "confirmed_no_charge" | "settled_provider_charge" }))}>
                      <option value="confirmed_no_charge">Provider confirms no charge</option>
                      <option value="settled_provider_charge">Provider statement confirms charge</option>
                    </select>
                  </label>
                  {(resolutionDispositions[attempt.id] ?? "confirmed_no_charge") === "settled_provider_charge" && (
                    <label>Confirmed charge (minor units)
                      <input type="number" min={1} max={1_000_000_000} value={resolutionCharges[attempt.id] ?? ""} onChange={(event) => setResolutionCharges((current) => ({ ...current, [attempt.id]: event.target.value }))} />
                    </label>
                  )}
                  <label>Provider statement, invoice, or incident reference
                    <input value={resolutionEvidence[attempt.id] ?? ""} maxLength={1_000} onChange={(event) => setResolutionEvidence((current) => ({ ...current, [attempt.id]: event.target.value }))} />
                  </label>
                  <label>Resolution note
                    <textarea value={resolutionNotes[attempt.id] ?? ""} maxLength={1_000} onChange={(event) => setResolutionNotes((current) => ({ ...current, [attempt.id]: event.target.value }))} />
                  </label>
                  <button className="button-secondary" type="button" disabled={Boolean(pending) || (resolutionEvidence[attempt.id]?.trim().length ?? 0) < 3 || (resolutionNotes[attempt.id]?.trim().length ?? 0) < 3 || ((resolutionDispositions[attempt.id] ?? "confirmed_no_charge") === "settled_provider_charge" && Number(resolutionCharges[attempt.id]) < 1)} onClick={() => resolveAttempt(attempt.id)}>
                    {pending === `resolve:${attempt.id}` ? "Resolving..." : "Record reviewed resolution"}
                  </button>
                </div>
              )}
            </div>
            <span className={`status-pill ${attempt.status === "succeeded" ? "status-green" : "status-amber"}`}>{label(attempt.status)}</span>
          </article>
        ))}
      </div>
      {attempts.length === 0 && <p className="ai-selection-summary">No provider attempt has been claimed.</p>}
      <h3>Encrypted output review</h3>
      <p className="ai-selection-summary">Successful output remains encrypted at rest. Approval records a review decision only; it does not publish or create a draft.</p>
      <div className="ai-reservation-list">
        {outputArtifacts.map((artifact) => (
          <article key={artifact.id}>
            <div>
              <h3>{artifact.provider} / {artifact.modelId}</h3>
              <p>{label(artifact.status)} - {artifact.characterCount.toLocaleString()} characters - publishing authorized: no</p>
              <small>Stored encrypted: yes - output and hash omitted from this ledger</small>
              {canApprove && artifact.status !== "discarded" && (
                <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={() => inspectOutput(artifact.id)}>
                  {pending === `read:${artifact.id}` ? "Opening..." : "Open for review"}
                </button>
              )}
              {artifact.status === "accepted" && canEdit && !draftProposals.some((proposal) => proposal.artifactId === artifact.id) && (
                <div className="settings-form">
                  <label>Editable Draft
                    <select value={draftSelection} onChange={(event) => setDraftSelection(event.target.value)}>
                      <option value="">Select a governed Draft</option>
                      {draftTargets.filter((draft) => !artifact.sourceContentDraftId || draft.id === artifact.sourceContentDraftId).map((draft) => <option key={draft.id} value={draft.id}>{draft.label}</option>)}
                    </select>
                  </label>
                  {artifact.productBound && <small>This output can attach only to its exact governed source Draft while that version remains current.</small>}
                  <button className="button-secondary" type="button" disabled={Boolean(pending) || !draftSelection} onClick={() => attachToDraft(artifact.id)}>
                    {pending === `attach:${artifact.id}` ? "Attaching..." : "Attach as Draft proposal"}
                  </button>
                </div>
              )}
              {draftProposals.some((proposal) => proposal.artifactId === artifact.id) && <small>Governed Draft proposal attached; Draft content remains unchanged.</small>}
            </div>
            <span className={`status-pill ${artifact.status === "accepted" ? "status-green" : "status-amber"}`}>{label(artifact.status)}</span>
          </article>
        ))}
      </div>
      {outputArtifacts.length === 0 && <p className="ai-selection-summary">No encrypted output artifact has been created.</p>}
      {selectedArtifactId && (
        <div className="settings-form">
          <label>Decrypted output for active review
            <textarea readOnly value={outputPreview} rows={10} />
          </label>
          {outputArtifacts.find((artifact) => artifact.id === selectedArtifactId)?.status === "pending_review" && (
            <>
              <label>Review note
                <textarea required value={reviewNote} maxLength={1_000} onChange={(event) => setReviewNote(event.target.value)} />
              </label>
              <div className="button-row">
                <button className="button-secondary" type="button" disabled={Boolean(pending) || !reviewNote.trim()} onClick={() => reviewOutput(selectedArtifactId, "accepted")}>Accept</button>
                <button className="button-secondary" type="button" disabled={Boolean(pending) || !reviewNote.trim()} onClick={() => reviewOutput(selectedArtifactId, "discarded")}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}
      <h3>Usage reconciliation</h3>
      <div className="ai-reservation-list">
        {reconciliations.map((reconciliation) => (
          <article key={reconciliation.id}>
            <div>
              <h3>{label(reconciliation.status)}</h3>
              <p>{reconciliation.reason ? label(reconciliation.reason) : `${reconciliation.actualCostMinor ?? 0} ${reconciliation.currency} minor units`}</p>
              <small>Usage recorded: {reconciliation.usageRecorded ? "yes" : "no"} - reservation settled: {reconciliation.reservationSettled ? "yes" : "no"} - retry: no</small>
            </div>
            <span className={`status-pill ${reconciliation.status === "settled" ? "status-green" : "status-amber"}`}>{label(reconciliation.status)}</span>
          </article>
        ))}
      </div>
      {reconciliations.length === 0 && <p className="ai-selection-summary">No successful attempt has reached reconciliation.</p>}
      <h3>Reviewed incident resolutions</h3>
      <p className="ai-selection-summary">Resolution never retries a provider request or invents token counts. Confirmed charges are budgeted from provider evidence; no-charge outcomes release or close the hold.</p>
      <div className="ai-reservation-list">
        {resolutions.map((resolution) => (
          <article key={resolution.id}>
            <div>
              <h3>{resolution.provider} / {resolution.modelId}</h3>
              <p>{label(resolution.disposition)}{resolution.providerChargeMinor !== undefined ? ` - ${resolution.providerChargeMinor} ${resolution.currency} minor units` : ""}</p>
              <small>Reservation {label(resolution.reservationPreviousStatus)} to {label(resolution.reservationFinalStatus)} - usage units known: no - provider request retried: no</small>
              <small>Evidence: {resolution.evidenceReference}</small>
              <small>Note: {resolution.resolutionNote}</small>
            </div>
            <span className="status-pill status-green">Resolved</span>
          </article>
        ))}
      </div>
      {resolutions.length === 0 && <p className="ai-selection-summary">No ambiguous or quarantined invocation has a reviewed resolution.</p>}
      {message && <p className={message.kind === "success" ? "form-success" : "form-error"} role="status">{message.text}</p>}
    </section>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " ").replace(/^./, (character) => character.toUpperCase());
}
