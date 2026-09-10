import { getActiveWorkspace } from "@/server/active-workspace";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SmartSourceForm } from "@/components/smart-source-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCompanionRepository, getRepository } from "@/server/database";

export default async function NewSmartSourcePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const repository = getRepository();
  const [connections, contextPacks, companions] = await Promise.all([
    repository.listStorageConnections(workspace.workspaceId), repository.listContextPacks(workspace.workspaceId),
    getCompanionRepository().listWorkers(workspace.workspaceId),
  ]);
  return (
    <WorkspaceShell activePath="/smart-sources" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page form-page">
        <Link className="back-link" href="/smart-sources"><ArrowLeft size={14} />Smart Sources</Link>
        <header className="resource-header"><div><p className="eyebrow">New intake rule</p><h1>Create a Smart Source</h1><p>Start with one folder and explicit readiness rules. You can add context packs after the source is stable.</p></div></header>
        <SmartSourceForm workspaceId={workspace.workspaceId} connections={connections} contextPacks={contextPacks} companions={companions} />
      </div>
    </WorkspaceShell>
  );
}
