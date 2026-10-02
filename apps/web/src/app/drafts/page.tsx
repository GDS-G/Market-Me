import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, FilePenLine, Search } from "lucide-react";
import { DRAFT_CATALOG_LIMITS } from "@market-me/database";
import { DRAFT_STATUSES } from "@market-me/domain";
import { canPrepareCampaign } from "@/components/campaign-preparation-request";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getDraftCatalogRepository } from "@/server/database";
import { formatDashboardTime } from "@/server/dashboard-data";
import { catalogCount } from "@/server/content-catalog-view";
import { DRAFT_CATALOG_STATUS_LABELS, draftCatalogPath, draftCatalogSelection, type DraftCatalogSelection } from "@/server/draft-catalog-view";
import styles from "./catalog.module.css";

export default async function DraftsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  let selection: DraftCatalogSelection;
  try { selection = draftCatalogSelection(await searchParams, workspace.workspaceId); } catch { notFound(); }
  const data = await getDraftCatalogRepository().getPage(workspace.workspaceId, user.id, selection);
  if (!data || data.workspaceId !== workspace.workspaceId || data.filters.query !== selection.query || data.filters.status !== (selection.status ?? null)) notFound();
  const canWrite = canPrepareCampaign(workspace.role), firstPage = draftCatalogPath(workspace.workspaceId, { query: selection.query, status: selection.status });
  return <WorkspaceShell activePath="/drafts" workspaceName={workspace.workspaceName} userName={user.displayName}><div className={"resource-page " + styles.page}>
    <header className="resource-header"><div><p className="eyebrow">Find copy to review</p><h1>Drafts</h1><p>Search current draft copy and Campaign, package or Audience labels in {workspace.workspaceName}.</p></div>{canWrite && <Link prefetch={false} className="button-primary resource-button" href="/drafts/generate">Generate drafts</Link>}</header>
    <section className={styles.panel} aria-labelledby="draft-search-heading"><h2 id="draft-search-heading">Search and filter</h2>
      <form key={JSON.stringify([workspace.workspaceId, selection.query, selection.status ?? null])} method="get" action="/drafts" className={styles.filters} aria-label="Search drafts">
        <input type="hidden" name="workspaceId" value={workspace.workspaceId} />
        <label className={styles.control}><span>Current copy or label</span><input type="search" name="q" defaultValue={selection.query} maxLength={DRAFT_CATALOG_LIMITS.queryLength} placeholder="For example, café or a Campaign name" autoComplete="off" /></label>
        <label className={styles.control}><span>Recorded draft status</span><select name="status" defaultValue={selection.status ?? "all"}><option value="all">All recorded statuses</option>{DRAFT_STATUSES.map(status => <option key={status} value={status}>{DRAFT_CATALOG_STATUS_LABELS[status]}</option>)}</select></label>
        <button type="submit" className="button-primary resource-button"><Search size={16} aria-hidden="true" />Search drafts</button>
      </form>
      <p className={styles.note}>Literal text search, ignoring letter case. Searches current headline/body and Campaign, package or Audience labels, not historical versions, evidence or calls to action. Recorded status does not prove current approval, channel readiness or delivery.</p>
      {(selection.query || selection.status || selection.cursor) && <Link prefetch={false} href={draftCatalogPath(workspace.workspaceId)}>Clear search and filters</Link>}
    </section>
    <section aria-labelledby="draft-results-heading"><div className={styles.resultsHeading}><div><h2 id="draft-results-heading">Matching variants</h2><p>Showing {data.items.length} of {catalogCount(data.totalMatches)} matching draft{data.totalMatches === "1" ? "" : "s"}. {catalogCount(data.totalDrafts)} in this workspace catalog.</p></div><a href={firstPage}>Refresh from newest</a></div>
      <p className={styles.note}>Each audience variant is a separate draft. Newest updated first, up to {DRAFT_CATALOG_LIMITS.pageSize} per page. Snapshot: <time dateTime={data.observedAt}>{formatDashboardTime(data.observedAt, "UTC", "millisecond")}</time>. New changes can move results between pages.</p>
      {data.items.length === 0 ? <div className={styles.empty}><FilePenLine size={24} aria-hidden="true" /><h3>{data.totalDrafts === "0" ? "No drafts available" : data.totalMatches === "0" ? "No matching drafts" : "No more drafts at this position"}</h3><p>{data.totalDrafts === "0" ? "Prepare an approved Content Package to create reviewable copy and its evidence trace." : data.totalMatches === "0" ? "Try different copy, a Campaign, package or Audience label, or another recorded status." : "The catalog may have changed. Return to the newest results to refresh this selection."}</p>{data.totalDrafts === "0" ? canWrite ? <Link prefetch={false} className="button-primary resource-button" href="/campaigns/prepare">Prepare campaign</Link> : <Link prefetch={false} href="/content-packages">Inspect Content Packages</Link> : <Link prefetch={false} href={selection.cursor ? firstPage : draftCatalogPath(workspace.workspaceId)}>{selection.cursor ? "Return to newest results" : "Show all drafts"}</Link>}</div>
        : <div className={styles.results}>{data.items.map(item => <article className={styles.panel} key={item.id}>
          <div className={styles.itemHeading}><FilePenLine size={18} aria-hidden="true" /><h3><Link prefetch={false} href={"/drafts/" + item.id}>{item.headline || "Untitled draft"}</Link></h3></div>
          <span className={styles.status}>{DRAFT_CATALOG_STATUS_LABELS[item.status]}</span>
          <p className={styles.copy}>{item.bodyPreview || "No body copy recorded."}</p>
          {item.bodyTruncated && <p className={styles.note}>Shortened preview: first {DRAFT_CATALOG_LIMITS.bodyCharacters} characters of {catalogCount(item.bodyCharacters)}. Open the draft for complete copy.</p>}
          <dl className={styles.facts}><div><dt>Campaign</dt><dd>{item.campaignName}</dd></div><div><dt>Content Package</dt><dd>{item.packageTitle}</dd></div><div><dt>Audience</dt><dd>{item.audienceName ?? "General"}</dd></div><div><dt>Current copy version</dt><dd>{item.versionNumber}</dd></div></dl>
          <p className={styles.note}>Updated <time dateTime={item.updatedAt}>{formatDashboardTime(item.updatedAt, "UTC", "millisecond")}</time></p>
          <Link className={styles.openLink} prefetch={false} href={"/drafts/" + item.id} aria-label={"Open " + (item.headline || "untitled draft")}>Review complete draft<ArrowRight size={16} aria-hidden="true" /></Link>
        </article>)}</div>}
      <nav className={styles.paging} aria-label="Draft result pages">{selection.cursor && <Link prefetch={false} href={firstPage}>Newest results</Link>}{data.nextCursor && <Link prefetch={false} href={draftCatalogPath(workspace.workspaceId, { ...selection, cursor: data.nextCursor })}>Next {DRAFT_CATALOG_LIMITS.pageSize} results<ArrowRight size={16} aria-hidden="true" /></Link>}</nav>
    </section>
  </div></WorkspaceShell>;
}
