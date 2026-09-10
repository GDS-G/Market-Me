import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const canManageTeam = ["owner", "admin"].includes(workspace.role);
  return (
    <WorkspaceShell activePath="/settings" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header"><div><p className="eyebrow">Account &amp; workspace</p><h1>Settings</h1><p>Review your current workspace and signed-in account.</p></div></header>
        <section className="resource-panel">
          <div className="resource-panel-head"><div><h2>Current workspace</h2><p>If you belong to multiple workspaces, select one in the sidebar and choose Switch workspace.</p></div></div>
          <div className="resource-table">
            <div className="resource-row"><div className="resource-primary"><strong>{workspace.workspaceName}</strong><p>Your role: {workspace.role}</p></div><Link href="/team" className="button-secondary">{canManageTeam ? "Manage team invitations" : "View team"}</Link></div>
          </div>
          <p>Workspace name changes and existing member role changes are not available in this interface. {canManageTeam ? "Owners and administrators can manage invitations on the Team page." : "Contact a workspace owner or administrator for access changes."}</p>
        </section>
        <section className="resource-panel">
          <div className="resource-panel-head"><div><h2>Signed-in account</h2><p>Profile details are supplied by your sign-in provider.</p></div></div>
          <div className="resource-table"><div className="resource-row"><div className="resource-primary"><strong>{user.displayName}</strong><p>{user.email}</p></div></div></div>
          <p>Account profile editing is not available here. Use your sign-in provider to manage your profile.</p>
        </section>
      </div>
    </WorkspaceShell>
  );
}
