"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DRAFT_FORMATS, type DraftFormat } from "@market-me/domain";
import type { ContentPackageReview } from "@market-me/database";
import { ApprovedPackageReviewPicker } from "./approved-package-review-picker";
import { reviewUuid } from "./content-package-review-request";

export function DraftGenerationForm({ workspaceId, campaigns }: { workspaceId: string; campaigns: readonly { id: string; name: string; packages: readonly { id: string; title: string }[] }[] }) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState("");
  const packages = useMemo(() => campaigns.find((item) => item.id === campaignId)?.packages ?? [], [campaignId, campaigns]);
  const [packageId, setPackageId] = useState("");
  const [review, setReview] = useState<ContentPackageReview>();
  const [draftFormat, setDraftFormat] = useState<DraftFormat>("channel_neutral");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  async function generate() {
    if (inFlight.current || uncertain || !review?.currentApprovalValid || review.snapshot.package.id !== packageId || review.snapshot.package.workspaceId !== workspaceId) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/v1/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, campaignId, contentPackageId: packageId,
        expectedPackageVersion: review.version, expectedReviewFingerprint: review.reviewFingerprint, draftFormat }) });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) { setError(payload?.error?.message ?? "Draft generation was not confirmed. Review current drafts before submitting another request."); setUncertain(true); return; }
      const id = reviewUuid.safeParse(payload?.data?.[0]?.id);
      if (id.success) { setUncertain(true); router.push(`/drafts/${id.data}`); }
      else { setError("Generation may have completed. Reload Drafts to inspect its result before requesting more work."); setUncertain(true); }
    } catch { setError("The response is uncertain. This generation is not retried automatically. Reload Drafts and inspect existing variants before requesting another generation."); setUncertain(true); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <div className="resource-form"><fieldset disabled={pending || uncertain} style={{ border: 0, padding: 0, minWidth: 0 }}>
    <div className="field-grid"><label className="field"><span>Published Campaign</span><select value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPackageId(""); setReview(undefined); }}><option value="">Choose a published Campaign</option>{campaigns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label className="field"><span>Content Package marked approved</span><select value={packageId} onChange={(event) => { setPackageId(event.target.value); setReview(undefined); }}><option value="">Choose a bound package</option>{packages.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      <label className="field"><span>Draft format</span><select value={draftFormat} onChange={(event) => setDraftFormat(event.target.value as DraftFormat)}>{DRAFT_FORMATS.map((format) => <option key={format} value={format}>{format.replaceAll("_", " ")}</option>)}</select></label></div>
  </fieldset>
    <ApprovedPackageReviewPicker key={`${workspaceId}:${campaignId}:${packageId}`} workspaceId={workspaceId} packageId={packageId} disabled={pending || uncertain} onReview={setReview} />
    <div className="form-actions"><button type="button" className="button-primary" disabled={pending || uncertain || !campaignId || !packageId || !review?.currentApprovalValid} onClick={() => void generate()}>{pending ? "Generating…" : "Generate governed drafts from this exact review"}</button>
      {uncertain && <button type="button" className="button-secondary" onClick={() => window.location.reload()}>Reload Drafts to check the result</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{pending && <p role="status">Generating from the exact reviewed package. Nothing is approved or published by this action.</p>}
  </div>;
}
