import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getWorkspaceManagementRepository } from "@/server/database";
import { WorkspaceManagementForm } from "@/components/workspace-management-form";
import styles from "@/components/workspace-management.module.css";

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const settings = await getWorkspaceManagementRepository().getSettings(workspace.workspaceId, user.id);
  if (!settings) notFound();
  const canManageTeam = ["owner", "admin"].includes(workspace.role);
  return (
    <WorkspaceShell activePath="/settings" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header"><div><p className="eyebrow">Account &amp; workspace</p><h1>Settings</h1><p>Review your current workspace and signed-in account.</p></div></header>
        <section className={`resource-panel ${styles.panel}`}>
          <h2>Current workspace</h2><p>If you belong to multiple workspaces, select one in the sidebar and choose Switch workspace.</p>
          <div className={styles.summary}><div><strong>{workspace.workspaceName}</strong><p>Your role: {workspace.role}</p></div><Link href="/team" className="button-secondary">{canManageTeam ? "Manage team invitations" : "View team"}</Link></div>
          <p>Existing member role changes are not available in this interface. {canManageTeam ? "Owners and administrators can manage invitations on the Team page." : "Contact a workspace owner or administrator for access changes."}</p>
        </section>
        <section className={`resource-panel ${styles.panel}`}><h2>Workspace settings</h2>
          {settings.canRename ? <WorkspaceManagementForm operation="rename" userId={user.id} workspaceId={settings.workspaceId}
            organizationId={settings.organizationId} organizationName={settings.organizationName} currentName={settings.name} revision={settings.revision} />
            : <p>Only a current workspace owner or administrator can rename this workspace. Organization ownership alone does not grant that permission. Settings revision: {settings.revision}.</p>}
        </section>
        <section className={`resource-panel ${styles.panel}`}><h2>Workspaces in {settings.organizationName}</h2>
          <p>Create a separate, empty workspace for another client or team. Existing members and content are not inherited.</p>
          {settings.canCreateWorkspace ? <Link className="button-secondary resource-button" href={`/settings/workspaces/new?organizationId=${settings.organizationId}`}>Create another workspace</Link>
            : <p>Only an organization owner may create a workspace. Workspace administration alone does not grant that permission.</p>}
        </section>
        <section className={`resource-panel ${styles.panel}`}>
          <h2>Signed-in account</h2><p>Profile details are supplied by your sign-in provider.</p>
          <div className={styles.summary}><div><strong>{user.displayName}</strong><p>{user.email}</p></div></div>
          <p>Account profile editing is not available here. Use your sign-in provider to manage your profile.</p>
        </section>
      </div>
    </WorkspaceShell>
  );
}
