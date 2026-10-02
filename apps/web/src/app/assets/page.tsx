import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Files, Search } from "lucide-react";
import { ASSET_CATALOG_LIMITS, ASSET_CATALOG_ROLES } from "@market-me/database";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getAssetCatalogRepository } from "@/server/database";
import { formatDashboardTime } from "@/server/dashboard-data";
import { catalogCount } from "@/server/content-catalog-view";
import { ASSET_ROLE_LABELS, ASSET_EXTRACTION_LABELS, ASSET_MEDIA_LABELS, ASSET_SCAN_LABELS, ASSET_RIGHTS_LABELS, assetCatalogBytes, assetCatalogPath, assetCatalogSelection, type AssetCatalogSelection } from "@/server/asset-catalog-view";
import styles from "../content-packages/catalog.module.css";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  let selection: AssetCatalogSelection;
  try { selection = assetCatalogSelection(await searchParams, workspace.workspaceId); } catch { notFound(); }
  const data = await getAssetCatalogRepository().getPage(workspace.workspaceId, user.id, selection);
  if (!data || data.workspaceId !== workspace.workspaceId || data.filters.query !== selection.query || data.filters.role !== (selection.role ?? null)) notFound();
  const firstPage = assetCatalogPath(workspace.workspaceId, { query: selection.query, role: selection.role });
  return <WorkspaceShell activePath="/assets" workspaceName={workspace.workspaceName} userName={user.displayName}><div className={"resource-page " + styles.page}>
    <header className="resource-header"><div><p className="eyebrow">Find stored material</p><h1>Assets</h1><p>Search filenames, MIME types and package titles in {workspace.workspaceName}. Each stored asset is a separate record.</p></div></header>
    <section className={styles.panel} aria-labelledby="asset-search-heading"><h2 id="asset-search-heading">Search and filter</h2>
      <form key={JSON.stringify([workspace.workspaceId, selection.query, selection.role ?? null])} method="get" action="/assets" className={styles.filters} aria-label="Search assets">
        <input type="hidden" name="workspaceId" value={workspace.workspaceId} />
        <label className={styles.control}><span>Filename, MIME type or package</span><input type="search" name="q" defaultValue={selection.query} maxLength={ASSET_CATALOG_LIMITS.queryLength} placeholder="For example, café or image/png" autoComplete="off" /></label>
        <label className={styles.control}><span>Recorded asset role</span><select name="role" defaultValue={selection.role ?? "all"}><option value="all">All recorded roles</option>{ASSET_CATALOG_ROLES.map(role => <option key={role} value={role}>{ASSET_ROLE_LABELS[role]}</option>)}</select></label>
        <button type="submit" className="button-primary resource-button"><Search size={16} aria-hidden="true" />Search assets</button>
      </form>
      <p className={styles.note}>Literal text search, ignoring letter case. File bodies, source paths and private rights notes are not searched. Recorded scan and rights states do not prove current safety, usage permission or publishing readiness. This page does not fetch previews or download files.</p>
      {(selection.query || selection.role || selection.cursor) && <Link prefetch={false} href={assetCatalogPath(workspace.workspaceId)}>Clear search and filters</Link>}
    </section>
    <section aria-labelledby="asset-results-heading"><div className={styles.resultsHeading}><div><h2 id="asset-results-heading">Matching assets</h2><p>Showing {data.items.length} of {catalogCount(data.totalMatches)} matching asset{data.totalMatches === "1" ? "" : "s"}. {catalogCount(data.totalAssets)} in this workspace inventory.</p></div><a href={firstPage}>Refresh from newest</a></div>
      <p className={styles.note}>Newest added first, up to {ASSET_CATALOG_LIMITS.pageSize} per page. Snapshot: <time dateTime={data.observedAt}>{formatDashboardTime(data.observedAt, "UTC", "millisecond")}</time>. Later reads may change; this is not a frozen inventory or a list of unique source files.</p>
      {data.items.length === 0 ? <div className={styles.empty}><Files size={24} aria-hidden="true" /><h3>{data.totalAssets === "0" ? "No assets available" : data.totalMatches === "0" ? "No matching assets" : "No more assets at this position"}</h3><p>{data.totalAssets === "0" ? "Inspect Content Packages for their current intake and review state. Searching does not synchronize files." : data.totalMatches === "0" ? "Try another filename, MIME type, package title or recorded role." : "The inventory may have changed since the previous page. Return to the newest results."}</p>{data.totalAssets === "0" ? <Link prefetch={false} href="/content-packages">Inspect Content Packages</Link> : <Link prefetch={false} href={selection.cursor ? firstPage : assetCatalogPath(workspace.workspaceId)}>{selection.cursor ? "Return to newest results" : "Show all assets"}</Link>}</div>
        : <div className={styles.results}>{data.items.map(item => <article className={styles.panel} key={item.id}>
          <div className={styles.itemHeading}><Files size={18} aria-hidden="true" /><h3>{item.fileName || "Unnamed file record"}</h3></div><span className={styles.status}>{ASSET_ROLE_LABELS[item.role]}</span>
          <dl className={styles.facts}><div><dt>Content Package</dt><dd>{item.packageTitle || "Untitled package"}</dd></div><div><dt>MIME type</dt><dd>{item.mimeType || "Unavailable"}</dd></div><div><dt>Recorded size</dt><dd>{assetCatalogBytes(item.byteSize)}</dd></div>
            <div><dt>Recorded extraction</dt><dd>{ASSET_EXTRACTION_LABELS[item.extractionStatus]}</dd></div><div><dt>Recorded media processing</dt><dd>{ASSET_MEDIA_LABELS[item.mediaStatus]}</dd></div><div><dt>Recorded malware scan</dt><dd>{ASSET_SCAN_LABELS[item.scanStatus]}</dd></div><div><dt>Recorded rights</dt><dd>{ASSET_RIGHTS_LABELS[item.rightsStatus]}</dd></div></dl>
          <p className={styles.note}>Added <time dateTime={item.createdAt}>{formatDashboardTime(item.createdAt, "UTC", "millisecond")}</time></p>
          <Link className={styles.openLink} prefetch={false} href={"/content-packages/" + item.packageId} aria-label={"Review package for " + (item.fileName || "unnamed file record")}>Review containing package<ArrowRight size={16} aria-hidden="true" /></Link>
        </article>)}</div>}
      <nav className={styles.paging} aria-label="Asset result pages">{selection.cursor && <Link prefetch={false} href={firstPage}>Newest results</Link>}{data.nextCursor && <Link prefetch={false} href={assetCatalogPath(workspace.workspaceId, { ...selection, cursor: data.nextCursor })}>Next {ASSET_CATALOG_LIMITS.pageSize} results<ArrowRight size={16} aria-hidden="true" /></Link>}</nav>
    </section>
  </div></WorkspaceShell>;
}
