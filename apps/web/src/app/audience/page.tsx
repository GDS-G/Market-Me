import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, Plus, Settings2, Users } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getProfileRepository } from "@/server/database";

export default async function AudiencePage() {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login"); const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const profiles = getProfileRepository(); const [brands, audiences] = await Promise.all([profiles.listBrandProfiles(workspace.workspaceId), profiles.listAudienceProfiles(workspace.workspaceId)]);
  return <WorkspaceShell activePath="/audience" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page"><header className="resource-header"><div><p className="eyebrow">Communication context</p><h1>Brands &amp; Audiences</h1><p>Publish immutable profile versions, then pin exact versions into campaigns.</p></div><div className="profile-header-actions"><Link className="button-secondary resource-button" href="/audience/brands/new"><Plus size={15} />Brand Profile</Link><Link className="button-primary resource-button" href="/audience/audiences/new"><Plus size={15} />Audience Profile</Link></div></header>
    <ProfileList title="Brand Profiles" empty="No Brand Profiles yet" icon="brand" items={brands.map((item) => ({ ...item, editHref: `/audience/brands/${item.id}/edit`, type: item.currentVersion?.profile.officialName ?? "Identity not published" }))} />
    <ProfileList title="Audience Profiles" empty="No Audience Profiles yet" icon="audience" items={audiences.map((item) => ({ ...item, editHref: `/audience/audiences/${item.id}/edit`, type: item.currentVersion?.audienceType ?? "Audience not published" }))} />
  </div></WorkspaceShell>;
}

function ProfileList({ title, empty, icon, items }: { title: string; empty: string; icon: "brand" | "audience"; items: readonly { id: string; name: string; description: string; status: string; currentVersion?: { versionNumber: number }; draftVersion?: { versionNumber: number }; editHref: string; type: string }[] }) {
  const Icon = icon === "brand" ? BadgeCheck : Users;
  return <section className="resource-panel profile-list"><div className="resource-panel-head"><div><h2>{title}</h2><p>{items.length} profile{items.length === 1 ? "" : "s"}</p></div></div>{items.length === 0 ? <div className="empty-state profile-empty"><span><Icon size={22} /></span><h3>{empty}</h3><p>Profiles become available to campaigns only after a reviewed version is published.</p></div> : <div className="resource-table">{items.map((item) => <article className="resource-row" key={item.id}><span className="resource-icon"><Icon size={18} /></span><div className="resource-primary"><strong>{item.name}</strong><p>{item.description || "No description"}</p></div><div><span className="resource-label">Type / identity</span><strong>{item.type.replaceAll("_", " ")}</strong></div><div><span className="resource-label">Versions</span><strong>{item.currentVersion ? `Published v${item.currentVersion.versionNumber}` : "Not published"}{item.draftVersion ? ` · Draft v${item.draftVersion.versionNumber}` : ""}</strong></div><span className={`status-pill ${item.status === "published" ? "status-green" : "status-neutral"}`}>{item.status}</span><Link className="icon-link" href={item.editHref} aria-label={`Edit ${item.name}`}><Settings2 size={16} /></Link></article>)}</div>}</section>;
}
