import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PackageReviewSnapshot } from "@/components/content-package-review-display";
import { packageApprovalResultPath, reviewUuid } from "@/components/content-package-review-request";
import { SourcePreparationCommandStatus } from "@/components/source-preparation-command-status";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getContentPackageReviewRepository, getSourcePreparationRepository } from "@/server/database";
import { sourcePreparationCommandView } from "@/server/source-preparation-view";

export default async function PackageApprovalPage({ params, searchParams }: {
  params: Promise<{ id: string; approvalId: string }>; searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const path = await params, query = await searchParams;
  const packageId = reviewUuid.safeParse(path.id), approvalId = reviewUuid.safeParse(path.approvalId), workspaceId = reviewUuid.safeParse(query.workspaceId);
  if (!packageId.success || !approvalId.success || !workspaceId.success || workspaceId.data !== workspace.workspaceId) notFound();
  const approval = await getContentPackageReviewRepository().getApproval(workspace.workspaceId, approvalId.data, user.id);
  if (!approval || approval.id !== approvalId.data || approval.workspaceId !== workspace.workspaceId || approval.contentPackageId !== packageId.data) notFound();
  const preparationCommand = await getSourcePreparationRepository().getSourcePreparationCommandForApproval(
    workspace.workspaceId, packageId.data, approvalId.data, user.id,
  );
  const resultPath = packageApprovalResultPath(packageId.data, approvalId.data, workspace.workspaceId);
  return <WorkspaceShell activePath="/content-packages" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page"><Link className="back-link" href={`/content-packages/${packageId.data}`}>View current package review</Link>
      <header className="resource-header"><div><p className="eyebrow">Immutable original approval receipt</p><h1>{approval.reviewSnapshot.package.title}</h1>
        <p>Source revision {approval.contentPackageVersion} · approved at {approval.createdAt}</p></div></header>
      <section className="resource-panel"><div className="empty-inline"><h2>Historical attestation, not current permission</h2>
        <p>This receipt preserves the exact review originally approved. It does not assert that today&apos;s package, rights, or eligibility still match; it never reapproves later changes.</p>
        <p>Approval ID: {approval.id}</p><p>Actor: {approval.createdBy}</p><p style={{ overflowWrap: "anywhere" }}>Review fingerprint: <code>{approval.reviewFingerprint}</code></p>
        <p>Evidence evaluator: {approval.evidenceContract} · contract version {approval.contractVersion}</p></div></section>
      <section className="resource-panel" aria-labelledby="approval-preparation-heading"><div className="resource-panel-head"><div>
        <h2 id="approval-preparation-heading">Approval-linked draft preparation</h2>
        <p>This is the authoritative handoff state for this exact approval receipt. It does not grant approval, activation, scheduling, publication, provider, or send authority.</p>
      </div></div>
        {preparationCommand
          ? <SourcePreparationCommandStatus workspaceId={workspace.workspaceId} command={sourcePreparationCommandView(preparationCommand)} />
          : <div className="empty-inline"><h3>No preparation command recorded</h3><p>No approval-linked preparation was queued in this approval transaction. Later binding configuration or enablement does not backfill this historical receipt.</p></div>}
        <div className="form-actions"><Link href={resultPath}>Refresh preparation status</Link>
          <Link href={`/smart-sources/${approval.reviewSnapshot.package.smartSourceId}/edit`}>View Smart Source setup</Link></div>
      </section>
      <PackageReviewSnapshot snapshot={approval.reviewSnapshot} effectiveEvidenceIds={approval.effectiveEvidenceIds}
        excludedEvidenceIds={approval.reviewSnapshot.evidence.filter((item) => !approval.effectiveEvidenceIds.includes(item.id)).map((item) => item.id)} />
    </div>
  </WorkspaceShell>;
}
