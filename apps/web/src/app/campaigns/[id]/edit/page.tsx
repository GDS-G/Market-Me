import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/campaign-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignRepository, getDraftRepository, getProfileRepository, getPublishingRepository, getRepository } from "@/server/database";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const core = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const campaignId = (await params).id;
  const campaigns = getCampaignRepository();
  const profileRepo = getProfileRepository();
  const [campaign, packages, destinations, connections, brandProfiles, audienceProfiles, previewOptions] = await Promise.all([
    campaigns.getCampaign(workspace.workspaceId, campaignId),
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
