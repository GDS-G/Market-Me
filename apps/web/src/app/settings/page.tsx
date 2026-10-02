import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getAccountProfileRepository, getWorkspaceManagementRepository } from "@/server/database";
import { WorkspaceManagementForm } from "@/components/workspace-management-form";
import { AccountProfileForm } from "@/components/account-profile-form";
import { AccountSessionsSection } from "@/components/account-sessions-section";
import styles from "@/components/workspace-management.module.css";

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const query = await searchParams ?? {};
  if (Object.keys(query).some(key => key !== "sessionCursor") || query.sessionCursor !== undefined
    && (typeof query.sessionCursor !== "string" || !query.sessionCursor || query.sessionCursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.sessionCursor))) notFound();
  const settings = await getWorkspaceManagementRepository().getSettings(workspace.workspaceId, user.id);
  if (!settings) notFound();
  const profile = await getAccountProfileRepository().getProfile(user.id, user.id);
  if (!profile || profile.accountId !== user.id) notFound();
  const canManageTeam = ["owner", "admin"].includes(workspace.role);
  return (
    <WorkspaceShell activePath="/settings" workspaceName={workspace.workspaceName} userName={profile.displayName}>
      <div className="resource-page">
        <header className="resource-header"><div><p className="eyebrow">Account &amp; workspace</p><h1>Settings</h1><p>Review your current workspace and signed-in account.</p></div></header>
        <section className={`resource-panel ${styles.panel}`}>
          <h2>Current workspace</h2><p>If you belong to multiple workspaces, select one in the sidebar and choose Switch workspace.</p>
          <div className={styles.summary}><div><strong>{workspace.workspaceName}</strong><p>Your role: {workspace.role}</p></div><Link href="/team" className="button-secondary">{canManageTeam ? "Manage team" : "View team"}</Link></div>
          <p>{canManageTeam ? "Owners and administrators can manage invitations and reviewed non-owner member-role changes on the Team page." : "Contact a workspace owner or administrator for access changes."} Owner transfer is not available here.</p>
        </section>
        <section className={`resource-panel ${styles.panel}`}><h2>Workspace settings</h2>
          {settings.canRename ? <WorkspaceManagementForm operation="rename" userId={user.id} workspaceId={settings.workspaceId}
            organizationId={settings.organizationId} organizationName={settings.organizationName} currentName={settings.name} revision={settings.revision} />
            : <p>Only a current workspace owner or administrator can rename this workspace. Organization ownership alone does not grant that permission. Settings revision: {settings.revision}.</p>}
        </section>
        <section className={`resource-panel ${styles.panel}`}><h2>Workspace execution</h2>
          <p>Review or pause new publishing, companion claims and billable AI text attempts in this workspace. Already-admitted work may finish; history and settlement remain available.</p>
          <Link className="button-secondary resource-button" href="/settings/execution">Review workspace execution</Link>
        </section>
        <section className={`resource-panel ${styles.panel}`}><h2>Workspaces in {settings.organizationName}</h2>
          <p>Create a separate, empty workspace for another client or team. Existing members and content are not inherited.</p>
          {settings.canCreateWorkspace ? <Link className="button-secondary resource-button" href={`/settings/workspaces/new?organizationId=${settings.organizationId}`}>Create another workspace</Link>
            : <p>Only an organization owner may create a workspace. Workspace administration alone does not grant that permission.</p>}
        </section>
        <section className={`resource-panel ${styles.panel}`}>
          <h2>Signed-in account</h2><p>Your sign-in identity and your Market Me display name are separate.</p>
          <div className={styles.summary}><div><strong>{profile.displayName}</strong><p>Sign-in email: {user.email}</p></div></div>
          <AccountProfileForm profile={profile} />
        </section>
        <section className={`resource-panel ${styles.panel}`}><h2>Sign-in sessions</h2>
          <AccountSessionsSection accountId={user.id} cursor={query.sessionCursor as string | undefined} />
        </section>
      </div>
    </WorkspaceShell>
  );
}
