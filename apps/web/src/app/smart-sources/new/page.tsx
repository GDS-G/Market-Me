import { getActiveWorkspace } from "@/server/active-workspace";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SourceSetupWizard } from "@/components/source-setup-wizard";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCompanionRepository, getRepository } from "@/server/database";

export default async function NewSmartSourcePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const canWrite = ["owner", "admin", "editor"].includes(workspace.role);
  const repository = getRepository();
  const [connections, contextPacks, companions] = canWrite ? await Promise.all([
    repository.listStorageConnections(workspace.workspaceId), repository.listContextPacks(workspace.workspaceId),
    getCompanionRepository().listWorkers(workspace.workspaceId),
  ]) : [[], [], []];
  return (
    <WorkspaceShell activePath="/smart-sources" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page form-page">
        <Link className="back-link" href="/smart-sources"><ArrowLeft size={14} />Smart Sources</Link>
        <header className="resource-header"><div><p className="eyebrow">Guided intake setup</p><h1>Create a Smart Source</h1><p>Choose a folder, review what will be included, and save it paused before enabling monitoring.</p></div></header>
        {canWrite ? <SourceSetupWizard workspaceId={workspace.workspaceId} userId={user.id}
          connections={connections.filter((item) => item.status === "active").map((item) => ({ id: item.id, name: item.displayName, provider: item.provider }))}
          contextPacks={contextPacks.filter((item) => item.status === "published" && item.currentVersion?.status === "published").map((item) => ({
            id: item.id, name: item.name, expectedVersionId: item.currentVersion!.id, versionNumber: item.currentVersion!.versionNumber,
          }))}
          companions={companions.filter((item) => item.status !== "revoked").map((item) => ({ id: item.id, name: item.name,
            health: item.status === "paused" ? "paused" : item.effectiveHealthState }))} />
          : <p>Creating a source requires an owner, administrator, or editor in this workspace. You can still review existing sources.</p>}
      </div>
    </WorkspaceShell>
  );
}
