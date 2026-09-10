"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  StoredRelationship,
  StoredRelationshipIdentityResolution,
} from "@market-me/database";
import { RELATIONSHIP_IDENTITY_EVIDENCE_KINDS } from "@market-me/domain";

type Candidate = Pick<
  StoredRelationship,
  "id" | "displayName" | "organizationName" | "identities"
>;

export function RelationshipIdentityResolution({
  workspaceId,
  relationshipId,
  resolution,
  candidates,
}: {
  workspaceId: string;
  relationshipId: string;
  resolution: StoredRelationshipIdentityResolution;
  candidates: readonly Candidate[];
}) {
  const router = useRouter();
  const confirmedIds = useMemo(
    () => new Set(resolution.members.map((member) => member.id)),
    [resolution.members],
  );
  const eligibleCandidates = candidates.filter(
    (candidate) => !confirmedIds.has(candidate.id),
  );
  const [candidateRelationshipId, setCandidateRelationshipId] = useState(
    eligibleCandidates[0]?.id ?? "",
  );
  const [evidenceKind, setEvidenceKind] = useState(
    "strong_identifier",
  );
  const [confidence, setConfidence] = useState("0.900");
  const [initialStatus, setInitialStatus] = useState<
    "suggested" | "confirmed"
  >("suggested");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/relationships/${relationshipId}/identity-links`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          candidateRelationshipId,
          evidenceKind,
          confidence: Number(confidence),
          initialStatus,
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not save the identity link.");
      return;
    }
    router.refresh();
  }

  async function decide(linkId: string, status: "confirmed" | "dismissed") {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/relationships/${relationshipId}/identity-links/${linkId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not review the identity link.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="resource-panel identity-resolution-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Reviewed identity resolution</p>
          <h2>Shared relationship view</h2>
          <p>
            Confirmed links preserve each provider identity and conversation
            root. Similar names and speculative model output are never evidence.
          </p>
        </div>
        <span
          className={`status-pill ${
            resolution.effectiveContactPermission === "suppressed"
              ? "status-red"
              : "status-green"
          }`}
        >
          {resolution.effectiveContactPermission === "suppressed"
            ? "shared view: do not contact"
            : "shared view: contact allowed"}
        </span>
      </div>

      <div className="identity-group-grid">
        {resolution.members.map((member) => (
          <article className="identity-member-card" key={member.id}>
            <div>
              <strong>{member.displayName}</strong>
              <p>{member.organizationName || "Independent contact"}</p>
            </div>
            <span className="status-pill status-neutral">
              {member.id === relationshipId ? "current root" : "confirmed root"}
            </span>
            <p>
              {member.identities.length} provider identit
              {member.identities.length === 1 ? "y" : "ies"}
            </p>
            {member.identities.length > 0 && (
              <ul className="identity-provider-list">
                {member.identities.map((identity) => (
                  <li key={identity.id}>
                    {identity.provider}: {identity.displayHandle || identity.providerSubjectId}
                    {identity.status === "verified" ? " · verified" : ""}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      <form className="identity-link-form" onSubmit={submit}>
        <div className="field-grid">
          <label className="field field-wide">
            <span>Candidate relationship</span>
            <select
              disabled={!eligibleCandidates.length}
              required
              value={candidateRelationshipId}
              onChange={(event) => setCandidateRelationshipId(event.target.value)}
            >
              {eligibleCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName} · {candidate.organizationName || "Independent"} · {candidate.identities.length} identities
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Evidence basis</span>
            <select
              value={evidenceKind}
              onChange={(event) => setEvidenceKind(event.target.value)}
            >
              {RELATIONSHIP_IDENTITY_EVIDENCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {label(kind)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Confidence (0–1)</span>
            <input
              max="1"
              min="0"
              required
              step="0.001"
              type="number"
              value={confidence}
              onChange={(event) => setConfidence(event.target.value)}
            />
          </label>
          <label className="field field-wide">
            <span>Initial decision</span>
            <select
              value={initialStatus}
              onChange={(event) =>
                setInitialStatus(event.target.value as "suggested" | "confirmed")
              }
            >
              <option value="suggested">Keep separate as a suggestion</option>
              <option value="confirmed">Confirm shared identity now</option>
            </select>
          </label>
        </div>
        <button
          className="button-primary"
          disabled={pending || !eligibleCandidates.length}
        >
          {pending ? "Saving…" : "Record identity evidence"}
        </button>
        {!eligibleCandidates.length && (
          <p className="form-help">No separate relationship is available to link.</p>
        )}
      </form>

      <div className="identity-link-history">
        <h3>Link evidence and decisions</h3>
        {resolution.links.length === 0 ? (
          <p className="form-help">No identity links have been reviewed.</p>
        ) : (
          resolution.links.map((link) => (
            <article className="identity-link-card" key={link.id}>
              <div>
                <strong>
                  {link.relationshipAName} ↔ {link.relationshipBName}
                </strong>
                <p>
                  {label(link.evidenceKind)} · {Math.round(link.confidence * 100)}%
                  confidence · suggested by {link.suggestedByName}
                </p>
              </div>
              <span className={`status-pill ${linkStatusClass(link.status)}`}>
                {label(link.status)}
              </span>
              <div className="form-actions identity-link-actions">
                {link.status === "suggested" && (
                  <button
                    className="button-primary"
                    disabled={pending}
                    onClick={() => decide(link.id, "confirmed")}
                    type="button"
                  >
                    Confirm link
                  </button>
                )}
                {link.status !== "dismissed" && (
                  <button
                    className="button-secondary"
                    disabled={pending}
                    onClick={() => decide(link.id, "dismissed")}
                    type="button"
                  >
                    {link.status === "confirmed" ? "Separate identities" : "Dismiss"}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function linkStatusClass(status: string): string {
  if (status === "confirmed") return "status-green";
  if (status === "dismissed") return "status-neutral";
  return "status-amber";
}
