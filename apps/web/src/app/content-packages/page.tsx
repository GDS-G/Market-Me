import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, FileStack, Search } from "lucide-react";
import { CONTENT_CATALOG_LIMITS } from "@market-me/database";
import { PACKAGE_STATUSES } from "@market-me/domain";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getContentCatalogRepository } from "@/server/database";
import { formatDashboardTime } from "@/server/dashboard-data";
import { CONTENT_CATALOG_STATUS_LABELS, catalogCount, contentCatalogPath, contentCatalogSelection, hiddenCatalogFiles, type ContentCatalogSelection } from "@/server/content-catalog-view";
import styles from "./catalog.module.css";

export default async function ContentPackagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  let selection: ContentCatalogSelection;
  try { selection = contentCatalogSelection(await searchParams, workspace.workspaceId); } catch { notFound(); }
  const data = await getContentCatalogRepository().getPage(workspace.workspaceId, user.id, selection);
  if (!data || data.workspaceId !== workspace.workspaceId || data.filters.query !== selection.query || data.filters.status !== (selection.status ?? null)) notFound();
  const firstPage = contentCatalogPath(workspace.workspaceId, { query: selection.query, status: selection.status });
  return <WorkspaceShell activePath="/content-packages" workspaceName={workspace.workspaceName} userName={user.displayName}><div className={"resource-page " + styles.page}>
    <header className="resource-header"><div><p className="eyebrow">Find material to review</p><h1>Content Packages</h1><p>Search package titles and attached filenames in {workspace.workspaceName}, then open the exact package to review its evidence.</p></div></header>
    <section className={styles.panel} aria-labelledby="catalog-search-heading"><h2 id="catalog-search-heading">Search and filter</h2>
      <form method="get" action="/content-packages" className={styles.filters} aria-label="Search Content Packages">
        <input type="hidden" name="workspaceId" value={workspace.workspaceId} />
        <label className={styles.control}><span>Title or filename</span><input type="search" name="q" defaultValue={selection.query} maxLength={CONTENT_CATALOG_LIMITS.queryLength} placeholder="For example, café or brochure.pdf" autoComplete="off" /></label>
        <label className={styles.control}><span>Recorded status</span><select name="status" defaultValue={selection.status ?? "all"}><option value="all">All recorded statuses</option>{PACKAGE_STATUSES.map(status => <option key={status} value={status}>{CONTENT_CATALOG_STATUS_LABELS[status]}</option>)}</select></label>
        <button type="submit" className="button-primary resource-button"><Search size={16} aria-hidden="true" />Search packages</button>
      </form>
      <p className={styles.note}>Literal text search, ignoring letter case. Document bodies and evidence claims are not searched. Recorded status and confidence do not prove current approval or launch eligibility.</p>
      {(selection.query || selection.status || selection.cursor) && <Link prefetch={false} href={contentCatalogPath(workspace.workspaceId)}>Clear search and filters</Link>}
    </section>

    <section aria-labelledby="catalog-results-heading"><div className={styles.resultsHeading}><div><h2 id="catalog-results-heading">Matching packages</h2><p>Showing {data.items.length} of {catalogCount(data.totalMatches)} matching package{data.totalMatches === "1" ? "" : "s"}. {catalogCount(data.totalPackages)} in this workspace catalog.</p></div><a href={firstPage}>Refresh from newest</a></div>
      <p className={styles.note}>Newest updated first, up to {CONTENT_CATALOG_LIMITS.pageSize} per page. Snapshot: <time dateTime={data.observedAt}>{formatDashboardTime(data.observedAt, "UTC", "millisecond")}</time>. New changes can move results between pages.</p>
      {data.items.length === 0 ? <div className={styles.empty}><FileStack size={24} aria-hidden="true" /><h3>{data.totalPackages === "0" ? "No Content Packages yet" : data.totalMatches === "0" ? "No matching packages" : "No more packages at this position"}</h3><p>{data.totalPackages === "0" ? "Open Smart Sources to inspect the content intake setup. Searching does not synchronize or activate a source." : data.totalMatches === "0" ? "Try a different title or filename, or choose another recorded status." : "The catalog may have changed since the previous page. Return to the newest results to refresh this selection."}</p>{data.totalPackages === "0" ? <Link prefetch={false} href="/smart-sources">Inspect Smart Sources</Link> : <Link prefetch={false} href={selection.cursor ? firstPage : contentCatalogPath(workspace.workspaceId)}>{selection.cursor ? "Return to newest results" : "Show all packages"}</Link>}</div>
        : <div className={styles.results}>{data.items.map(item => {
          const hiddenFiles = hiddenCatalogFiles(item.assetCount, item.fileNames.length);
          return <article className={styles.panel} key={item.id}><div className={styles.itemHeading}><FileStack size={18} aria-hidden="true" /><h3><Link prefetch={false} href={"/content-packages/" + item.id}>{item.title}</Link></h3></div>
            <span className={styles.status}>{CONTENT_CATALOG_STATUS_LABELS[item.status]}</span>
            {item.fileNames.length ? <ul className={styles.files} aria-label="Filename preview">{item.fileNames.map((name, index) => <li key={index + ":" + name}>{name || "Unnamed file record"}</li>)}</ul> : <p className={styles.note}>No attached filenames available.</p>}
            {hiddenFiles !== "0" && <p className={styles.note}>Plus {catalogCount(hiddenFiles)} more file record{hiddenFiles === "1" ? "" : "s"}; open the package for details.</p>}
            <dl className={styles.facts}><div><dt>File records</dt><dd>{catalogCount(item.assetCount)}</dd></div><div><dt>Evidence records</dt><dd>{catalogCount(item.evidenceCount)}</dd></div><div><dt>Recorded confidence</dt><dd><strong>{item.confidence == null ? "Unavailable" : Math.round(item.confidence * 100) + "%"}</strong></dd></div></dl>
            <p className={styles.note}>Updated <time dateTime={item.updatedAt}>{formatDashboardTime(item.updatedAt, "UTC", "millisecond")}</time></p>
            <Link className={styles.openLink} prefetch={false} href={"/content-packages/" + item.id} aria-label={"Open " + item.title}>Review package<ArrowRight size={16} aria-hidden="true" /></Link>
          </article>;
        })}</div>}
      <nav className={styles.paging} aria-label="Package result pages">{selection.cursor && <Link prefetch={false} href={firstPage}>Newest results</Link>}{data.nextCursor && <Link prefetch={false} href={contentCatalogPath(workspace.workspaceId, { ...selection, cursor: data.nextCursor })}>Next {CONTENT_CATALOG_LIMITS.pageSize} results<ArrowRight size={16} aria-hidden="true" /></Link>}</nav>
    </section>
  </div></WorkspaceShell>;
}
