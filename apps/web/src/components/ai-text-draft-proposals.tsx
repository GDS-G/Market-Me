"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiDraftRevisionSuggestionParseResult, AiTextDraftProposal } from "@market-me/domain";

interface DraftPresentationFields {
  leadIn: string;
  callToAction: string;
  hashtags: readonly string[];
  altText: string;
}

type SuggestionField = "leadIn" | "callToAction" | "hashtags" | "altText";

export function AiTextDraftProposals({
  workspaceId,
  proposals,
  canEdit,
  draftPresentation,
}: {
  workspaceId: string;
  proposals: readonly AiTextDraftProposal[];
  canEdit: boolean;
  draftPresentation: DraftPresentationFields;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [outputText, setOutputText] = useState("");
  const [suggestionParse, setSuggestionParse] = useState<AiDraftRevisionSuggestionParseResult>();
  const [selectedSuggestionFields, setSelectedSuggestionFields] = useState<readonly SuggestionField[]>([]);
  const [leadIn, setLeadIn] = useState(draftPresentation.leadIn);
  const [callToAction, setCallToAction] = useState(draftPresentation.callToAction);
  const [hashtags, setHashtags] = useState(draftPresentation.hashtags.join(" "));
  const [altText, setAltText] = useState(draftPresentation.altText);
  const [changeNote, setChangeNote] = useState("");
  const [dismissalNote, setDismissalNote] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function open(proposalId: string) {
    setPending(`open:${proposalId}`);
    setError("");
    setSuggestionParse(undefined);
    setSelectedSuggestionFields([]);
    const response = await fetch(
      `/api/v1/ai-text-draft-proposals/${proposalId}?workspaceId=${workspaceId}`,
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(body?.error?.message ?? "Could not open the Draft proposal.");
      return;
    }
    setSelectedId(proposalId);
    setOutputText(body.data.outputText);
    setSuggestionParse(body.data.suggestionParse);
    setSelectedSuggestionFields([]);
    setLeadIn(draftPresentation.leadIn);
    setCallToAction(draftPresentation.callToAction);
    setHashtags(draftPresentation.hashtags.join(" "));
    setAltText(draftPresentation.altText);
    setChangeNote("");
    setDismissalNote("");
  }

  async function apply(proposalId: string) {
    setPending(`apply:${proposalId}`);
    setError("");
    const response = await fetch(`/api/v1/ai-text-draft-proposals/${proposalId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        leadIn,
        callToAction: callToAction || undefined,
        hashtags: hashtags.split(/\s+/u).filter(Boolean),
        altText: altText || undefined,
        changeNote,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(body?.error?.message ?? "Could not apply the Draft proposal.");
      return;
    }
    setSelectedId("");
    setOutputText("");
    setSuggestionParse(undefined);
    setSelectedSuggestionFields([]);
    setChangeNote("");
    router.refresh();
  }

  async function dismiss(proposalId: string) {
    setPending(`dismiss:${proposalId}`);
    setError("");
    const response = await fetch(`/api/v1/ai-text-draft-proposals/${proposalId}/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, dismissalNote }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(body?.error?.message ?? "Could not dismiss the Draft proposal.");
      return;
    }
    setSelectedId("");
    setOutputText("");
    setSuggestionParse(undefined);
    setSelectedSuggestionFields([]);
    setDismissalNote("");
    router.refresh();
  }

  function useValidatedSuggestions() {
    const suggestion = suggestionParse?.suggestion;
    if (!suggestion) return;
    if (selectedSuggestionFields.includes("leadIn") && suggestion.leadIn !== undefined) setLeadIn(suggestion.leadIn);
    if (selectedSuggestionFields.includes("callToAction") && suggestion.callToAction !== undefined) setCallToAction(suggestion.callToAction);
    if (selectedSuggestionFields.includes("hashtags") && suggestion.hashtags !== undefined) setHashtags(suggestion.hashtags.join(" "));
    if (selectedSuggestionFields.includes("altText") && suggestion.altText !== undefined) setAltText(suggestion.altText);
    setSelectedSuggestionFields([]);
  }

  function toggleSuggestionField(field: SuggestionField, checked: boolean) {
    setSelectedSuggestionFields((current) => checked
      ? [...current, field]
      : current.filter((candidate) => candidate !== field));
  }

  if (!proposals.length) return null;
  return <section className="resource-panel draft-trace">
    <div className="resource-panel-head">
      <div>
        <h2>Accepted AI proposals</h2>
        <p>Encrypted suggestions are attached to one exact Draft version. An author may copy only reviewed presentation choices into a new immutable version; evidence-backed facts remain fixed.</p>
      </div>
      <span className="status-pill status-neutral">Author controlled</span>
    </div>
    <div className="ai-reservation-list">
      {proposals.map((proposal) => <article key={proposal.id}>
        <div>
          <h3>{proposal.provider} / {proposal.modelId}</h3>
          <p>{proposal.status.replaceAll("_", " ")} • {proposal.characterCount.toLocaleString()} characters • source {proposal.sourceCurrent ? "current" : "superseded"}</p>
          <small>Encrypted: yes • Draft mutated: {proposal.draftContentMutated ? "successor created" : "no"} • publishing authorized: no</small>
          {proposal.selectedFields?.length
            ? <small>Applied fields: {proposal.selectedFields.map((field) => field.replaceAll("_", " ")).join(", ")}</small>
            : null}
          {canEdit && proposal.status === "attached" && proposal.sourceCurrent
            ? <button
                className="button-secondary"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => open(proposal.id)}
              >
                {pending === `open:${proposal.id}` ? "Opening..." : "Review proposal"}
              </button>
            : null}
        </div>
        <span className={`status-pill ${proposal.status === "attached" && proposal.sourceCurrent ? "status-amber" : proposal.status === "applied" ? "status-green" : "status-neutral"}`}>
          {proposal.status}
        </span>
      </article>)}
    </div>
    {selectedId
      ? <div className="settings-form">
          <label>
            Accepted proposal text
            <textarea readOnly rows={10} value={outputText} />
          </label>
          <p className="form-help">Use the output only as a reference. Manually choose the presentation values below. The server reconstructs the body from the source version&apos;s evidence-bound facts and creates a successor that still requires normal approval.</p>
          {suggestionParse?.status === "valid" && suggestionParse.suggestion
            ? <div className="ai-selection-summary">
                <strong>Validated presentation-only suggestions available</strong>
                <p>{suggestionParse.suggestion.rationale}</p>
                {(["leadIn", "callToAction", "hashtags", "altText"] as const)
                  .filter((field) => suggestionParse.suggestion?.[field] !== undefined)
                  .map((field) => <label key={field}>
                    <input type="checkbox" checked={selectedSuggestionFields.includes(field)} onChange={(event) => toggleSuggestionField(field, event.target.checked)} />
                    Use suggested {field === "leadIn" ? "lead-in" : field === "callToAction" ? "call to action" : field === "altText" ? "alternative text" : "hashtags"}
                  </label>)}
                <button className="button-secondary" type="button" disabled={Boolean(pending) || !selectedSuggestionFields.length} onClick={useValidatedSuggestions}>Fill selected suggestions</button>
                <small>Nothing is selected automatically. This fills only the checked bounded presentation controls below; review and edit them before explicitly creating a successor.</small>
              </div>
            : suggestionParse
              ? <p className="form-help">Structured suggestions are unavailable: {suggestionParse.issues.join(" ")} The full reviewed output remains visible for manual reference.</p>
              : null}
          <label>
            Presentation lead-in
            <input maxLength={500} value={leadIn} onChange={(event) => setLeadIn(event.target.value)} placeholder="For local partners" />
          </label>
          <label>
            Call to action
            <input maxLength={1_000} value={callToAction} onChange={(event) => setCallToAction(event.target.value)} />
          </label>
          <label>
            Hashtags
            <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} placeholder="#MarketMe #Launch" />
          </label>
          <label>
            Alternative text
            <textarea maxLength={2_000} value={altText} onChange={(event) => setAltText(event.target.value)} />
          </label>
          <label>
            Required application note
            <textarea required minLength={3} maxLength={1_000} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} />
          </label>
          <button
            className="button-primary"
            type="button"
            disabled={Boolean(pending) || changeNote.trim().length < 3}
            onClick={() => apply(selectedId)}
          >
            {pending === `apply:${selectedId}` ? "Applying..." : "Create evidence-preserving successor"}
          </button>
          <label>
            Dismissal note
            <textarea required maxLength={1_000} value={dismissalNote} onChange={(event) => setDismissalNote(event.target.value)} />
          </label>
          <button
            className="button-secondary"
            type="button"
            disabled={Boolean(pending) || !dismissalNote.trim()}
            onClick={() => dismiss(selectedId)}
          >
            {pending === `dismiss:${selectedId}` ? "Dismissing..." : "Dismiss proposal"}
          </button>
        </div>
      : null}
    {error && <p className="form-error" role="status">{error}</p>}
  </section>;
}
