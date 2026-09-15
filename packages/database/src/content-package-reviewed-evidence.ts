import {
  validateContentPackageReviewSnapshot,
  type ContentPackageReviewConflictV1,
  type ContentPackageReviewEvidenceV1,
} from "./content-package-review-fingerprint";

export const CONTENT_PACKAGE_REVIEWED_EVIDENCE_CONTRACT = "effective-evidence-v1";
export type ContentPackageReviewedEvidenceBlockerCode = "duplicate_evidence_id" | "duplicate_conflict_id"
  | "supersession_invalid" | "conflict_candidates_invalid" | "conflict_open" | "conflict_dismissed"
  | "conflict_resolution_invalid" | "conflict_decisions_inconsistent" | "unresolved_evidence" | "no_effective_evidence";
export interface ContentPackageReviewedEvidenceBlocker {
  readonly code: ContentPackageReviewedEvidenceBlockerCode;
  readonly evidenceIds: readonly string[];
  readonly conflictIds: readonly string[];
  readonly message: string;
}
export interface ContentPackageReviewedEvidenceResult {
  /** Empty when ANY blocker exists; never a partially usable selection from an ambiguous graph. */
  readonly effectiveEvidenceIds: readonly string[];
  /** Known losers, superseded history and unresolved items; not a fabricated classification of other blocked rows. */
  readonly excludedEvidenceIds: readonly string[];
  readonly blockers: readonly ContentPackageReviewedEvidenceBlocker[];
}
const messages: Readonly<Record<ContentPackageReviewedEvidenceBlockerCode, string>> = Object.freeze({
  duplicate_evidence_id: "Evidence IDs must identify exactly one captured row.",
  duplicate_conflict_id: "Conflict IDs must identify exactly one captured row.",
  supersession_invalid: "Supersession must be a local, acyclic one-to-one correction chain.",
  conflict_candidates_invalid: "Conflict candidates must be nonempty, distinct, local active evidence IDs.",
  conflict_open: "Resolve this conflict before approving its evidence.",
  conflict_dismissed: "Reviewed conflict dismissal is not supported by this contract.",
  conflict_resolution_invalid: "A resolved conflict must select exactly one active non-unresolved candidate.",
  conflict_decisions_inconsistent: "An evidence item cannot be selected by one conflict and excluded by another.",
  unresolved_evidence: "Resolve every active unresolved evidence item before approval.",
  no_effective_evidence: "At least one reviewed usable fact is required.",
});
function sortedIds(ids: Iterable<string>): readonly string[] { return Object.freeze([...new Set(ids)].sort()); }

/**
 * Pure evidence decision only. Does not check asset rights, membership, status, clock,
 * receipt provenance or approval. Raw-schema violations throw the fingerprint error;
 * well-shaped but inconsistent historical graphs return closed, deterministic blockers.
 */
