import { getActiveWorkspace } from "@/server/active-workspace";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  ShieldQuestion,
} from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ContentPackageReviewActions } from "@/components/content-package-review-actions";
import { canPrepareCampaign } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import {
  getCampaignRepository,
  getProfileRepository,
  getPublishingRepository,
  getRepository,
} from "@/server/database";
import { createAssetPreviewUrl } from "@/server/media";

function documentExtractionSummary(
  metadata: Record<string, unknown>,
): string | undefined {
  const value = metadata.documentExtraction;
  if (!value || typeof value !== "object") return undefined;
  const extraction = value as Record<string, unknown>;
  const state =
    typeof extraction.state === "string"
      ? extraction.state.replaceAll("_", " ")
      : "unknown";
  const count =
    typeof extraction.pageCount === "number"
      ? `${extraction.pageCount} page${extraction.pageCount === 1 ? "" : "s"}`
      : typeof extraction.selectedPartCount === "number"
        ? `${extraction.selectedPartCount} part${extraction.selectedPartCount === 1 ? "" : "s"}`
        : undefined;
  const parser =
    typeof extraction.parser === "string" ? extraction.parser : undefined;
  return [state, count, parser].filter(Boolean).join(" · ");
}

function extractionMetadataNeedsReview(
  metadata: Record<string, unknown>,
): boolean {
  for (const key of ["documentExtraction", "textExtraction"]) {
    const value = metadata[key];
    if (value && typeof value === "object") {
      const state = (value as Record<string, unknown>).state;
      if (
        state === "truncated" ||
        state === "requires_ocr" ||
        state === "failed"
      )
        return true;
    }
  }
  return false;
}

