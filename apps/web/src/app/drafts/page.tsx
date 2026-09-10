import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePenLine } from "lucide-react";
import { DraftGenerationForm } from "@/components/draft-generation-form";
import { canPrepareCampaign } from "@/components/campaign-preparation-request";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignRepository, getDraftRepository, getRepository } from "@/server/database";

export default async function DraftsPage() {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const core = getRepository(); const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const [drafts, campaigns, packages] = await Promise.all([getDraftRepository().list(workspace.workspaceId), getCampaignRepository().listCampaigns(workspace.workspaceId), core.listContentPackages(workspace.workspaceId)]);
  const eligible = campaigns.filter((campaign) => campaign.currentVersion).map((campaign) => ({ id: campaign.id, name: campaign.name, packages: campaign.currentVersion!.contentPackageIds.map((id) => packages.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => item?.status === "approved").map((item) => ({ id: item.id, title: item.title })) })).filter((campaign) => campaign.packages.length);
  const canWrite = canPrepareCampaign(workspace.role);
  return <WorkspaceShell activePath="/drafts" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page">
    <header className="resource-header"><div><p className="eyebrow">Evidence-backed copy</p><h1>Drafts</h1><p>Generate reproducible audience variants from exact Campaign, profile, package, and evidence versions.</p></div></header>
    <section className="resource-panel draft-generator-panel"><div className="resource-panel-head"><div><h2>Generate from an existing published plan</h2><p>Publishing an internal plan does not send content externally. Audience variants share the same approved factual claim set.</p></div></div>
      {canWrite && eligible.length ? <DraftGenerationForm workspaceId={workspace.workspaceId} campaigns={eligible} /> : <div className="empty-inline"><p>{canWrite ? "Prepare an approved Content Package to create a draft-only plan and its first drafts together." : "A workspace owner, admin, or editor can prepare campaigns and generate drafts."}</p>{canWrite && drafts.length > 0 && <Link href="/campaigns/prepare">Prepare campaign</Link>}</div>}
    </section>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Generated variants</h2><p>{drafts.length} governed draft{drafts.length === 1 ? "" : "s"}</p></div></div>
      {drafts.length === 0 ? <div className="empty-state"><span><FilePenLine size={22} /></span><h3>No drafts yet</h3><p>Prepare an approved Content Package to create reviewable copy and its evidence trace.</p>{canWrite && <Link className="button-primary resource-button" href="/campaigns/prepare">Prepare campaign</Link>}</div>
        : <div className="resource-table">{drafts.map((draft) => <Link className="resource-row draft-row" href={`/drafts/${draft.id}`} key={draft.id}><span className="resource-icon"><FilePenLine size={18} /></span><div className="resource-primary"><strong>{draft.currentVersion.headline}</strong><p>{draft.currentVersion.body}</p></div><div><span className="resource-label">Campaign</span><strong>{draft.campaignName}</strong></div><div><span className="resource-label">Audience</span><strong>{draft.audienceName ?? "General"}</strong></div><span className={`status-pill ${draft.status === "approved" ? "status-green" : draft.status === "pending_review" ? "status-amber" : "status-neutral"}`}>{draft.status.replaceAll("_", " ")}</span></Link>)}</div>}
    </section>
  </div></WorkspaceShell>;
}
