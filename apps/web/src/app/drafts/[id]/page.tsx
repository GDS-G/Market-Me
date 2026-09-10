import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Database, Sparkles } from "lucide-react";
import { AiTextDraftProposals } from "@/components/ai-text-draft-proposals";
import { AiDraftRevisionRequest } from "@/components/ai-draft-revision-request";
import { AiDraftRevisionOutputs } from "@/components/ai-draft-revision-outputs";
import { DraftChannelPreviews } from "@/components/draft-channel-previews";
import { DraftSubmitAction } from "@/components/draft-review-actions";
import { DraftRevisionForm } from "@/components/draft-revision-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { defaultWorkspaceAiPolicy } from "@/server/ai-schema";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository, getCampaignRepository, getDraftRepository, getPublishingRepository, getRepository } from "@/server/database";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const draftRepository = getDraftRepository();
  const aiRepository = getAiRepository();
  const draft = await draftRepository.get(workspace.workspaceId, (await params).id);
  if (!draft) notFound();
  const aiPolicy = (await aiRepository.getPolicy(workspace.workspaceId)) ??
    defaultWorkspaceAiPolicy(workspace.workspaceId);
  const aiAsOf = new Date();
  const [previews, connections, destinations, contentPackage, aiProposals,
    aiBindings, aiIntents, aiOutputArtifacts, executionControl, budgetStatus] = await Promise.all([
    draftRepository.listChannelPreviews(workspace.workspaceId, draft.id),
    getPublishingRepository().listChannelConnections(workspace.workspaceId),
    getCampaignRepository().listDestinations(workspace.workspaceId),
    getRepository().getContentPackage(workspace.workspaceId, draft.generation.contentPackageId),
    aiRepository.listWorkspaceTextDraftProposals(workspace.workspaceId, draft.id, user.id),
    aiRepository.listWorkspaceAdapterInvocationBindings(workspace.workspaceId, user.id, aiAsOf),
    aiRepository.listWorkspaceTextInvocationIntents(workspace.workspaceId, user.id, aiAsOf),
    aiRepository.listWorkspaceTextOutputArtifacts(workspace.workspaceId, user.id),
    aiRepository.getWorkspaceExecutionControl(workspace.workspaceId, user.id, aiAsOf),
    aiRepository.getBudgetStatus(workspace.workspaceId, aiPolicy.currency),
  ]);
  const version = draft.currentVersion;
  const previewAssets = (contentPackage?.assets ?? [])
    .filter((asset) => asset.objectKey && asset.byteSize && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(asset.mimeType))
    .map((asset) => {
      const accessibility = asset.sourceAssetId
        ? contentPackage?.assets.find((candidate) => candidate.id === asset.sourceAssetId)
        : asset;
      return {
        id: asset.id,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize!,
        mediaStatus: asset.mediaStatus,
        scanStatus: asset.scanStatus,
        scanRevision: asset.scanRevision,
        scanScannedAt: asset.scanScannedAt,
        rightsStatus: asset.rightsStatus,
        altTextStatus: accessibility?.altTextStatus,
        altText: accessibility?.altText,
      };
    });
  const canEdit = ["owner", "admin", "editor"].includes(workspace.role);
  const canApprove = ["owner", "admin", "approver"].includes(workspace.role);
  const serverConfiguration = getServerConfiguration();
  const aiVaultAvailable = Buffer.from(serverConfiguration.aiProviderCredentialEncryptionKey ?? "", "base64").length === 32;

  return <WorkspaceShell activePath="/drafts" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page draft-detail">
      <Link className="back-link" href="/drafts"><ArrowLeft size={14} />Drafts</Link>
      <header className="resource-header"><div><p className="eyebrow">{draft.audienceName ?? "General audience"} · immutable v{version.versionNumber}</p><h1>{version.headline}</h1><p>{draft.campaignName} · {draft.packageTitle}</p></div><span className={`status-pill ${draft.status === "approved" ? "status-green" : draft.status === "pending_review" ? "status-amber" : "status-neutral"}`}>{draft.status.replaceAll("_", " ")}</span></header>
      <section className="draft-copy-card"><p>{version.body}</p>{version.callToAction && <strong>{version.callToAction}</strong>}{version.hashtags.length > 0 && <small>{version.hashtags.join(" ")}</small>}</section>
      <section className="resource-panel draft-trace"><div className="resource-panel-head"><div><h2>Claim and evidence trace</h2><p>Every factual statement points to the captured package evidence.</p></div></div><div className="claim-list">{version.claims.map((claim) => <article key={claim.id}><span>{claim.kind === "fact" ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}</span><div><strong>{claim.text}</strong><p>{claim.evidenceItemIds.length ? claim.evidenceItemIds.map((id) => { const evidence = draft.generation.evidenceSnapshot.find((item) => item.id === id); return `${evidence?.provenance ?? "evidence"}: ${evidence?.sourceReferences.join(", ") || id}`; }).join(" · ") : "Presentation-only call to action; no factual evidence asserted."}</p></div></article>)}</div></section>
      <section className="resource-panel draft-trace"><div className="resource-panel-head"><div><h2>Reproducibility record</h2><p>Exact generation inputs are retained even when source context changes later.</p></div></div><div className="generation-meta"><Database size={18} /><div><strong>{draft.generation.generatorProvider}/{draft.generation.generatorModel} {draft.generation.generatorVersion}</strong><p>Prompt {draft.generation.promptVersion} · {draft.generation.draftFormat.replaceAll("_", " ")} · Package v{draft.generation.contentPackageVersion} · {draft.generation.informationDepth} depth · {draft.generation.promotionalStrength} promotion</p><p>{version.rationale}</p>{version.changeNote && <p>Revision note: {version.changeNote}</p>}</div></div></section>
      {["working", "changes_requested"].includes(draft.status) && <AiDraftRevisionRequest
        workspaceId={workspace.workspaceId}
        contentDraftId={draft.id}
        contentDraftVersionId={version.id}
        bindings={aiBindings}
        reservations={budgetStatus.recentReservations}
        intents={aiIntents}
        canEdit={canEdit}
        executionAvailable={
          serverConfiguration.aiProviderExecutionEnabled &&
          aiVaultAvailable &&
          executionControl.executionAllowed
        }
      />}
      <AiDraftRevisionOutputs
        workspaceId={workspace.workspaceId}
        contentDraftId={draft.id}
        contentDraftVersionId={version.id}
        outputArtifacts={aiOutputArtifacts}
        proposals={aiProposals}
        canApprove={canApprove}
        canEdit={canEdit}
        vaultAvailable={aiVaultAvailable}
      />
      <AiTextDraftProposals
        workspaceId={workspace.workspaceId}
        proposals={aiProposals}
        canEdit={canEdit}
        draftPresentation={{
          leadIn: String(version.presentationChoices.leadIn ?? ""),
          callToAction: version.callToAction ?? "",
          hashtags: version.hashtags,
          altText: version.altText ?? "",
        }}
      />
      {["working", "changes_requested"].includes(draft.status) && <DraftRevisionForm workspaceId={workspace.workspaceId} draft={draft} />}
      <DraftSubmitAction workspaceId={workspace.workspaceId} draftId={draft.id} status={draft.status} />
      <DraftChannelPreviews
        workspaceId={workspace.workspaceId}
        draftId={draft.id}
        approved={draft.status === "approved"}
        connections={connections.filter((item) => item.status === "active").map((item) => ({ id: item.id, name: item.name, provider: item.provider }))}
        destinations={destinations.filter((item) => item.status === "published").map((item) => ({ id: item.id, name: item.title, title: item.title }))}
        assets={previewAssets}
        previews={previews}
      />
    </div>
  </WorkspaceShell>;
}
