import Link from "next/link";
import type { StoredCampaign, StoredCampaignFinalization, StoredCampaignInstance } from "@market-me/database";
import { ExactPreviewDisplay } from "./exact-preview-display";
import { CampaignFinalizationActions } from "./campaign-finalization-actions";
import { preparationResultPath } from "./campaign-preparation-request";
import styles from "./campaign-preparation-form.module.css";

export function finalizationControlState(receipt: StoredCampaignFinalization, campaign: StoredCampaign | undefined,
  runs: readonly StoredCampaignInstance[]): "draft" | "published" | "has_runs" | "changed" {
  if (!campaign || campaign.id !== receipt.campaignId || campaign.workspaceId !== receipt.workspaceId || campaign.status === "archived") return "changed";
  if (runs.some((run) => run.workspaceId === receipt.workspaceId && run.campaignId === receipt.campaignId && run.campaignVersionId === receipt.finalizedVersionId)) return "has_runs";
  if (campaign.draftVersion?.id === receipt.finalizedVersionId) return "draft";
  if (!campaign.draftVersion && campaign.currentVersion?.id === receipt.finalizedVersionId) return "published";
  return "changed";
}
export function CampaignFinalizationResult({ finalization, campaign, runs, canWrite }: {
  finalization: StoredCampaignFinalization; campaign?: StoredCampaign; runs: readonly StoredCampaignInstance[]; canWrite: boolean;
}) {
  const receipt = finalization;
  const step = receipt.compiledDefinition.steps[0];
  const state = finalizationControlState(receipt, campaign, runs);
  const matchingRuns = runs.filter((run) => run.workspaceId === receipt.workspaceId && run.campaignId === receipt.campaignId && run.campaignVersionId === receipt.finalizedVersionId);
  return <div className={styles.receipt}>
    <section className={styles.notice}><h2>Protected finalization receipt</h2><p>Finalization saved an executable draft version of the same campaign. The finalization operation did not publish, activate, approve, or send anything.</p>
      <p>Advanced edits are blocked for this campaign to preserve its exact preview proof. Changing the preview, account, or Destination later can block activation or new provider dispatch. Prepare a separate campaign for different copy or timing.</p>
      <p>Only this one selected audience variant is included. The other preparation drafts were not scheduled.</p></section>
    <ExactPreviewDisplay snapshot={receipt.canonicalPreviewSnapshot} fingerprint={receipt.previewFingerprint} historical />
    <section className="form-section"><div><h2>Immutable execution plan</h2><p>These settings are captured in the receipt, independently of current campaign status.</p></div>
      <dl><dt>Name</dt><dd>{receipt.compiledDefinition.name}</dd><dt>Publication step</dt><dd>{step?.name ?? "Unavailable historical step"}</dd>
        <dt>Execution / approval</dt><dd>Official API only · publication approval required</dd>
        <dt>Timing</dt><dd>{step?.scheduleType === "preferred_window" ? <>{step.preferredWindowStart} inclusive → {step.preferredWindowEnd} exclusive (UTC). Expiry requires attention; the bound applies to new request starts, not guaranteed provider completion.</>
          : step?.scheduleType === "exact_time" ? <>Not before {step.scheduledAt} (UTC); later execution is possible.</> : "When activated and approved"}</dd>
        <dt>Finalized at</dt><dd>{receipt.createdAt}</dd><dt>Exact executable version</dt><dd>{receipt.finalizedVersionId}</dd></dl>
    </section>
    {matchingRuns.length > 0 && <section className="form-section"><div><h2>Existing runs of this version</h2><p>No additional activation is offered here. Inspect these runs and their approval history.</p></div><ul>{matchingRuns.map((run) => <li key={run.id}><Link href={`/campaign-instances/${run.id}`}>Run {run.id}</Link> · {run.status}</li>)}</ul><Link href="/approvals">Review pending approvals</Link></section>}
    {canWrite && (state === "draft" || state === "published") && <CampaignFinalizationActions key={`${receipt.finalizedVersionId}:${state}`} workspaceId={receipt.workspaceId} campaignId={receipt.campaignId} versionId={receipt.finalizedVersionId} state={state} />}
    {!canWrite && <p>Writer access is required to publish or activate. This historical receipt remains readable.</p>}
    {state === "changed" && <p role="status">The current campaign no longer exposes this exact version for publication or activation. No action is offered against a different version.</p>}
    <details><summary>Exact lineage and audit identifiers</summary><dl><dt>Finalization</dt><dd>{receipt.id}</dd><dt>Campaign</dt><dd>{receipt.campaignId}</dd><dt>Original planning version</dt><dd>{receipt.planningVersionId}</dd><dt>Selected draft</dt><dd>{receipt.contentDraftId}</dd><dt>Selected draft version</dt><dd>{receipt.contentDraftVersionId}</dd><dt>Template</dt><dd>General Announcement finalization · v{receipt.templateVersion}</dd><dt>Configuration SHA-256</dt><dd>{receipt.configurationHash}</dd></dl></details>
    <div className={styles.actions}><Link href={preparationResultPath(receipt.preparationId, receipt.workspaceId)}>Original preparation receipt</Link><Link href={`/drafts/${receipt.contentDraftId}`}>Review current draft separately</Link><Link href="/campaigns">Campaigns and runs</Link></div>
  </div>;
}
