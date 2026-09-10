import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignFinalizationForm } from "@/components/campaign-finalization-form";
import { finalizationPreviewChoices, finalizationResultPath } from "@/components/campaign-finalization-request";
import { canPrepareCampaign, preparationResultPath, preparationUuid } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignFinalizationRepository, getCampaignPreparationRepository, getDraftRepository } from "@/server/database";

export default async function FinalizeCampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const [route, query] = await Promise.all([params, searchParams]);
  const id = preparationUuid.safeParse(route.id), selectedWorkspace = preparationUuid.safeParse(query.workspaceId);
  if (!id.success || !selectedWorkspace.success || selectedWorkspace.data.toLowerCase() !== workspace.workspaceId) notFound();
  const preparation = await getCampaignPreparationRepository().get(workspace.workspaceId, id.data.toLowerCase(), user.id);
  if (!preparation || preparation.workspaceId !== workspace.workspaceId || preparation.id !== id.data.toLowerCase()) notFound();
  const existing = await getCampaignFinalizationRepository().getForCampaign(workspace.workspaceId, preparation.campaignId, user.id);
  if (existing) redirect(finalizationResultPath(existing.id, workspace.workspaceId));
  const canWrite = canPrepareCampaign(workspace.role);
  const options = canWrite ? await getDraftRepository().listCampaignPreviewOptions(workspace.workspaceId, preparation.campaignId) : [];
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page"><Link className="back-link" href={preparationResultPath(preparation.id, workspace.workspaceId)}>Original preparation</Link>
      <header className="resource-header"><div><p className="eyebrow">Exact-preview finalization</p><h1>Create an executable draft</h1><p>{preparation.configurationSnapshot.name} · same campaign, one approved text preview, separate activation.</p></div></header>
      <section className="form-section"><div><h2>Review prepared drafts first</h2><p>Approve the desired copy, then create its channel preview. A current preview will appear below after refreshing this page.</p></div><ul>{preparation.preparedDrafts.map((draft, index) => <li key={draft.draftId}><Link href={`/drafts/${draft.draftId}`}>Review {preparation.referenceSnapshot.audiences[index]?.name ?? "General audience"} draft</Link></li>)}</ul></section>
      {canWrite ? <CampaignFinalizationForm userId={user.id} workspaceId={workspace.workspaceId} preparationId={preparation.id} planningVersionId={preparation.planningVersionId} generationId={preparation.generationId}
        choices={finalizationPreviewChoices(options, preparation.planningVersionId, preparation.preparedDrafts.map((draft) => draft.draftId))} />
        : <section className="resource-panel"><h2>Writer access required</h2><p>Owners, admins, and editors can finalize campaigns. Draft approval is a separate permission.</p></section>}
    </div>
  </WorkspaceShell>;
}
