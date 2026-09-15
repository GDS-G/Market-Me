"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ContentPackageReview } from "@market-me/database";
import { PackageReviewSnapshot, PackageReviewState } from "./content-package-review-display";
import { isScopedPackageReview } from "./content-package-review-actions";
import { packageReviewRequestPath } from "./content-package-review-request";
import styles from "./content-package-review.module.css";

/** List options are only hints. This explicit load returns the coherent content and token used by a new request. */
export function ApprovedPackageReviewPicker({ workspaceId, packageId, disabled, onReview }: {
  workspaceId: string; packageId: string; disabled: boolean; onReview: (review: ContentPackageReview | undefined) => void;
}) {
  const [review, setReview] = useState<ContentPackageReview>();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; }, []);
  async function load() {
    if (disabled || pending || !packageId) return;
    const request = ++sequence.current; setPending(true); setError(""); setReview(undefined); onReview(undefined);
    try {
      const response = await fetch(packageReviewRequestPath(packageId, workspaceId), { cache: "no-store" });
      const payload = await response.json().catch(() => undefined);
      if (sequence.current !== request) return;
      if (!response.ok || !isScopedPackageReview(payload?.data, { userId: "", workspaceId, packageId })) {
        setError(payload?.error?.message ?? "The exact approved package review could not be loaded."); return;
      }
      const current = payload.data as ContentPackageReview; setReview(current);
      if (current.currentApprovalValid && current.currentApproval && current.blockers.length === 0) onReview(current);
      else setError("This package has no currently valid exact approval. Open its review, resolve blockers, and approve it before creating new work.");
    } catch { if (sequence.current === request) setError("The exact review could not be loaded. No new work was requested."); }
    finally { if (sequence.current === request) setPending(false); }
  }
  return <section className={styles.sections} aria-label="Selected package approval proof">
    <div className="form-actions"><button type="button" className="button-secondary" disabled={disabled || pending || !packageId} onClick={() => void load()}>{pending ? "Loading captured review…" : "Load exact approved package review"}</button>
      {packageId && <Link href={`/content-packages/${packageId}`}>Open package review</Link>}</div>
    <p>Package-list names and status are not proof. Load and inspect the exact approved review before continuing; this step does not approve anything.</p>
    {review && <><PackageReviewState review={review} /><details className={styles.notice} open><summary>Captured source revision {review.version}: {review.snapshot.package.title}</summary>
      <PackageReviewSnapshot snapshot={review.snapshot} effectiveEvidenceIds={review.effectiveEvidenceIds} excludedEvidenceIds={review.excludedEvidenceIds} /></details></>}
    {error && <p className="form-error" role="alert">{error}</p>}{pending && <p role="status">Loading the current review and its matching token…</p>}
  </section>;
}