export function evaluateReviewedEvidence(input: unknown): ContentPackageReviewedEvidenceResult {
  const snapshot = validateContentPackageReviewSnapshot(input);
  const evidence = new Map<string, ContentPackageReviewEvidenceV1>();
  const conflicts = new Map<string, ContentPackageReviewConflictV1>();
  const duplicateEvidence = new Set<string>(); const duplicateConflicts = new Set<string>();
  const blockers = new Map<string, ContentPackageReviewedEvidenceBlocker>();
  const excluded = new Set<string>();
  const block = (code: ContentPackageReviewedEvidenceBlockerCode, evidenceIds: Iterable<string> = [], conflictIds: Iterable<string> = []) => {
    const ids = sortedIds(evidenceIds); const cids = sortedIds(conflictIds);
    const key = JSON.stringify([code, ids, cids]);
    blockers.set(key, Object.freeze({ code, evidenceIds: ids, conflictIds: cids, message: messages[code] }));
  };
  for (const row of snapshot.evidence) {
    if (evidence.has(row.id)) { duplicateEvidence.add(row.id); block("duplicate_evidence_id", [row.id]); }
    else evidence.set(row.id, row);
  }
  for (const row of snapshot.conflicts) {
    if (conflicts.has(row.id)) { duplicateConflicts.add(row.id); block("duplicate_conflict_id", [], [row.id]); }
    else conflicts.set(row.id, row);
  }
  // Do not select the first/last contradictory duplicate as authoritative even for diagnostic derivation.
  for (const id of duplicateEvidence) evidence.delete(id);
  for (const id of duplicateConflicts) conflicts.delete(id);
  const incoming = new Map<string, string[]>();
  for (const row of evidence.values()) {
    if (row.supersededByEvidenceId !== null) {
      excluded.add(row.id);
      if (row.supersededByEvidenceId === row.id || !evidence.has(row.supersededByEvidenceId)) block("supersession_invalid", [row.id, row.supersededByEvidenceId]);
      const originals = incoming.get(row.supersededByEvidenceId) ?? [];
      originals.push(row.id); incoming.set(row.supersededByEvidenceId, originals);
    } else if (row.provenance === "unresolved") {
      excluded.add(row.id); block("unresolved_evidence", [row.id]);
    }
  }
  for (const [target, originals] of incoming) if (originals.length > 1) block("supersession_invalid", [target, ...originals]);
  // Iterative linear traversal avoids call-stack overflow and quadratic walks at the 10,000-row bound.
  const complete = new Set<string>();
  for (const start of [...evidence.keys()].sort()) {
    if (complete.has(start)) continue;
    const path: string[] = []; const positions = new Map<string, number>();
    let current: string | null = start;
    while (current !== null && evidence.has(current) && !complete.has(current)) {
      const previous = positions.get(current);
      if (previous !== undefined) { block("supersession_invalid", path.slice(previous)); break; }
      positions.set(current, path.length); path.push(current);
      current = evidence.get(current)!.supersededByEvidenceId;
    }
    for (const id of path) complete.add(id);
  }
  const winners = new Map<string, Set<string>>();
  const losers = new Map<string, Set<string>>();
  const record = (map: Map<string, Set<string>>, id: string, conflictId: string) => {
    const owners = map.get(id) ?? new Set<string>(); owners.add(conflictId); map.set(id, owners);
  };
  for (const conflict of conflicts.values()) {
    const candidates = new Set(conflict.candidateEvidenceIds);
    const invalidCandidates = [...candidates].filter((id) => !evidence.has(id) || evidence.get(id)!.supersededByEvidenceId !== null);
    if (!candidates.size || candidates.size !== conflict.candidateEvidenceIds.length || invalidCandidates.length) {
      block("conflict_candidates_invalid", conflict.candidateEvidenceIds, [conflict.id]);
    }
    if (conflict.status === "open") { block("conflict_open", [], [conflict.id]); continue; }
    if (conflict.status === "dismissed") { block("conflict_dismissed", [], [conflict.id]); continue; }
    const winner = conflict.resolutionEvidenceId;
    const selected = winner === null ? undefined : evidence.get(winner);
    if (winner === null || !candidates.has(winner) || !selected || selected.supersededByEvidenceId !== null || selected.provenance === "unresolved") {
      block("conflict_resolution_invalid", winner === null ? [] : [winner], [conflict.id]); continue;
    }
    record(winners, winner, conflict.id);
    for (const candidate of candidates) if (candidate !== winner) {
      record(losers, candidate, conflict.id);
      if (evidence.has(candidate)) excluded.add(candidate);
    }
  }
  for (const [winner, selectedBy] of winners) if (losers.has(winner)) block("conflict_decisions_inconsistent", [winner], [...selectedBy, ...losers.get(winner)!]);
  const eligible = [...evidence.values()].filter((row) => row.supersededByEvidenceId === null && row.provenance !== "unresolved" && !losers.has(row.id)).map((row) => row.id);
  if (!eligible.length) block("no_effective_evidence");
  const orderedBlockers = Object.freeze([...blockers.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, item]) => item));
  return Object.freeze({ effectiveEvidenceIds: sortedIds(orderedBlockers.length ? [] : eligible), excludedEvidenceIds: sortedIds(excluded), blockers: orderedBlockers });
}
