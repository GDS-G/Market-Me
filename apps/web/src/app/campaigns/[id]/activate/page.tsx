import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { campaignActivationUuid, isCampaignActivationError } from "@market-me/database";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignActivationPanel } from "@/components/campaign-activation-panel";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignActivationRepository, getCampaignRepository } from "@/server/database";

export default async function CampaignActivationPage({ params,searchParams }: {
  params: Promise<{id:string}>; searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const user=await getAuthenticatedUser();if(!user)redirect("/login");
  const workspace=await getActiveWorkspace(user.id);if(!workspace)redirect("/login");
  const query=await searchParams;let campaignId:string,expectedVersionId:string|undefined;
  try{campaignId=campaignActivationUuid((await params).id);
    if(Object.keys(query).some(k=>k!=="workspaceId"&&k!=="expectedVersionId")||campaignActivationUuid(query.workspaceId)!==workspace.workspaceId)notFound();
    expectedVersionId=query.expectedVersionId===undefined?undefined:campaignActivationUuid(query.expectedVersionId);
  }catch{notFound();}
  const campaign=await getCampaignRepository().getCampaign(workspace.workspaceId,campaignId);if(!campaign)notFound();
  let initial;
  try{initial=await getCampaignActivationRepository().preview(workspace.workspaceId,campaignId,user.id);}
  catch(error){if(!isCampaignActivationError(error)||error.code!=="preview_unavailable")throw error;}
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page"><header className="resource-header"><div><p className="eyebrow">Durable campaign activation</p><h1>Review and recover a campaign run</h1>
      <p>{campaign.name}: one exact published version and one retained request.</p></div><Link className="button-secondary" href={`/campaigns/${campaignId}/edit`}>Back to campaign</Link></header>
      <CampaignActivationPanel userId={user.id} workspaceId={workspace.workspaceId} campaignId={campaignId} expectedVersionId={expectedVersionId} initial={initial}/>
    </div>
  </WorkspaceShell>;
}