export default async function ContentPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const { id } = await params;
  const [item, channelConnections, campaigns, brandProfiles] =
    await Promise.all([
      repository.getContentPackage(workspace.workspaceId, id),
      getPublishingRepository().listChannelConnections(workspace.workspaceId),
      getCampaignRepository().listCampaigns(workspace.workspaceId),
      getProfileRepository().listBrandProfiles(workspace.workspaceId),
    ]);
  if (!item) notFound();
  const connectionNames = new Map(
    channelConnections.map((connection) => [connection.id, connection.name]),
  );
  const campaignNames = new Map(
    campaigns.map((campaign) => [campaign.id, campaign.name]),
  );
  const brandProfileNames = new Map(
    brandProfiles.map((profile) => [profile.id, profile.name]),
  );
  const previews = item.assets.flatMap((asset) => {
    const url =
      asset.role === "derivative" && asset.mimeType.startsWith("image/")
        ? createAssetPreviewUrl(asset.id)
        : undefined;
    return url ? [{ asset, url }] : [];
  });

  return (
    <WorkspaceShell
      activePath="/content-packages"
      workspaceName={workspace.workspaceName}
      userName={user.displayName}
    >
      <div className="resource-page form-page">
        <Link className="back-link" href="/content-packages">
          <ArrowLeft size={14} />
          Content Packages
        </Link>
        <header className="resource-header">
          <div>
            <p className="eyebrow">Package version {item.version}</p>
            <h1>{item.title}</h1>
            <p>
              {item.contextPackVersionIds.length} Context Pack version
              {item.contextPackVersionIds.length === 1 ? "" : "s"} captured for
              reproducible grounding.
            </p>
          </div>
          <span
            className={`status-pill ${item.status === "ready" ? "status-green" : "status-amber"}`}
          >
            {item.status.replaceAll("_", " ")}
          </span>
        </header>

        {canPrepareCampaign(workspace.role, item.status) && <section className="resource-panel"><div className="empty-inline">
          <h2>Ready for campaign preparation</h2><p>Create a planning campaign and governed drafts from this approved package revision. Nothing will be activated or sent externally.</p>
          <Link className="button-primary resource-button" href={`/campaigns/prepare?contentPackageId=${item.id}`}>Prepare campaign</Link>
        </div></section>}

        {previews.length > 0 && (
          <section className="review-section">
            <div className="resource-panel-head">
              <div>
                <h2>Derivative previews</h2>
                <p>
                  Cached, non-destructive recipes linked to the immutable
                  original
                </p>
              </div>
            </div>
            <div className="media-preview-grid">
              {previews.map(({ asset, url }) => (
                <figure key={asset.id}>
                  <Image
                    alt={asset.altText ?? "Generated media preview"}
                    src={url}
                    width={Number(asset.metadata.width ?? 640)}
                    height={Number(asset.metadata.height ?? 640)}
                    sizes="(max-width: 760px) 90vw, 28vw"
                    unoptimized
                  />
                  <figcaption>
                    <strong>
                      {String(asset.recipe?.name ?? asset.fileName)}
                    </strong>
                    <span>
                      {String(asset.metadata.width ?? "?")} ×{" "}
                      {String(asset.metadata.height ?? "?")} · {asset.mimeType}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className="review-section">
          <div className="resource-panel-head">
            <div>
              <h2>Assets</h2>
              <p>
                Originals, derivatives, extraction, rights, and accessibility
              </p>
            </div>
          </div>
          {item.assets.map((asset) => {
            const documentSummary = documentExtractionSummary(asset.metadata);
            const needsReview =
              asset.mediaStatus === "failed" ||
              asset.extractionStatus === "failed" ||
              extractionMetadataNeedsReview(asset.metadata);
            return (
              <article className="review-row" key={asset.id}>
                <FileText size={18} />
                <div>
                  <strong>{asset.fileName}</strong>
                  <p>
                    {asset.mimeType} · {asset.contentHash}
                  </p>
                  <small>
                    {asset.role} ·{" "}
                    {asset.byteSize?.toLocaleString() ?? "unknown"} bytes ·
                    media {asset.mediaStatus ?? "legacy"} · extraction{" "}
                    {asset.extractionStatus} · scan{" "}
                    {asset.scanStatus ?? "legacy"}
                    {asset.scanRevision ? ` r${asset.scanRevision}` : ""} ·
                    rights {asset.rightsStatus ?? "legacy"}
                  </small>
                  {asset.scanEngine && asset.scanScannedAt && (
                    <p>
                      Malware scan: {asset.scanEngine} ·{" "}
                      {new Date(asset.scanScannedAt).toLocaleString()}
                    </p>
                  )}
                  {asset.rightsReviewedAt && (
                    <p>
                      Rights revision {asset.rightsRevision} · owner{" "}
                      {asset.rightsOwner} · reviewed by{" "}
                      {asset.rightsReviewedByDisplayName ?? "workspace member"}
                      {asset.rightsExpiresAt
                        ? ` · expires ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(asset.rightsExpiresAt))}`
                        : ""}
                    </p>
                  )}
                  {asset.rightsSourceReference && (
                    <small>
                      Rights source: {asset.rightsSourceReference} · proof:{" "}
                      {asset.rightsProofReference}
                    </small>
                  )}
                  {asset.rightsPermittedChannelConnectionIds?.length ? (
                    <small>
                      Publishing accounts:{" "}
                      {asset.rightsPermittedChannelConnectionIds
                        .map(
                          (connectionId) =>
                            connectionNames.get(connectionId) ?? connectionId,
                        )
                        .join(", ")}
                    </small>
                  ) : null}
                  {asset.rightsPermittedCampaignIds?.length ? (
                    <small>
                      Permitted Campaigns:{" "}
                      {asset.rightsPermittedCampaignIds
                        .map(
                          (campaignId) =>
                            campaignNames.get(campaignId) ?? campaignId,
                        )
                        .join(", ")}
                    </small>
                  ) : null}
                  {asset.rightsPermittedBrandProfileIds?.length ? (
                    <small>
                      Permitted Brand Profiles:{" "}
                      {asset.rightsPermittedBrandProfileIds
                        .map(
                          (brandProfileId) =>
                            brandProfileNames.get(brandProfileId) ??
                            brandProfileId,
                        )
                        .join(", ")}
                    </small>
                  ) : null}
                  {documentSummary && (
                    <p>Document extraction: {documentSummary}</p>
                  )}
                  {asset.extractionError && (
                    <p className="form-error">{asset.extractionError}</p>
                  )}
                  {asset.role === "original" &&
                    asset.mimeType.startsWith("image/") && (
                      <p>
                        Accessibility:{" "}
                        {asset.altTextStatus?.replaceAll("_", " ")}
                        {asset.altText ? ` — ${asset.altText}` : ""}
                      </p>
                    )}
                  {asset.extractedText && (
                    <blockquote>{asset.extractedText.slice(0, 800)}</blockquote>
                  )}
                </div>
                <span
                  className={`status-pill ${needsReview ? "status-red" : asset.mediaStatus === "processed" ? "status-green" : "status-neutral"}`}
                >
                  {needsReview
                    ? "review"
                    : (asset.mediaStatus ?? asset.extractionStatus)}
                </span>
              </article>
            );
          })}
        </section>

        <section className="review-section">
          <div className="resource-panel-head">
            <div>
              <h2>Evidence</h2>
              <p>Observed, authoritative, inferred, and unresolved claims</p>
            </div>
          </div>
          {item.evidence.map((evidence) => (
            <article className="review-row" key={evidence.id}>
              {evidence.provenance === "unresolved" &&
              !evidence.supersededByEvidenceId ? (
                <ShieldQuestion size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              <div>
                <strong>
                  {evidence.factKey ?? evidence.provenance.replaceAll("_", " ")}
                </strong>
                <p>{evidence.claim}</p>
                <small>{evidence.sourceReferences.join(" · ")}</small>
              </div>
              <span className="status-pill status-neutral">
                {evidence.supersededByEvidenceId
                  ? "corrected"
                  : evidence.provenance.replaceAll("_", " ")}
              </span>
            </article>
          ))}
        </section>

        {item.conflicts.length > 0 && (
          <section className="review-section conflict-section">
            <div className="resource-panel-head">
              <div>
                <h2>Conflicts</h2>
                <p>
                  Explicit review is required; Market Me will not silently
                  choose.
                </p>
              </div>
            </div>
            {item.conflicts.map((conflict) => (
              <article className="review-row" key={conflict.id}>
                <AlertTriangle size={18} />
                <div>
                  <strong>{conflict.factKey}</strong>
                  <p>
                    {conflict.candidateEvidenceIds.length} competing
                    authoritative values
                  </p>
                </div>
                <span className="status-pill status-amber">
                  {conflict.status}
                </span>
              </article>
            ))}
          </section>
        )}
        <ContentPackageReviewActions
          workspaceId={workspace.workspaceId}
          item={item}
          channelConnections={channelConnections.filter(
            (connection) => connection.provider === "discord_webhook" || connection.provider === "mastodon_account",
          ).map(
            ({ id: connectionId, name, status, provider }) => ({
              id: connectionId,
              name,
              provider: provider as "discord_webhook" | "mastodon_account",
              status,
            }),
          )}
          campaigns={campaigns.map(({ id: campaignId, name, status }) => ({
            id: campaignId,
            name,
            status,
          }))}
          brandProfiles={brandProfiles
            .filter((profile) => profile.currentVersion)
            .map(({ id: brandProfileId, name, status }) => ({
              id: brandProfileId,
              name,
              status,
            }))}
        />
      </div>
    </WorkspaceShell>
  );
}
