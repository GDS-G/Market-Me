import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { presetDetailPath } from "@/components/preparation-preset-contract";
import { getPreparationPresetRepository } from "@/server/database";
import { presetPageNumber,presetPageScope } from "@/server/preparation-preset-pages";
import styles from "@/components/preparation-preset.module.css";

export default async function PresetsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const query=await searchParams;if(Object.keys(query).some(key=>!["workspaceId","page"].includes(key)))notFound();
  const {user,workspace,canWrite}=await presetPageScope(query.workspaceId),page=presetPageNumber(query.page,2000)??1;
  const result=await getPreparationPresetRepository().list(workspace.workspaceId,user.id,page);
  const base=`/campaigns/presets?workspaceId=${encodeURIComponent(workspace.workspaceId)}`;
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page">
    <Link className="back-link" href="/campaigns">← Campaigns</Link>
    <header className="resource-header"><div><p className="eyebrow">Shared workspace library</p><h1>Preparation presets</h1><p>Save reusable draft-preparation settings, preserve every version, and explicitly copy them into new work for review.</p></div>
      {canWrite&&<Link className="button-primary resource-button" href={`/campaigns/presets/new?workspaceId=${encodeURIComponent(workspace.workspaceId)}`}>New preset</Link>}</header>
    <p>Presets are values, not executable workflows. They do not contain package approvals, connected publishing accounts, schedules or activation authority. Changes never update earlier prepared work.</p>
    {!canWrite&&<p>All current workspace members can read this library. Saving, cloning, archiving and copying settings require owner, administrator or editor access.</p>}
    {result.items.length?<div className={styles.cards}>{result.items.map(item=><article className={styles.card} key={item.id}>
      <span className="status-pill status-neutral">{item.archived?"Archived":"Available"} · v{item.latestVersionNumber}</span><h2>{item.title}</h2><p>{item.notes||"No library notes"}</p>
      <p>Library revision {item.revision} · updated {item.updatedAt}</p><Link href={presetDetailPath(item.workspaceId,item.id)}>Review settings and history →</Link>
    </article>)}</div>:<section className="resource-panel"><h2>{page===1?"No preparation presets yet":"No presets on this page"}</h2><p>Create a reusable set of copy controls and profile selections. Saving a preset does not create a Campaign.</p></section>}
    <nav className={styles.actions} aria-label="Preset pages">{page>1&&<Link href={`${base}&page=${page-1}`}>Previous page</Link>}<span>Page {page} · up to 50 presets</span>{result.more&&page<2000&&<Link href={`${base}&page=${page+1}`}>Next page</Link>}</nav>
    <p className="form-help">Lists reflect saved library state when loaded. Refresh after edits; changing state can move records between pages. {page===2000&&result.more?"The bounded list limit is reached; use a known preset link to inspect additional records.":""}</p>
  </div></WorkspaceShell>;
}
