import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus, Settings2 } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

export default async function DestinationsPage() {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const destinations = await getCampaignRepository().listDestinations(workspace.workspaceId);
  return <WorkspaceShell activePath="/destinations" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page"><header className="resource-header"><div><p className="eyebrow">Link intelligence</p><h1>Destinations</h1><p>Maintain canonical external identities separately from campaign tracking and workflow outputs.</p></div><Link className="button-primary resource-button" href="/destinations/new"><Plus size={15} />New destination</Link></header><section className="resource-panel"><div className="resource-panel-head"><div><h2>Registry</h2><p>{destinations.length} destination{destinations.length === 1 ? "" : "s"}</p></div></div>{destinations.length === 0 ? <div className="empty-state"><span><ArrowUpRight size={22} /></span><h3>No destinations yet</h3><p>Add a canonical page, product, event, form, or other campaign handoff.</p></div> : <div className="resource-table">{destinations.map((item) => <article className="resource-row" key={item.id}><span className="resource-icon"><ArrowUpRight size={18} /></span><div className="resource-primary"><strong>{item.title}</strong><p>{item.canonicalUrl}</p></div><div><span className="resource-label">Type</span><strong>{item.contentType}</strong></div><span className={`status-pill ${item.status === "published" ? "status-green" : "status-neutral"}`}>{item.status}</span><Link className="icon-link" href={`/destinations/${item.id}/edit`} aria-label={`Edit ${item.title}`}><Settings2 size={16} /></Link></article>)}</div>}</section></div></WorkspaceShell>;
}
