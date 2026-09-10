import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone, Plus, Settings2 } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canPrepareCampaign, preparationResultPath } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignPreparationRepository, getCampaignRepository } from "@/server/database";

export default async function CampaignsPage() {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const repository = getCampaignRepository();
  const [campaigns, instances, preparations] = await Promise.all([repository.listCampaigns(workspace.workspaceId), repository.listCampaignInstances(workspace.workspaceId), getCampaignPreparationRepository().listForWorkspace(workspace.workspaceId, user.id)]);
  const receiptByCampaign = new Map(preparations.map((receipt) => [receipt.campaignId, receipt.id]));
  const activeCount = instances.filter((item) => ["active", "scheduled", "paused"].includes(item.status)).length;
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page">
    <header className="resource-header"><div><p className="eyebrow">Durable orchestration</p><h1>Campaigns</h1><p>Prepare reviewed drafts, then separately version and activate an executable plan.</p></div>
      {canPrepareCampaign(workspace.role) && <div className="form-actions"><Link className="button-primary resource-button" href="/campaigns/prepare"><Plus size={15} />Prepare campaign</Link><Link href="/campaigns/new">Advanced campaign editor</Link></div>}
    </header>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Campaign definitions</h2><p>{activeCount} live or queued instance{activeCount === 1 ? "" : "s"}</p></div></div>
      {campaigns.length === 0 ? <div className="empty-state"><span><Megaphone size={22} /></span><h3>No campaigns yet</h3><p>Start with an approved Content Package to prepare a draft-only campaign and reviewable copy. Preparation does not start a run.</p></div>
        : <div className="resource-table">{campaigns.map((campaign) => <article className="resource-row" key={campaign.id}><span className="resource-icon"><Megaphone size={18} /></span><div className="resource-primary"><strong>{campaign.name}</strong><p>{campaign.description || "No description"}</p>{receiptByCampaign.has(campaign.id) && <Link href={preparationResultPath(receiptByCampaign.get(campaign.id)!, workspace.workspaceId)}>Original preparation receipt</Link>}</div><div><span className="resource-label">Published plan</span><strong>{campaign.currentVersion ? `v${campaign.currentVersion.versionNumber}` : "Not yet"}</strong></div><div><span className="resource-label">Steps</span><strong>{(campaign.draftVersion ?? campaign.currentVersion)?.steps.length ?? 0}</strong></div><span className={`status-pill ${campaign.status === "active" ? "status-green" : "status-neutral"}`}>{campaign.currentVersion?.autonomyMode === "draft_only" ? "Draft-only plan" : campaign.status}</span><Link className="icon-link" href={`/campaigns/${campaign.id}/edit`} aria-label={`Edit ${campaign.name}`}><Settings2 size={16} /></Link></article>)}</div>}
    </section>
    {instances.length > 0 && <section className="resource-panel"><div className="resource-panel-head"><div><h2>Recent workflow runs</h2><p>Temporal-backed execution state</p></div></div><div className="resource-table">{instances.slice(0, 10).map((instance) => <Link className="resource-row" href={`/campaign-instances/${instance.id}`} key={instance.id}><span className="resource-icon"><Megaphone size={18} /></span><div className="resource-primary"><strong>{campaigns.find((campaign) => campaign.id === instance.campaignId)?.name ?? "Campaign run"}</strong><p>{instance.temporalWorkflowId ?? "Awaiting dispatch"}</p></div><span className="status-pill status-neutral">{instance.status}</span></Link>)}</div></section>}
  </div></WorkspaceShell>;
}
