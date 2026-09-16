"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ContentPackageApprovalSummary, ContentPackageReview, StoredContentPackageApproval } from "@market-me/database";
import { PackageReviewSnapshot, PackageReviewState, type CapturedAssetPreview } from "./content-package-review-display";
import { PackageReviewMaterialForms, type PackageRightsChoices } from "./content-package-review-material-forms";
import { canApprovePackage, canEditPackageAssets, createPackageApprovalAttempt, packageApprovalResultPath, packageApprovalStorageKey,
  packageReviewFingerprint, packageReviewRequestPath, packageReviewVersion, restorePackageApprovalAttempt, reviewUuid, sendPackageApprovalAttempt,
  type PackageApprovalAttempt, type PackageReviewScope } from "./content-package-review-request";
import styles from "./content-package-review.module.css";

export interface PackageReviewProps extends PackageReviewScope, PackageRightsChoices {
  initialReview: ContentPackageReview; role: string; approvals: readonly ContentPackageApprovalSummary[]; assetPreviews: readonly CapturedAssetPreview[];
  sourcePreparationEnabled: boolean;
}
const subscribe = () => () => {};
const browser = () => true, server = () => false;
export function ContentPackageReviewActions(props: PackageReviewProps) {
  const hydrated = useSyncExternalStore(subscribe, browser, server);
  return hydrated ? <PackageReviewEditor key={`${props.userId}:${props.workspaceId}:${props.packageId}:${props.initialReview.reviewFingerprint}:${props.initialReview.evaluatedAt}`} {...props} />
    : <><ReviewHeader review={props.initialReview} /><PackageReviewState review={props.initialReview} /><PackageReviewSnapshot snapshot={props.initialReview.snapshot}
      effectiveEvidenceIds={props.initialReview.effectiveEvidenceIds} excludedEvidenceIds={props.initialReview.excludedEvidenceIds} assetPreviews={props.assetPreviews} /><p role="status">Loading review controls and saved approval attempt…</p></>;
}
export function isScopedPackageReview(value: unknown, scope: PackageReviewScope): value is ContentPackageReview {
  const review = value as ContentPackageReview | null;
  return Boolean(review && review.snapshot?.package?.workspaceId === scope.workspaceId && review.snapshot.package.id === scope.packageId
    && review.snapshot.package.version === review.version && packageReviewVersion.safeParse(review.version).success
    && packageReviewFingerprint.safeParse(review.reviewFingerprint).success && typeof review.evaluatedAt === "string"
    && Array.isArray(review.snapshot.assets) && Array.isArray(review.snapshot.evidence) && Array.isArray(review.snapshot.conflicts)
    && Array.isArray(review.blockers) && Array.isArray(review.effectiveEvidenceIds) && Array.isArray(review.excludedEvidenceIds));
}
function ReviewHeader({ review }: { review: ContentPackageReview }) {
  return <header className="resource-header"><div><p className="eyebrow">Exact Content Package review · source revision {review.version}</p><h1>{review.snapshot.package.title}</h1>
    <p>Review captured evidence, conflicts, assets, and permissions together. Approval does not publish or activate anything.</p></div></header>;
}
function PackageReviewEditor(props: PackageReviewProps) {
  const [review, setReview] = useState(props.initialReview);
  const storageKey = packageApprovalStorageKey(props);
  const [restored] = useState(() => {
    try { return { attempt: restorePackageApprovalAttempt(sessionStorage.getItem(storageKey), props), error: "" }; }
    catch { return { attempt: undefined, error: "The saved approval attempt could not be read safely. Check approval history before explicitly clearing it; an earlier request may have completed." }; }
  });
  const [attempt, setAttempt] = useState<PackageApprovalAttempt | undefined>(restored.attempt);
  const [storageError, setStorageError] = useState(restored.error);
  const [pending, setPending] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false), [resetConfirmed, setResetConfirmed] = useState(false);
  const [approval, setApproval] = useState<StoredContentPackageApproval>();
  const [approvals, setApprovals] = useState(props.approvals);
  const inFlight = useRef(false);
  const canApprove = canApprovePackage(props.role), canEdit = canEditPackageAssets(props.role);
  const frozen = Boolean(attempt || storageError);
  function start() { if (inFlight.current) return false; inFlight.current = true; setPending(true); setError(""); setMessage(""); return true; }
  function finish() { inFlight.current = false; setPending(false); }
  function replaceReview(next: unknown) {
    if (!isScopedPackageReview(next, props)) throw new Error("Invalid coherent response");
    setReview(next); setConfirmed(false); setNeedsRefresh(false);
  }
  async function refresh() {
    if (!start()) return;
    try {
      const response = await fetch(packageReviewRequestPath(props.packageId, props.workspaceId), { cache: "no-store" });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) { setError(payload?.error?.message ?? "The current review is unavailable."); setNeedsRefresh(true); return; }
      replaceReview(payload?.data); setMessage("Loaded one current coherent review. All edit fields and confirmation were reset; inspect the content before a new action.");
    } catch { setError("The current review could not be loaded. No mutation was sent."); setNeedsRefresh(true); }
    finally { finish(); }
  }
  async function mutate(path: string, method: "POST" | "PATCH" | "PUT", changes: Record<string, unknown>) {
    if (frozen || needsRefresh || !start()) return;
    try {
      const response = await fetch(`/api/v1/content-packages/${props.packageId}/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...changes,
        workspaceId: props.workspaceId, expectedVersion: review.version, expectedReviewFingerprint: review.reviewFingerprint }) });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) { setError(payload?.error?.message ?? "Review change was not confirmed."); setNeedsRefresh(true); return; }
      replaceReview(payload?.data); setMessage("Change saved. The returned review is shown in full; previous approval and unsaved edit fields are no longer current. Review again before approving.");
    } catch { setError("The change may have completed, but its response was not confirmed. Load the current review before deciding whether another edit is needed. This action will not retry automatically."); setNeedsRefresh(true); }
    finally { finish(); }
  }
  async function approve(checkOnly: boolean) {
    if (storageError || (!checkOnly && !canApprove) || (!attempt && (!confirmed || needsRefresh || review.blockers.length > 0)) || !start()) return;
    let exact = attempt;
    try {
      if (!exact) {
        if (checkOnly) return;
        exact = createPackageApprovalAttempt(props, { workspaceId: props.workspaceId, packageId: props.packageId, expectedVersion: review.version, expectedReviewFingerprint: review.reviewFingerprint }, crypto.randomUUID());
        try { sessionStorage.setItem(storageKey, JSON.stringify(exact)); }
        catch { setStorageError("Browser storage is unavailable. No approval request was sent. Restore storage before approving."); return; }
        setAttempt(exact);
      }
      const response = checkOnly ? await fetch(`/api/v1/content-packages/${props.packageId}/approve?workspaceId=${encodeURIComponent(props.workspaceId)}&idempotencyKey=${encodeURIComponent(exact.idempotencyKey)}`, { cache: "no-store" })
        : await sendPackageApprovalAttempt(exact, props, sessionStorage);
      const payload = await response.json().catch(() => undefined);
      const saved = payload?.data as StoredContentPackageApproval | undefined;
      if (response.ok && saved?.workspaceId === props.workspaceId && saved.contentPackageId === props.packageId && saved.idempotencyKey === exact.idempotencyKey
        && saved.contentPackageVersion === exact.input.expectedVersion && saved.reviewFingerprint === exact.input.expectedReviewFingerprint && reviewUuid.safeParse(saved.id).success) {
        setApproval(saved); setApprovals((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)].slice(0, 50));
        if (payload.review) replaceReview(payload.review);
        else setNeedsRefresh(true);
        setMessage("The original approval receipt is available. Open it for authoritative approval-linked preparation status. A replay does not approve changed content; load the current review separately to check today's eligibility.");
        return;
      }
      if (checkOnly && response.status === 404) { setMessage("No completed approval was found yet. An earlier request may still finish. Check again or retry this same saved approval; do not start a new attempt to recover it."); return; }
      setError(payload?.error?.message ?? "The approval result is uncertain. Check for the original receipt or retry the same saved approval.");
    } catch { setError("The approval result is uncertain. Its exact key and reviewed precondition remain saved in this tab. Check the receipt or retry the same approval."); }
    finally { finish(); }
  }
  function clearAttempt() {
    if (!resetConfirmed || inFlight.current) return;
    try { sessionStorage.removeItem(storageKey); setAttempt(undefined); setStorageError(""); setApproval(undefined); setConfirmed(false); setResetConfirmed(false); setNeedsRefresh(true); setError(""); setMessage("Recovery copy cleared. Load the current review before making a new decision. Existing server receipts were not deleted."); }
    catch { setStorageError("The saved recovery copy could not be cleared. No new action was sent."); }
  }
  return <div className={styles.sections}>
    <ReviewHeader review={review} /><PackageReviewState review={review} />
    <div className="form-actions"><button className="button-secondary" disabled={pending} onClick={() => void refresh()}>Load current review</button>
      {canEdit && review.currentApprovalValid && !needsRefresh && <Link href={`/campaigns/prepare?contentPackageId=${props.packageId}`}>Prepare campaign from approved review</Link>}</div>
    <PackageReviewSnapshot snapshot={review.snapshot} effectiveEvidenceIds={review.effectiveEvidenceIds} excludedEvidenceIds={review.excludedEvidenceIds} assetPreviews={props.assetPreviews} />
    <section className={styles.notice}><h2>Immutable approval history</h2><p>Latest {approvals.length} of up to 50 receipts. These describe their original captured content, not current eligibility.</p>
      {approvals.length ? <ul>{approvals.map((item) => <li key={item.id}><Link href={packageApprovalResultPath(props.packageId, item.id, props.workspaceId)}>Source revision {item.contentPackageVersion} · {item.createdAt}</Link></li>)}</ul> : <p>No exact approval receipts are recorded yet.</p>}</section>
    {frozen && <section className={styles.notice}><h2>Saved approval attempt</h2><p>This recovery attempt is separate from the current review above. Retrying reuses its original key and precondition; it never approves newer content.</p>
      {attempt && <><p>Saved source revision {attempt.input.expectedVersion}</p><p className={styles.break}>Saved fingerprint <code>{attempt.input.expectedReviewFingerprint}</code></p>
        <div className="form-actions"><button className="button-secondary" disabled={pending} onClick={() => void approve(true)}>Check original approval result</button>
          {canApprove && <button className="button-secondary" disabled={pending} onClick={() => void approve(false)}>Retry same approval</button>}</div></>}
      <label className="check-row"><input type="checkbox" checked={resetConfirmed} disabled={pending} onChange={(event) => setResetConfirmed(event.target.checked)} />I checked approval history and understand clearing this copy does not cancel an earlier request.</label>
      <div className="form-actions"><button className="button-secondary" disabled={pending || !resetConfirmed} onClick={clearAttempt}>Clear saved attempt and review current content</button></div>
    </section>}
    {(canEdit || canApprove) && <PackageReviewMaterialForms key={`${review.reviewFingerprint}:${review.evaluatedAt}`} snapshot={review.snapshot} canEdit={canEdit} canApprove={canApprove}
      disabled={pending || frozen || needsRefresh} mutate={mutate} channelConnections={props.channelConnections} campaigns={props.campaigns} brandProfiles={props.brandProfiles} />}
    {!canEdit && !canApprove && <p>Read-only access. Owners, admins, and approvers can approve facts; owners, admins, and editors can edit asset reviews.</p>}
    {canApprove && !frozen && <section className={styles.notice}><h2>Approve this exact review</h2><p>This attests to the captured content and usable fact set. It does not approve drafts, grant extra media permissions, activate a campaign, or send content.</p>
      <SourcePreparationApprovalWarning enabledWhenLoaded={props.sourcePreparationEnabled} reapproval={review.currentApprovalValid} />
      <label className="check-row"><input type="checkbox" checked={confirmed} disabled={pending || needsRefresh || review.blockers.length > 0} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed the captured facts, exclusions, assets, permissions, and blockers shown above.</label>
      <div className="form-actions"><button className="button-primary" disabled={pending || needsRefresh || !confirmed || review.blockers.length > 0} onClick={() => void approve(false)}>{review.currentApprovalValid ? "Record another explicit approval" : "Approve exact package review"}</button></div></section>}
    {approval && <p role="status"><Link href={packageApprovalResultPath(props.packageId, approval.id, props.workspaceId)}>Open approval receipt and preparation status</Link></p>}
    {storageError && <p className="form-error" role="alert">{storageError}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}{needsRefresh && <p role="status">Load the current review before a new mutation. Pending approval recovery retains its original precondition.</p>}
    {pending && <p role="status">Checking the exact review request…</p>}
  </div>;
}

export function SourcePreparationApprovalWarning({ enabledWhenLoaded, reapproval }: { enabledWhenLoaded: boolean; reapproval: boolean }) {
  return <div role="note"><p><strong>Approval-linked draft preparation {enabledWhenLoaded ? "was enabled" : "was not enabled"} when this review loaded.</strong> The binding state when approval commits is authoritative. {enabledWhenLoaded ? "If it remains enabled" : "If another writer enables it"} before that commit, recording this exact approval durably queues one separate draft-only preparation with the binding settings captured in that transaction. The immutable receipt shows the authoritative result.</p>
    {reapproval && <p><strong>This is an explicit reapproval.</strong> It creates another approval receipt and, if a binding is enabled when this approval commits, a new preparation command; it is not a harmless refresh of the current receipt.</p>}
    <p>The queued command does not approve or finalize a Campaign or draft, activate a Campaign, create an external publication action, send content, or call a provider. Editing or disabling the source binding later does not cancel a command once queued.</p></div>;
}
