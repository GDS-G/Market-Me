import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { PACKAGE_WORK_MAX_PAGE, packageWorkUuid } from "@market-me/database";
import { WorkspaceShell } from "@/components/workspace-shell";
import { preparationResultPath } from "@/components/campaign-preparation-request";
import { finalizationResultPath } from "@/components/campaign-finalization-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getPackageWorkRepository } from "@/server/database";
import { formatDashboardTime } from "@/server/dashboard-data";
import { PACKAGE_WORK_DRAFT_LABELS, PACKAGE_WORK_RUN_LABELS, packageWorkPath, packageWorkQuery } from "@/server/package-work-view";
import styles from "./work.module.css";

export default async function PackageWorkPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const [route, query] = await Promise.all([params, searchParams]);
  let id: string, page: number;
  try { id = packageWorkUuid(route.id); page = packageWorkQuery(query); } catch { notFound(); }
  const snapshot = await getPackageWorkRepository().getSnapshot(workspace.workspaceId, id, user.id, page);
  if (!snapshot || snapshot.workspaceId !== workspace.workspaceId || snapshot.packageId !== id || snapshot.page !== page) notFound();
  const self = packageWorkPath(id, page);
  return <WorkspaceShell activePath="/content-packages" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className={`resource-page ${styles.page}`}>
      <Link className="back-link" prefetch={false} href={`/content-packages/${id}`}><ArrowLeft size={14} aria-hidden="true" />Review current package</Link>
      <header className="resource-header"><div><p className="eyebrow">One package, its recorded work</p><h1>Related work</h1><p>{snapshot.title} · current package revision {snapshot.packageVersion}</p></div>
        <a className="button-secondary resource-button" href={self}><RefreshCw size={16} aria-hidden="true" />Refresh saved state</a></header>
      <aside className={styles.notice} aria-label="Scope and saved-state limits">
        <p>Follow this package&apos;s saved preparations, drafts and exact-version runs. Opening these links does not approve, activate, retry or send work.</p>
        <p>Current role: {snapshot.role}. Observed <time dateTime={snapshot.observedAt}>{formatDashboardTime(snapshot.observedAt, "UTC", "millisecond")}</time>. Refresh after changes.</p>
        <details><summary>What is included and what statuses mean</summary>
          <p>This page follows completed General Announcement preparation receipts for this package. Other manual Campaigns, independent drafts and pending source-preparation commands are not included. Inspect approval-linked commands on the original package approval receipt.</p>
          <p>Captured revisions and today&apos;s draft state are different facts. Status labels do not prove current approval, valid previews, launch eligibility or external delivery.</p>
        </details>
      </aside>
      {snapshot.preparations.length === 0 ? <section className={styles.empty}><h2>{page === 1 ? "No completed preparations recorded" : "No preparations on this page"}</h2>
        <p>{page === 1 ? "This does not mean that the package is ready or that no other work exists. Review the current package and its original approval history before preparing anything new." : "New records can change page boundaries. Return to the first page to inspect the latest saved work."}</p>
        {page > 1 && <Link prefetch={false} href={packageWorkPath(id)}>View latest preparations</Link>}
      </section> : <section aria-labelledby="preparations-heading"><h2 id="preparations-heading">Recorded preparations</h2>
        <ol className={styles.cards} role="list">{snapshot.preparations.map(preparation => <li className={styles.card} role="listitem" key={preparation.id}>
          <div className={styles.cardHeader}><div><h3>{preparation.campaignName || "Prepared campaign"}</h3><p>Captured package revision {preparation.packageVersion} · prepared <time dateTime={preparation.createdAt}>{formatDashboardTime(preparation.createdAt, "UTC")}</time></p></div>
            <Link prefetch={false} href={preparationResultPath(preparation.id, snapshot.workspaceId)}>Original preparation receipt</Link></div>
          {preparation.packageVersion !== snapshot.packageVersion && <p className={styles.warning}>The package is now on a different revision. This historical preparation does not approve the current package or establish new launch eligibility.</p>}
          <h4>Draft variants</h4><p>Each link opens the live draft. Current copy may differ from the initial version saved by preparation.</p>
          <ul className={styles.drafts} role="list">{preparation.drafts.map((draft, index) => <li role="listitem" key={draft.draftId}>
            <div><strong>{draft.audienceLabel || `Variant ${index + 1}`}</strong>{draft.current ? <><span className={styles.state}>{PACKAGE_WORK_DRAFT_LABELS[draft.current.status]} · revision {draft.current.versionNumber}</span>
              <Link prefetch={false} href={`/drafts/${draft.draftId}`}>Inspect draft {index + 1}</Link></> : <span className={styles.warning}>Current draft unavailable. No replacement draft is inferred.</span>}</div>
            <small>{draft.current && draft.current.versionId !== draft.initialVersionId ? "The current version differs from the initial prepared copy." : "Initial version identity is retained in the original preparation receipt."}</small>
          </li>)}</ul>
          <section className={styles.finalization} aria-label={`Finalization and runs for ${preparation.campaignName}`}><h4>Final plan and runs</h4>
            {preparation.finalization ? <><p>A finalization receipt records one selected draft version, not all variants. Finalization itself did not publish or activate the plan.</p>
              <Link prefetch={false} href={finalizationResultPath(preparation.finalization.id, snapshot.workspaceId)}>Inspect exact finalization and current controls</Link>
              {preparation.finalization.runs.length ? <><h5>Recent runs of this exact finalized version</h5><ul className={styles.runs}>{preparation.finalization.runs.map((run, index) => <li key={run.id}>
                <Link prefetch={false} href={`/campaign-instances/${run.id}`}>Inspect run {index + 1}</Link><span>{PACKAGE_WORK_RUN_LABELS[run.status]}</span><time dateTime={run.createdAt}>{formatDashboardTime(run.createdAt, "UTC")}</time>
              </li>)}</ul><p>Inspect each run&apos;s action results. A completed state is not a delivery or engagement receipt.</p>
                {preparation.finalization.hasMoreRuns && <p>Only the five most recent runs are shown. The exact finalization receipt links to additional matching runs.</p>}</>
                : <p>No runs of this exact finalized version are recorded. This is not a launch-readiness check.</p>}</>
              : <p>No finalization receipt is recorded for this preparation. Open its original receipt to inspect draft review and supported finalization prerequisites; no automatic next action is taken.</p>}
          </section>
        </li>)}</ol>
      </section>}
      <nav className={styles.pagination} aria-label="Preparation pages">{page > 1 && <Link prefetch={false} href={packageWorkPath(id, page - 1)}>Previous page</Link>}<span>Page {page}</span>
        {snapshot.hasMore && page < PACKAGE_WORK_MAX_PAGE && <Link prefetch={false} href={packageWorkPath(id, page + 1)}>Next page</Link>}</nav>
      {snapshot.hasMore && page === PACKAGE_WORK_MAX_PAGE && <p>The supported history page limit has been reached. No later page is implied to be empty.</p>}
      <p className={styles.footer}>Ten preparations per page, newest first. Saved-state paging can shift when records are added; it is not a stable history export. <Link prefetch={false} href="/getting-started">View the overall workflow guide</Link>.</p>
    </div>
  </WorkspaceShell>;
}
