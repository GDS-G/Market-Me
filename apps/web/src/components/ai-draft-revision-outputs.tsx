"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiTextDraftProposal, AiTextOutputArtifact } from "@market-me/domain";

function label(value: string) {
  return value.replaceAll("_", " ");
}

export function AiDraftRevisionOutputs({
  workspaceId,
  contentDraftId,
  contentDraftVersionId,
  outputArtifacts,
  proposals,
  canApprove,
  canEdit,
  vaultAvailable,
}: {
  workspaceId: string;
  contentDraftId: string;
  contentDraftVersionId: string;
  outputArtifacts: readonly AiTextOutputArtifact[];
  proposals: readonly AiTextDraftProposal[];
  canApprove: boolean;
  canEdit: boolean;
  vaultAvailable: boolean;
}) {
  const router = useRouter();
  const draftArtifacts = outputArtifacts.filter((artifact) =>
    artifact.productBound && artifact.sourceContentDraftId === contentDraftId,
  );
  const attachedArtifactIds = new Set(proposals.map((proposal) => proposal.artifactId));
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [outputText, setOutputText] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();

  async function open(artifactId: string) {
    setPending(`open:${artifactId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-outputs/${artifactId}?workspaceId=${workspaceId}`);
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not open the encrypted Draft revision output." });
      return;
    }
    setSelectedArtifactId(artifactId);
    setOutputText(body.data.outputText);
    setReviewNote("");
  }

  async function review(artifactId: string, decision: "accepted" | "discarded") {
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
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not record the Draft revision output review." });
      return;
    }
    setSelectedArtifactId("");
    setOutputText("");
    setReviewNote("");
    setMessage({
      kind: "success",
      text: decision === "accepted"
        ? "Output accepted for source-locked Draft attachment. No Draft content changed."
        : "Output discarded. No Draft content changed.",
    });
    router.refresh();
  }

  async function attach(artifactId: string) {
    setPending(`attach:${artifactId}`);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-text-outputs/${artifactId}/attach-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, contentDraftId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({ kind: "error", text: body?.error?.message ?? "Could not attach the accepted output to this Draft." });
      return;
    }
    setSelectedArtifactId("");
    setOutputText("");
    setMessage({ kind: "success", text: "Accepted output attached as a read-only governed proposal. The Draft is unchanged." });
    router.refresh();
  }

  const selectedArtifact = draftArtifacts.find((artifact) => artifact.id === selectedArtifactId);

  return <section className="resource-panel ai-invocation-intent-panel">
    <div className="resource-panel-head">
      <div>
        <p className="eyebrow">Human review boundary</p>
        <h2>Draft revision output review</h2>
        <p>Provider output remains encrypted until an approver opens one exact artifact. Acceptance and attachment do not change this Draft.</p>
      </div>
      <span className="status-pill status-neutral">{draftArtifacts.length} source-bound</span>
    </div>
    <div className="ai-reservation-list">
      {draftArtifacts.map((artifact) => {
        const sourceCurrent = artifact.sourceContentDraftVersionId === contentDraftVersionId;
        const attached = attachedArtifactIds.has(artifact.id);
        return <article key={artifact.id}>
          <div>
            <h3>{artifact.provider} / {artifact.modelId}</h3>
            <p>{label(artifact.status)} · {artifact.characterCount.toLocaleString()} characters · {label(artifact.draftRevisionGoal ?? "revision")}</p>
            <small>Encrypted at rest: yes · source version {sourceCurrent ? "current" : "superseded"} · publishing authorized: no</small>
            {canApprove && artifact.status !== "discarded" && <button
              className="button-secondary"
              type="button"
              disabled={Boolean(pending) || !vaultAvailable}
              onClick={() => open(artifact.id)}
            >
              {pending === `open:${artifact.id}` ? "Opening..." : artifact.status === "accepted" ? "Open accepted output" : "Open for approval review"}
            </button>}
            {artifact.status === "accepted" && canEdit && !attached && <button
              className="button-secondary"
              type="button"
              disabled={Boolean(pending) || !sourceCurrent}
              onClick={() => attach(artifact.id)}
            >
              {pending === `attach:${artifact.id}` ? "Attaching..." : "Attach accepted output to this Draft"}
            </button>}
            {attached && <small>Read-only governed proposal attached; review selected presentation fields below.</small>}
            {!sourceCurrent && artifact.status === "accepted" && !attached && <small>This output cannot attach because its exact source Draft version is no longer current.</small>}
          </div>
          <span className={`status-pill ${artifact.status === "accepted" ? "status-green" : artifact.status === "discarded" ? "status-neutral" : "status-amber"}`}>{label(artifact.status)}</span>
        </article>;
      })}
    </div>
    {!draftArtifacts.length && <p className="ai-selection-summary">No encrypted output is bound to this Draft yet.</p>}
    {!vaultAvailable && canApprove && <p className="form-help">Output review remains unavailable until the deployment AI vault is configured. Attachment of an already accepted artifact still uses its separate writer boundary.</p>}
    {selectedArtifact && <div className="settings-form">
      <label>Decrypted output for this active review only
        <textarea readOnly rows={10} value={outputText} />
      </label>
      {selectedArtifact.status === "pending_review" && <>
        <label>Required review note
          <textarea required maxLength={1_000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
        </label>
        <div className="button-row">
          <button className="button-secondary" type="button" disabled={Boolean(pending) || !reviewNote.trim()} onClick={() => review(selectedArtifact.id, "accepted")}>Accept for Draft proposal</button>
          <button className="button-secondary" type="button" disabled={Boolean(pending) || !reviewNote.trim()} onClick={() => review(selectedArtifact.id, "discarded")}>Discard output</button>
        </div>
      </>}
      <button className="button-secondary" type="button" disabled={Boolean(pending)} onClick={() => { setSelectedArtifactId(""); setOutputText(""); setReviewNote(""); }}>Close decrypted view</button>
    </div>}
    {message && <p className={message.kind === "error" ? "form-message form-error" : "form-message form-success"} role="status">{message.text}</p>}
  </section>;
}
