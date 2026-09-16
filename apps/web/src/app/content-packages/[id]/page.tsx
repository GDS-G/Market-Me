import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ContentPackageReviewError } from "@market-me/database";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ContentPackageReviewActions } from "@/components/content-package-review-actions";
import { reviewUuid } from "@/components/content-package-review-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository, getContentPackageReviewRepository, getProfileRepository, getPublishingRepository, getSourcePreparationRepository } from "@/server/database";
import { createAssetPreviewUrl } from "@/server/media";

export default async function ContentPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const parsed = reviewUuid.safeParse((await params).id); if (!parsed.success) notFound();
  const id = parsed.data;
  const repository = getContentPackageReviewRepository();
  let review;
  try { review = await repository.getReview(workspace.workspaceId, id, user.id); }
  catch (error) {
    if (!(error instanceof ContentPackageReviewError)) throw error;
    if (error.code === "access_denied" || error.code === "package_unavailable") notFound();
    return <WorkspaceShell activePath="/content-packages" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page form-page"><Link href="/content-packages">Content Packages</Link><h1>Exact review unavailable</h1><p role="alert">{error.message}</p>
        <p>No partial snapshot or approval token is being shown. This package needs a supported complete review before new approval, generation, or preparation.</p><code>{error.code}</code></div>
    </WorkspaceShell>;
  }
  if (!review || review.snapshot.package.id !== id || review.snapshot.package.workspaceId !== workspace.workspaceId) notFound();
  const [channelConnections, campaigns, brands, approvals, sourcePreparationBinding] = await Promise.all([
    getPublishingRepository().listChannelConnections(workspace.workspaceId), getCampaignRepository().listCampaigns(workspace.workspaceId),
    getProfileRepository().listBrandProfiles(workspace.workspaceId), repository.listApprovalSummaries(workspace.workspaceId, id, user.id),
    getSourcePreparationRepository().getSourcePreparationBindingForSource(workspace.workspaceId, review.snapshot.package.smartSourceId, user.id),
  ]);
  const assetPreviews = review.snapshot.assets.flatMap((asset) => {
    const url = asset.role === "derivative" && asset.mimeType.startsWith("image/") ? createAssetPreviewUrl(asset.id) : undefined;
    return url ? [{ id: asset.id, contentHash: asset.contentHash, url }] : [];
  });
  return <WorkspaceShell activePath="/content-packages" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page"><Link className="back-link" href="/content-packages"><ArrowLeft size={14} />Content Packages</Link>
      <ContentPackageReviewActions userId={user.id} workspaceId={workspace.workspaceId} packageId={id} role={workspace.role} initialReview={review} approvals={approvals} assetPreviews={assetPreviews}
        sourcePreparationEnabled={Boolean(sourcePreparationBinding?.enabled)}
        channelConnections={channelConnections.filter((item) => ["discord_webhook", "mastodon_account"].includes(item.provider)).map(({ id, name, status, provider }) => ({ id, name, status, provider }))}
        campaigns={campaigns.map(({ id, name, status }) => ({ id, name, status }))} brandProfiles={brands.filter((item) => item.currentVersion).map(({ id, name, status }) => ({ id, name, status }))} />
    </div>
  </WorkspaceShell>;
}
