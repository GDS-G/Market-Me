import Link from "next/link";
import { redirect } from "next/navigation";
import { DraftGenerationForm } from "@/components/draft-generation-form";
import { canPrepareCampaign } from "@/components/campaign-preparation-request";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository, getRepository } from "@/server/database";

export default async function GenerateDraftsPage() {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const canWrite = canPrepareCampaign(workspace.role);
  const [campaigns, packages] = canWrite ? await Promise.all([getCampaignRepository().listCampaigns(workspace.workspaceId), getRepository().listContentPackages(workspace.workspaceId)]) : [[], []];
  const eligible = campaigns.filter(campaign => campaign.currentVersion).map(campaign => ({ id: campaign.id, name: campaign.name, packages: campaign.currentVersion!.contentPackageIds.map(id => packages.find(item => item.id === id)).filter((item): item is NonNullable<typeof item> => item?.status === "approved").map(item => ({ id: item.id, title: item.title })) })).filter(campaign => campaign.packages.length);
  return <WorkspaceShell activePath="/drafts" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page">
    <header className="resource-header"><div><p className="eyebrow">Evidence-backed copy</p><h1>Generate drafts</h1><p>Use an existing published plan and an exact approved package review. Opening this page does not generate, approve or send anything.</p></div><Link prefetch={false} href="/drafts">Back to draft search</Link></header>
    <section className="resource-panel draft-generator-panel"><div className="resource-panel-head"><div><h2>Generate from an existing published plan</h2><p>Publishing an internal plan does not send content externally. Audience variants share the same approved factual claim set.</p></div></div>
      {canWrite && eligible.length ? <DraftGenerationForm workspaceId={workspace.workspaceId} campaigns={eligible} /> : <div className="empty-inline"><p>{canWrite ? "Prepare an approved Content Package to create a draft-only plan and its first drafts together." : "Writer access required. A workspace owner, admin, or editor can prepare campaigns and generate drafts."}</p>{canWrite && <Link prefetch={false} className="button-primary resource-button" href="/campaigns/prepare">Prepare campaign</Link>}</div>}
    </section>
  </div></WorkspaceShell>;
}
