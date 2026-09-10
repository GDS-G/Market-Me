import { getActiveWorkspace } from "@/server/active-workspace";
import { redirect } from "next/navigation";
import { CompanionManagement } from "@/components/companion-management";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCompanionRepository } from "@/server/database";

export default async function CompanionPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const repository = getCompanionRepository();
  const [workers, jobs] = await Promise.all([repository.listWorkers(workspace.workspaceId), repository.listJobs(workspace.workspaceId)]);
  return <WorkspaceShell activePath="/companion" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page companion-page">
      <header className="resource-header"><div><p className="eyebrow">Local execution</p><h1>Desktop companion</h1><p>Pair attended workers, inspect health, and dispatch narrowly authorized local jobs.</p></div></header>
      <CompanionManagement jobs={jobs} workers={workers} workspaceId={workspace.workspaceId} />
    </div>
  </WorkspaceShell>;
}
