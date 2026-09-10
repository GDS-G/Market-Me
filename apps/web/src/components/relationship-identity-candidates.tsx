"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  RelationshipIdentityCandidateScanResult,
  StoredRelationshipIdentityLink,
} from "@market-me/database";

export function RelationshipIdentityCandidates({
  workspaceId,
  suggestions,
}: {
  workspaceId: string;
  suggestions: readonly StoredRelationshipIdentityLink[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<RelationshipIdentityCandidateScanResult>();
  const [error, setError] = useState("");

  async function scan() {
    setPending(true);
    setError("");
    const response = await fetch("/api/v1/relationship-identity-candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not scan identity evidence.");
      return;
    }
    setResult(payload.data);
    router.refresh();
  }

  return (
    <section className="resource-panel identity-candidate-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Deterministic identity discovery</p>
          <h2>Strong-evidence match queue</h2>
          <p>
            Scan verified exact addresses, canonical HTTPS profile links, and
            namespaced strong identifiers. Names, organizations, notes,
            messages, and model output are never compared.
          </p>
        </div>
        <button
          className="button-secondary"
          disabled={pending}
          onClick={scan}
          type="button"
        >
          {pending ? "Scanning…" : "Scan strong evidence"}
        </button>
      </div>
      {result && (
        <p className="form-help" role="status">
          Scanned {result.scannedIdentityCount} verified identities; found {result.matchedPairCount} strong pair{result.matchedPairCount === 1 ? "" : "s"} and created {result.createdSuggestionCount} new suggestion{result.createdSuggestionCount === 1 ? "" : "s"}.
          {result.skippedExistingCount > 0
            ? ` ${result.skippedExistingCount} already reviewed or linked.`
            : ""}
          {result.ambiguousSignalCount > 0
            ? ` ${result.ambiguousSignalCount} non-discriminating signal${result.ambiguousSignalCount === 1 ? " was" : "s were"} ignored.`
            : ""}
          {result.scanTruncated ? " The bounded scan reached its limit." : ""}
        </p>
      )}
      {suggestions.length === 0 ? (
        <p className="form-help">No unconfirmed strong-evidence matches.</p>
      ) : (
        <div className="identity-candidate-grid">
          {suggestions.map((suggestion) => (
            <article className="identity-link-card" key={suggestion.id}>
              <div>
                <strong>
                  {suggestion.relationshipAName} ↔ {suggestion.relationshipBName}
                </strong>
                <p>
                  {label(suggestion.evidenceKind)} · {Math.round(suggestion.confidence * 100)}% confidence · {suggestion.origin === "deterministic_scan" ? "deterministic scan" : "manual evidence"}
                </p>
              </div>
              <span className="status-pill status-amber">Suggested</span>
              <div className="identity-link-actions">
                <Link
                  className="button-secondary"
                  href={`/conversations/${suggestion.relationshipAId}/edit`}
                >
                  Review match
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
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
