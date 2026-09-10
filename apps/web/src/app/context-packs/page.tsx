import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenCheck, Plus, Settings2 } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository } from "@/server/database";

export default async function ContextPacksPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const packs = await repository.listContextPacks(workspace.workspaceId);
  return <WorkspaceShell activePath="/context-packs" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page">
      <header className="resource-header"><div><p className="eyebrow">Grounded knowledge</p><h1>Context Packs</h1><p>Version approved sources, structured facts, instructions, and conflict authority.</p></div><Link className="button-primary resource-button" href="/context-packs/new"><Plus size={15} />New Context Pack</Link></header>
      <section className="resource-panel">
        <div className="resource-panel-head"><div><h2>Knowledge sets</h2><p>{packs.length} Context Pack{packs.length === 1 ? "" : "s"} in this workspace</p></div></div>
        {packs.length === 0 ? <div className="empty-state"><span><BookOpenCheck size={22} /></span><h3>No Context Packs yet</h3><p>Create a versioned source set before generating evidence-backed content.</p><Link className="button-primary resource-button" href="/context-packs/new">Create the first pack</Link></div> : <div className="resource-table">{packs.map((pack) => <article className="resource-row" key={pack.id}>
          <span className="resource-icon"><BookOpenCheck size={18} /></span>
          <div className="resource-primary"><strong>{pack.name}</strong><p>{pack.description || "No description"}</p></div>
          <div><span className="resource-label">Published</span><strong>{pack.currentVersion ? `v${pack.currentVersion.versionNumber}` : "Not yet"}</strong></div>
          <div><span className="resource-label">Draft</span><strong>{pack.draftVersion ? `v${pack.draftVersion.versionNumber}` : "None"}</strong></div>
          <span className={`status-pill ${pack.status === "published" ? "status-green" : "status-neutral"}`}>{pack.status}</span>
          <Link className="icon-link" href={`/context-packs/${pack.id}/edit`} aria-label={`Edit ${pack.name}`}><Settings2 size={16} /></Link>
        </article>)}</div>}
      </section>
    </div>
  </WorkspaceShell>;
}
