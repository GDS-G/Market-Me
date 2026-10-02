import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { WorkspaceExecutionControlPanel } from "@/components/workspace-execution-control-panel";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getWorkspaceExecutionControlRepository } from "@/server/database";

export default async function WorkspaceExecutionPage() {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const snapshot = await getWorkspaceExecutionControlRepository().getSnapshot(workspace.workspaceId, user.id);
  return <WorkspaceShell activePath="/settings" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page"><header className="resource-header"><div><p className="eyebrow">Workspace safety</p><h1>Workspace execution</h1>
      <p>Pause new outbound admissions for {workspace.workspaceName}, with a reviewed and auditable change.</p></div><Link className="button-secondary" href="/settings">Back to Settings</Link></header>
      <WorkspaceExecutionControlPanel userId={user.id} workspaceId={workspace.workspaceId} initial={snapshot} />
    </div>
  </WorkspaceShell>;
}
