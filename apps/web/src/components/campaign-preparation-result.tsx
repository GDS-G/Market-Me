import Link from "next/link";
import type { StoredCampaignPreparation } from "@market-me/database";
import { PrepareAnotherCampaign } from "./prepare-another-campaign";
import { finalizationFormPath } from "./campaign-finalization-request";
import styles from "./campaign-preparation-form.module.css";

/** Captured Destination values are displayed as text, never interpreted as executable links or settings. */
export function CampaignPreparationResult({ preparation, userId, canWrite, availableDraftIds }: {
  preparation: StoredCampaignPreparation; userId: string; canWrite: boolean; availableDraftIds: readonly string[];
}) {
  const snapshot = preparation.referenceSnapshot;
  const input = preparation.configurationSnapshot;
  const destinationTitle = typeof snapshot.destination?.title === "string" ? snapshot.destination.title : "Captured Destination";
  const destinationUrl = typeof snapshot.destination?.canonicalUrl === "string" ? snapshot.destination.canonicalUrl : undefined;
  return <div className={styles.receipt}>
    <section className={styles.notice} aria-labelledby="preparation-result-heading">
      <h2 id="preparation-result-heading">Prepared—not activated</h2>
      <p>The planning campaign and all initial draft variants were saved together. Preparation created no workflow run, execution command, publication action, or approval decision.</p>
      <p>Review and approve copy through the existing draft workflow. Turning an exact approved preview into an executable plan remains a separate step; this page does not activate or send anything.</p>
    </section>
    <section className="form-section"><div><h2>Captured preparation</h2><p>These labels and pins come from the immutable receipt, not current profile or package pointers.</p></div>
      <dl>
        <dt>Template</dt><dd>General Announcement · v{preparation.templateVersion}</dd>
        <dt>Package</dt><dd>{snapshot.contentPackage.title} · v{preparation.contentPackageVersion}<small><Link href={`/content-packages/${preparation.contentPackageId}`}>Review current package separately</Link></small></dd>
        <dt>Brand</dt><dd>{snapshot.brand ? `${snapshot.brand.name} · v${snapshot.brand.versionNumber}` : "No Brand Profile"}</dd>
        <dt>Audiences</dt><dd>{snapshot.audiences.length ? snapshot.audiences.map((audience) => `${audience.name} · v${audience.versionNumber}`).join("; ") : "General audience"}</dd>
        <dt>Destination</dt><dd>{snapshot.destination ? <>{destinationTitle}{destinationUrl && <small>{destinationUrl}</small>}<small>Unversioned historical context; not future availability or publishing authority.</small></> : "No Destination"}</dd>
        <dt>Copy controls</dt><dd>{input.informationDepth.replaceAll("_", " ")} information depth · {input.promotionalStrength.replaceAll("_", " ")} promotion</dd>
        <dt>Timezone</dt><dd>{input.timezone} · no run scheduled</dd>
        <dt>Prepared at</dt><dd><time dateTime={preparation.createdAt}>{preparation.createdAt}</time></dd>
      </dl>
    </section>
    <section className="form-section"><div><h2>Review every draft variant</h2><p>Review links open the live draft. Its current revision may be newer than the initial version recorded here.</p></div>
      <ol>{preparation.preparedDrafts.map((draft, index) => <li key={draft.draftId}>
        {availableDraftIds.includes(draft.draftId) ? <Link href={`/drafts/${draft.draftId}`}>Review {snapshot.audiences[index]?.name ?? "General audience"} draft</Link> : <span>Historical draft is no longer accessible</span>}
        <small>Initial immutable draft version: {draft.versionId}</small>
        {snapshot.audiences[index] && <small>Captured Audience Profile: {snapshot.audiences[index].name} · v{snapshot.audiences[index].versionNumber} · {snapshot.audiences[index].id}</small>}
      </li>)}</ol>
    </section>
    <details><summary>Exact lineage and audit identifiers</summary><dl>
      <dt>Preparation</dt><dd>{preparation.id}</dd><dt>Campaign</dt><dd>{preparation.campaignId}</dd>
      <dt>Planning version</dt><dd>{preparation.planningVersionId}</dd><dt>Generation</dt><dd>{preparation.generationId}</dd>
      <dt>Package</dt><dd>{preparation.contentPackageId} · v{preparation.contentPackageVersion}</dd>
      {snapshot.brand && <><dt>Brand version</dt><dd>{snapshot.brand.id}</dd></>}
      {typeof snapshot.destination?.id === "string" && <><dt>Captured Destination</dt><dd>{snapshot.destination.id}</dd></>}
      <dt>Configuration SHA-256</dt><dd>{preparation.configurationHash}</dd>
      <dt>Prepared by</dt><dd>{preparation.createdBy}</dd>
    </dl></details>
    <div className={styles.actions}><Link href="/drafts">All drafts</Link><Link href="/campaigns">Campaigns</Link>
      {canWrite && <><Link className="button-primary" href={finalizationFormPath(preparation.id, preparation.workspaceId)}>Review or finalize an exact preview</Link><Link href={`/campaigns/${preparation.campaignId}/edit`}>Campaign plan and controls</Link><PrepareAnotherCampaign userId={userId} workspaceId={preparation.workspaceId} completedAttemptKey={preparation.idempotencyKey} /></>}
    </div>
  </div>;
}
