import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignPreparationResult } from "@/components/campaign-preparation-result";
import { canPrepareCampaign, preparationUuid } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignPreparationRepository, getDraftRepository } from "@/server/database";

export default async function PreparationResultPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const [route, query] = await Promise.all([params, searchParams]);
  const parsedId = preparationUuid.safeParse(route.id);
  const parsedWorkspace = preparationUuid.safeParse(query.workspaceId);
  if (!parsedId.success || !parsedWorkspace.success || parsedWorkspace.data.toLowerCase() !== workspace.workspaceId) notFound();
  const id = parsedId.data.toLowerCase();
  const preparation = await getCampaignPreparationRepository().get(workspace.workspaceId, id, user.id);
  if (!preparation || preparation.workspaceId !== workspace.workspaceId || preparation.id !== id) notFound();
  const drafts = await Promise.all(preparation.preparedDrafts.map(({ draftId }) => getDraftRepository().get(workspace.workspaceId, draftId)));
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page">
      <Link className="back-link" href="/campaigns"><ArrowLeft size={14} />Campaigns</Link>
      <header className="resource-header"><div><p className="eyebrow">Immutable preparation receipt</p><h1>{preparation.configurationSnapshot.name}</h1><p>{preparation.configurationSnapshot.description || "General Announcement planning campaign"}</p></div></header>
      <CampaignPreparationResult preparation={preparation} userId={user.id} canWrite={canPrepareCampaign(workspace.role)} availableDraftIds={drafts.flatMap((draft) => draft ? [draft.id] : [])} />
    </div>
  </WorkspaceShell>;
}
