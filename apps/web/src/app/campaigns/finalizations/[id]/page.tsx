import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignFinalizationResult } from "@/components/campaign-finalization-result";
import { canPrepareCampaign, preparationUuid } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignFinalizationRepository, getCampaignRepository } from "@/server/database";

export default async function FinalizationResultPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const [route, query] = await Promise.all([params, searchParams]);
  const id = preparationUuid.safeParse(route.id), selectedWorkspace = preparationUuid.safeParse(query.workspaceId);
  if (!id.success || !selectedWorkspace.success || selectedWorkspace.data.toLowerCase() !== workspace.workspaceId) notFound();
  const finalization = await getCampaignFinalizationRepository().get(workspace.workspaceId, id.data.toLowerCase(), user.id);
  if (!finalization || finalization.workspaceId !== workspace.workspaceId || finalization.id !== id.data.toLowerCase()) notFound();
  const [campaign, runs] = await Promise.all([getCampaignRepository().getCampaign(workspace.workspaceId, finalization.campaignId), getCampaignRepository().listCampaignInstances(workspace.workspaceId)]);
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page">
    <Link className="back-link" href="/campaigns">Campaigns</Link><header className="resource-header"><div><p className="eyebrow">Immutable finalization receipt</p><h1>{finalization.compiledDefinition.name}</h1><p>Review the protected plan and its current publication or run status separately.</p></div></header>
    <CampaignFinalizationResult finalization={finalization} campaign={campaign} runs={runs} canWrite={canPrepareCampaign(workspace.role)} />
  </div></WorkspaceShell>;
}
