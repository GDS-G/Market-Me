import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/campaign-form";
import { CampaignFinalizationResult } from "@/components/campaign-finalization-result";
import { canPrepareCampaign, preparationUuid } from "@/components/campaign-preparation-request";
import { finalizationResultPath } from "@/components/campaign-finalization-request";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignFinalizationRepository, getCampaignRepository, getDraftRepository, getProfileRepository, getPublishingRepository, getRepository } from "@/server/database";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const core = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const parsedId = preparationUuid.safeParse((await params).id);
  if (!parsedId.success) notFound();
  const campaignId = parsedId.data.toLowerCase();
  const campaigns = getCampaignRepository();
  const [protectedReceipt, protectedCampaign] = await Promise.all([
    getCampaignFinalizationRepository().getForCampaign(workspace.workspaceId, campaignId, user.id),
    campaigns.getCampaign(workspace.workspaceId, campaignId),
  ]);
  if (!protectedCampaign) notFound();
  if (protectedReceipt) {
    const runs = await campaigns.listCampaignInstances(workspace.workspaceId);
    return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page form-page"><Link className="back-link" href="/campaigns">Campaigns</Link>
        <header className="resource-header"><div><p className="eyebrow">Protected campaign</p><h1>{protectedCampaign.name}</h1><p>Advanced editing is unavailable for a finalized exact-preview plan.</p></div></header>
        <Link href={finalizationResultPath(protectedReceipt.id, workspace.workspaceId)}>Original finalization receipt</Link>
        <CampaignFinalizationResult finalization={protectedReceipt} campaign={protectedCampaign} runs={runs} canWrite={canPrepareCampaign(workspace.role)} />
      </div>
    </WorkspaceShell>;
  }
  const profileRepo = getProfileRepository();
  const [campaign, packages, destinations, connections, brandProfiles, audienceProfiles, previewOptions] = await Promise.all([
    Promise.resolve(protectedCampaign),
    core.listContentPackages(workspace.workspaceId),
    campaigns.listDestinations(workspace.workspaceId),
    getPublishingRepository().listChannelConnections(workspace.workspaceId),
    profileRepo.listBrandProfiles(workspace.workspaceId),
    profileRepo.listAudienceProfiles(workspace.workspaceId),
    getDraftRepository().listCampaignPreviewOptions(workspace.workspaceId, campaignId),
  ]);
  if (!campaign) notFound();
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page">
      <Link className="back-link" href="/campaigns"><ArrowLeft size={14} />Campaigns</Link>
      <header className="resource-header"><div><p className="eyebrow">Versioned workflow</p><h1>{campaign.name}</h1><p>{campaign.currentVersion ? `Published version ${campaign.currentVersion.versionNumber}; edits remain a separate draft.` : "Publish after the workflow graph validates."}</p></div></header>
      <CampaignForm key={campaign.draftVersion?.id ?? campaign.currentVersion?.id} workspaceId={workspace.workspaceId} stepSeed={randomUUID()} campaign={campaign} packages={packages.filter((item) => item.status === "approved")} destinations={destinations.filter((item) => item.status === "published")} brandProfiles={brandProfiles.filter((item) => item.currentVersion)} audienceProfiles={audienceProfiles.filter((item) => item.currentVersion)} channelConnections={connections.filter((item) => item.status === "active").map(({ id, name, provider }) => ({ id, name, provider }))} previewOptions={previewOptions} />
    </div>
  </WorkspaceShell>;
}
