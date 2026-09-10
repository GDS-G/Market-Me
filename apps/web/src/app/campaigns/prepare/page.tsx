import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { CampaignPreparationForm } from "@/components/campaign-preparation-form";
import { canPrepareCampaign, preparationUuid } from "@/components/campaign-preparation-request";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository, getProfileRepository, getRepository } from "@/server/database";

export default async function PrepareCampaignPage({ searchParams }: {
  searchParams: Promise<{ contentPackageId?: string | string[] }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const parameters = await searchParams;
  const selectedPackageId = parameters.contentPackageId;
  if (selectedPackageId !== undefined && !preparationUuid.safeParse(selectedPackageId).success) notFound();
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
        <CampaignPreparationForm userId={user.id} workspaceId={workspace.workspaceId}
          packages={approved.map(({ id, title, version }) => ({ id, title, version }))}
          selectedPackageId={selected?.status === "approved" ? selected.id : undefined}
          brands={brands.filter((item) => item.status === "published" && item.currentVersion?.status === "published").map((item) => ({ id: item.currentVersion!.id, name: item.name, versionNumber: item.currentVersion!.versionNumber }))}
          audiences={audiences.filter((item) => item.status === "published" && item.currentVersion?.status === "published").map((item) => ({ id: item.currentVersion!.id, name: item.name, versionNumber: item.currentVersion!.versionNumber }))}
          destinations={destinations.filter((item) => item.status === "published").map(({ id, title }) => ({ id, title }))} />
      </>}
    </div>
  </WorkspaceShell>;
}
