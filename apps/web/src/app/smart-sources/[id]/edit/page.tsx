import { getActiveWorkspace } from "@/server/active-workspace";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SmartSourceForm } from "@/components/smart-source-form";
import { SourcePreparationBindingForm } from "@/components/source-preparation-binding-form";
import { canConfigureSourcePreparation } from "@/components/source-preparation-binding-request";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignRepository, getCompanionRepository, getProfileRepository, getRepository, getSourcePreparationRepository } from "@/server/database";
import { sourcePreparationUuid } from "@/server/source-preparation-schema";
import { sourcePreparationBindingView, sourcePreparationCommandView } from "@/server/source-preparation-view";

export default async function EditSmartSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const sourceId = sourcePreparationUuid.safeParse((await params).id);
  if (!sourceId.success) notFound();
  const source = await repository.getSmartSource(workspace.workspaceId, sourceId.data);
  if (!source) notFound();
  const sourcePreparations = getSourcePreparationRepository();
  const [connections, contextPacks, items, companions, binding, commands, brands, audiences, destinations] = await Promise.all([
    repository.listStorageConnections(workspace.workspaceId), repository.listContextPacks(workspace.workspaceId),
    repository.listSourceItems(source.id), getCompanionRepository().listWorkers(workspace.workspaceId),
    sourcePreparations.getSourcePreparationBindingForSource(workspace.workspaceId, source.id, user.id),
    sourcePreparations.listSourcePreparationCommands(workspace.workspaceId, source.id, user.id),
    getProfileRepository().listBrandProfiles(workspace.workspaceId),
    getProfileRepository().listAudienceProfiles(workspace.workspaceId),
    getCampaignRepository().listDestinations(workspace.workspaceId),
  ]);
  return (
    <WorkspaceShell activePath="/smart-sources" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page form-page">
        <Link className="back-link" href="/smart-sources"><ArrowLeft size={14} />Smart Sources</Link>
        <header className="resource-header"><div><p className="eyebrow">Version {source.version}</p><h1>Edit {source.name}</h1><p>Changes create a new configuration version and an audit event.</p></div></header>
        <SmartSourceForm workspaceId={workspace.workspaceId} source={source} connections={connections} contextPacks={contextPacks} companions={companions} />
        <SourcePreparationBindingForm workspaceId={workspace.workspaceId} smartSourceId={source.id} sourceEnabled={source.enabled}
          canWrite={canConfigureSourcePreparation(workspace.role)} initialBinding={binding ? sourcePreparationBindingView(binding) : undefined}
          commands={commands.map(sourcePreparationCommandView)}
          brands={brands.filter((item) => item.status === "published" && item.currentVersion?.status === "published")
            .map((item) => ({ id: item.currentVersion!.id, name: item.name, versionNumber: item.currentVersion!.versionNumber }))}
          audiences={audiences.filter((item) => item.status === "published" && item.currentVersion?.status === "published")
            .map((item) => ({ id: item.currentVersion!.id, name: item.name, versionNumber: item.currentVersion!.versionNumber }))}
          destinations={destinations.filter((item) => item.status === "published").map(({ id, title }) => ({ id, title }))} />
        <section className="discovered-panel">
          <div className="resource-panel-head"><div><h2>Discovered items</h2><p>{items.length} active item{items.length === 1 ? "" : "s"} in the normalized source index</p></div></div>
          {items.length === 0 ? <p className="discovered-empty">Connect this source and run a read-only sync to populate the index.</p> : <div>{items.slice(0, 50).map((item) => <div className="discovered-row" key={item.id}><div><strong>{item.name}</strong><p>{item.displayPath}</p></div><span>{item.isFolder ? "Folder" : item.mimeType}</span><span>{item.objectKey ? "Content received" : item.contentHash ? "Awaiting content" : "Metadata only"}</span></div>)}</div>}
        </section>
      </div>
    </WorkspaceShell>
  );
}
