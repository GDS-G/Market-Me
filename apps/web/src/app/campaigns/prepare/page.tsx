import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignPreparationForm } from "@/components/campaign-preparation-form";
import { canPrepareCampaign, preparationUuid } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository, getProfileRepository, getRepository, getPreparationPresetRepository } from "@/server/database";
import { presetPageNumber } from "@/server/preparation-preset-pages";

export default async function PrepareCampaignPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const parameters = await searchParams;
  if (Object.keys(parameters).some(key => !["contentPackageId", "workspaceId", "presetId", "presetVersion", "presetRevision"].includes(key))) notFound();
  if (parameters.workspaceId !== undefined && parameters.workspaceId !== workspace.workspaceId) notFound();
  const selectedPackageId = parameters.contentPackageId;
  if (selectedPackageId !== undefined && !preparationUuid.safeParse(selectedPackageId).success) notFound();
  let preset: { id: string; title: string; revision: number; versionNumber: number; archived: boolean } | undefined;
  if (parameters.presetId !== undefined || parameters.presetVersion !== undefined || parameters.presetRevision !== undefined) {
    if (parameters.workspaceId !== workspace.workspaceId || typeof parameters.presetId !== "string" || !preparationUuid.safeParse(parameters.presetId).success) notFound();
    const number = presetPageNumber(parameters.presetVersion), revision = presetPageNumber(parameters.presetRevision);
    if (number === undefined || revision === undefined) notFound();
    const saved = await getPreparationPresetRepository().get(workspace.workspaceId, parameters.presetId, user.id, number);
    if (!saved) notFound();
    // Keep the explicitly selected revision; the copy operation rejects a later
    // root change instead of silently substituting its current state.
    preset = { id: saved.root.id, title: saved.version.title, revision, versionNumber: number, archived: saved.root.archived };
  }
  const [packages, brands, audiences, destinations] = await Promise.all([
    getRepository().listContentPackages(workspace.workspaceId),
    getProfileRepository().listBrandProfiles(workspace.workspaceId),
    getProfileRepository().listAudienceProfiles(workspace.workspaceId),
    getCampaignRepository().listDestinations(workspace.workspaceId),
  ]);
  const selected = packages.find((item) => item.id === selectedPackageId);
  if (selectedPackageId && !selected) notFound();
  const approved = packages.filter((item) => item.status === "approved");
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page">
      <Link className="back-link" href="/campaigns"><ArrowLeft size={14} />Campaigns</Link>
      <header className="resource-header"><div><p className="eyebrow">Review-first preparation</p><h1>Prepare campaign</h1><p>Prepare a campaign and evidence-backed drafts from an approved package. Nothing is activated or sent externally.</p></div></header>
      {!canPrepareCampaign(workspace.role) ? <section className="resource-panel"><div className="empty-inline"><h2>Writer access required</h2><p>Owners, admins, and editors can prepare campaigns. Draft approval remains a separate permission.</p><Link href="/drafts">View existing drafts</Link></div></section> : <>
        {selected && selected.status !== "approved" && <p className="form-error" role="alert">This package is not approved. <Link href={`/content-packages/${selected.id}`}>Review its current revision</Link> before preparing it.</p>}
        {!approved.length && <p className="form-help">No approved packages are available. <Link href="/content-packages">Review Content Packages</Link>, or check an earlier saved attempt below.</p>}
        <CampaignPreparationForm userId={user.id} workspaceId={workspace.workspaceId} preset={preset}
          packages={approved.map(({ id, title, version }) => ({ id, title, version }))}
          selectedPackageId={selected?.status === "approved" ? selected.id : undefined}
          brands={brands.filter((item) => item.status === "published" && item.currentVersion?.status === "published").map((item) => ({ id: item.currentVersion!.id, name: item.name, versionNumber: item.currentVersion!.versionNumber }))}
          audiences={audiences.filter((item) => item.status === "published" && item.currentVersion?.status === "published").map((item) => ({ id: item.currentVersion!.id, name: item.name, versionNumber: item.currentVersion!.versionNumber }))}
          destinations={destinations.filter((item) => item.status === "published").map(({ id, title }) => ({ id, title }))} />
      </>}
    </div>
  </WorkspaceShell>;
}
