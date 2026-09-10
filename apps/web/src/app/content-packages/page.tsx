import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, FileStack } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository } from "@/server/database";

export default async function ContentPackagesPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const packages = await repository.listContentPackages(workspace.workspaceId);
  return <WorkspaceShell activePath="/content-packages" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page">
    <header className="resource-header"><div><p className="eyebrow">Evidence-backed material</p><h1>Content Packages</h1><p>Review extracted assets, authoritative context, conflicts, and unresolved facts before campaign use.</p></div></header>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Packages</h2><p>{packages.length} normalized package{packages.length === 1 ? "" : "s"}</p></div></div>
      {packages.length === 0 ? <div className="empty-state"><span><FileStack size={22} /></span><h3>No Content Packages yet</h3><p>Synchronize an enabled Smart Source. Stable file events become evidence-backed packages in the worker.</p></div> : <div className="resource-table">{packages.map((item) => <article className="resource-row" key={item.id}>
        <span className="resource-icon"><FileStack size={18} /></span><div className="resource-primary"><strong>{item.title}</strong><p>{item.assets.map((asset) => asset.fileName).join(", ")}</p></div>
        <div><span className="resource-label">Evidence</span><strong>{item.evidence.length}</strong></div><div><span className="resource-label">Confidence</span><strong>{item.confidence === undefined ? "—" : `${Math.round(item.confidence * 100)}%`}</strong></div>
        <span className={`status-pill ${item.status === "ready" || item.status === "approved" ? "status-green" : item.status === "needs_review" ? "status-amber" : "status-neutral"}`}>{item.status.replaceAll("_", " ")}</span>
        <Link className="icon-link" href={`/content-packages/${item.id}`} aria-label={`Open ${item.title}`}><ArrowUpRight size={16} /></Link>
      </article>)}</div>}
    </section>
  </div></WorkspaceShell>;
}
