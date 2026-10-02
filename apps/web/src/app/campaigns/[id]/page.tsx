import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignInspection } from "@/components/campaign-inspection";
import { canPrepareCampaign, preparationUuid } from "@/components/campaign-preparation-request";
import { finalizationResultPath } from "@/components/campaign-finalization-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository, getCampaignFinalizationRepository } from "@/server/database";
import { workspaceAnalyticsPath } from "@/server/workspace-analytics-view";
import styles from "../../../components/campaign-inspection.module.css";

export default async function CampaignInspectionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const parsedId = preparationUuid.safeParse((await params).id);
  const query = await searchParams;
  if (!parsedId.success || Object.keys(query).some(key => key !== "workspaceId")) notFound();
  if (query.workspaceId !== undefined) {
    const selected = preparationUuid.safeParse(query.workspaceId);
    if (!selected.success || selected.data.toLowerCase() !== workspace.workspaceId.toLowerCase()) notFound();
  }
  const campaignId = parsedId.data.toLowerCase();
  const campaign = await getCampaignRepository().getCampaign(workspace.workspaceId, campaignId);
  if (!campaign || campaign.id !== campaignId || campaign.workspaceId !== workspace.workspaceId) notFound();
  const finalization = await getCampaignFinalizationRepository().getForCampaign(workspace.workspaceId, campaignId, user.id);
  if (finalization && (finalization.workspaceId !== workspace.workspaceId || finalization.campaignId !== campaignId)) notFound();
  const canWrite = canPrepareCampaign(workspace.role), archived = campaign.status === "archived";
  const published = campaign.currentVersion;
  const canReviewActivation = canWrite && !archived && !finalization && published?.campaignId === campaignId && published.status === "published" && published.autonomyMode !== "draft_only";
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page">
      <Link className="back-link" href="/campaigns">Campaigns</Link>
      <header className="resource-header"><div><p className="eyebrow">Campaign inspection</p><h1>{campaign.name}</h1>
        <p>{campaign.description || "No description saved."}</p><p>Recorded campaign status: {campaign.status.replaceAll("_", " ")}. Individual run progress is separate.</p>
      </div></header>
      {!canWrite && <p>Read-only access: owner, administrator or editor membership is required to create, edit, publish or activate a campaign.</p>}
      {archived && <p>This campaign is archived. This page offers inspection only.</p>}
      {finalization && <section className="form-section"><h2>Protected exact-preview plan</h2>
        <p>Advanced editing is unavailable. The original finalization receipt retains its reviewed content and lineage; current eligibility is checked separately.</p>
        <Link prefetch={false} href={finalizationResultPath(finalization.id, workspace.workspaceId)}>Inspect original finalization receipt</Link>
      </section>}
      <div className={styles.actions}>
        {canWrite && !archived && !finalization && <Link className="button-secondary" href={`/campaigns/${campaignId}/edit`}>Open advanced editor</Link>}
        {canReviewActivation && <Link className="button-secondary" prefetch={false} href={`/campaigns/${campaignId}/activate?${new URLSearchParams({ workspaceId: workspace.workspaceId, expectedVersionId: published.id })}`}>Review published-version activation</Link>}
        <Link prefetch={false} href={workspaceAnalyticsPath(workspace.workspaceId, campaignId)}>Campaign analytics</Link>
      </div>
      <CampaignInspection campaign={campaign} />
      <p><Link href="/campaigns">Inspect current workflow runs</Link>. This page does not infer live run progress from a saved version.</p>
    </div>
  </WorkspaceShell>;
}
