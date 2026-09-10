"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_CAPABILITIES,
  type AiCapability,
  type AiHostedProviderType,
  type AiProviderModelInventoryItem,
  type AiWorkspaceAdapterCandidate,
} from "@market-me/domain";

const CAPABILITY_LABELS: Readonly<Record<AiCapability, string>> = {
  generate_text: "Generate text",
  generate_structured_output: "Generate structured output",
  analyze_image: "Analyze image",
  transcribe: "Transcribe",
  embed: "Embed",
  rerank: "Rerank",
  moderate: "Moderate",
  use_tools: "Use tools",
};

interface AiAdapterCandidatesProps {
  workspaceId: string;
  inventories: readonly {
    provider: AiHostedProviderType;
    models: readonly AiProviderModelInventoryItem[];
  }[];
  candidates: readonly AiWorkspaceAdapterCandidate[];
  canSubmit: boolean;
  canDecide: boolean;
}

export function AiAdapterCandidates({
  workspaceId,
  inventories,
  candidates,
  canSubmit,
  canDecide,
}: AiAdapterCandidatesProps) {
  const router = useRouter();
  const activeModels = useMemo(
    () => inventories.flatMap((inventory) => inventory.models.filter((model) => !model.retiredAt)),
    [inventories],
  );
  const [selection, setSelection] = useState("");
  const selected = activeModels.find(
    (model) => JSON.stringify([model.provider, model.modelId]) === selection,
  );
  const [displayName, setDisplayName] = useState("");
  const [capabilities, setCapabilities] = useState<AiCapability[]>(["generate_text"]);
  const [quality, setQuality] = useState("enhanced");
  const [speed, setSpeed] = useState("balanced");
  const [cost, setCost] = useState("medium");
  const [contextLimit, setContextLimit] = useState(32000);
  const [evidenceReference, setEvidenceReference] = useState("");
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();

  function choose(value: string) {
    setSelection(value);
    const model = activeModels.find(
      (item) => JSON.stringify([item.provider, item.modelId]) === value,
    );
    if (model) {
      setDisplayName(model.displayName ?? model.modelId);
      setContextLimit(Math.min(model.inputTokenLimit ?? 32000, 2_000_000));
    }
  }

  function toggleCapability(capability: AiCapability, checked: boolean) {
    setCapabilities((current) =>
      checked ? [...current, capability] : current.filter((value) => value !== capability),
    );
  }

  async function submit() {
    if (!selected) return;
    setPending("submit");
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-adapter-candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        provider: selected.provider,
        modelId: selected.modelId,
        displayName,
        capabilities,
        quality,
        speed,
        cost,
        contextLimit,
        evidenceReference,
        evidenceSha256,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not submit the adapter candidate.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: "Adapter candidate submitted for workspace administrator review.",
    });
    router.refresh();
  }

  async function decide(
    candidate: AiWorkspaceAdapterCandidate,
    decision: "approved" | "rejected",
  ) {
    setPending(candidate.id);
    setMessage(undefined);
    const response = await fetch(`/api/v1/ai-adapter-candidates/${candidate.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        decision,
        reviewNote: reviewNotes[candidate.id] ?? "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not record the candidate decision.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: `Candidate ${decision}; routing and execution remain disabled.`,
    });
    router.refresh();
  }

  const validEvidenceHash = /^[0-9a-f]{64}$/.test(evidenceSha256);

  return (
    <section className="resource-panel ai-adapter-candidate-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Workspace governance boundary</p>
          <h2>Hosted adapter candidates</h2>
          <p>
            Proposals bind reviewed capability claims and evidence to a current discovered model.
            Approval does not register, route, price, or execute an adapter.
          </p>
        </div>
        <span className="status-pill status-amber">Non-routable</span>
      </div>

      {canSubmit && (
        <div className="ai-adapter-candidate-form">
          <label className="field">
            <span>Active discovered model</span>
            <select value={selection} onChange={(event) => choose(event.target.value)}>
              <option value="">Choose a verified inventory model</option>
              {activeModels.map((model) => (
                <option
                  key={`${model.provider}:${model.modelId}`}
                  value={JSON.stringify([model.provider, model.modelId])}
                >
                  {model.provider} / {model.displayName ?? model.modelId}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Candidate display name</span>
            <input
              value={displayName}
              maxLength={160}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <div className="field">
            <span>Claimed capabilities</span>
            <div className="ai-adapter-capability-checks">
              {AI_CAPABILITIES.map((capability) => (
                <label key={capability}>
                  <input
                    type="checkbox"
                    checked={capabilities.includes(capability)}
                    onChange={(event) => toggleCapability(capability, event.target.checked)}
                  />{" "}
                  {CAPABILITY_LABELS[capability]}
                </label>
              ))}
            </div>
          </div>
          <div className="ai-adapter-candidate-selects">
            <label className="field">
              <span>Quality</span>
              <select value={quality} onChange={(event) => setQuality(event.target.value)}>
                <option value="standard">Standard</option>
                <option value="enhanced">Enhanced</option>
                <option value="highest">Highest</option>
              </select>
            </label>
            <label className="field">
              <span>Speed</span>
              <select value={speed} onChange={(event) => setSpeed(event.target.value)}>
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="thorough">Thorough</option>
              </select>
            </label>
            <label className="field">
              <span>Cost class</span>
              <select value={cost} onChange={(event) => setCost(event.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Context limit</span>
            <input
              type="number"
              min={1}
              max={2_000_000}
              value={contextLimit}
              onChange={(event) => setContextLimit(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Capability evidence reference</span>
            <input
              value={evidenceReference}
              maxLength={1000}
              onChange={(event) => setEvidenceReference(event.target.value)}
              placeholder="Official documentation or internal review reference"
            />
          </label>
          <label className="field">
            <span>Evidence SHA-256</span>
            <input
              value={evidenceSha256}
              maxLength={64}
              onChange={(event) => setEvidenceSha256(event.target.value.toLowerCase())}
              placeholder="64 lowercase hexadecimal characters"
            />
          </label>
          <button
            className="button-primary"
            type="button"
            disabled={
              !selected ||
              !displayName.trim() ||
              capabilities.length < 1 ||
              !evidenceReference.trim() ||
              !validEvidenceHash ||
              pending === "submit"
            }
            onClick={submit}
          >
            {pending === "submit" ? "Submitting..." : "Submit candidate"}
          </button>
        </div>
      )}

      <div className="ai-adapter-candidate-list">
        {candidates.length === 0 ? (
          <p>No hosted adapter candidate has been submitted.</p>
        ) : (
          candidates.map((candidate) => (
            <article className="metric-card" key={candidate.id}>
              <div>
                <strong>{candidate.displayName}</strong>
                <p>
                  {candidate.provider} / {candidate.modelId}
                </p>
                <small>
                  {candidate.status} &middot;{" "}
                  {candidate.capabilities.map((value) => CAPABILITY_LABELS[value]).join(", ")}
                  {" "}&middot; cloud &middot; paid reservation required
                </small>
                <small>
                  Evidence: {candidate.evidenceReference} &middot; SHA-256 {candidate.evidenceSha256}
                </small>
                <small>Routing unavailable &middot; adapter inactive &middot; execution disabled</small>
              </div>
              {canDecide && candidate.status === "pending" && (
                <div className="ai-provider-connection-actions">
                  <label className="field">
                    <span>Review note</span>
                    <textarea
                      value={reviewNotes[candidate.id] ?? ""}
                      maxLength={1000}
                      onChange={(event) =>
                        setReviewNotes((current) => ({
                          ...current,
                          [candidate.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div>
                    <button
                      className="button-primary"
                      disabled={pending === candidate.id || !reviewNotes[candidate.id]?.trim()}
                      onClick={() => decide(candidate, "approved")}
                      type="button"
                    >
                      Approve evidence
                    </button>{" "}
                    <button
                      className="button-secondary"
                      disabled={pending === candidate.id || !reviewNotes[candidate.id]?.trim()}
                      onClick={() => decide(candidate, "rejected")}
                      type="button"
                    >
                      Reject
                    </button>
                  </div>
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
