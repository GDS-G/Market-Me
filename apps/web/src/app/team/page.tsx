import { getActiveWorkspace } from "@/server/active-workspace";
import { notFound, redirect } from "next/navigation";
import { WORKSPACE_MEMBER_ROLE_LIMITS } from "@market-me/database";
import { TeamInvitations } from "@/components/team-invitations";
import { WorkspaceMemberRoleForm } from "@/components/workspace-member-role-form";
import styles from "@/components/workspace-management.module.css";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository, getWorkspaceMemberRoleRepository } from "@/server/database";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const query = await searchParams;
  if (Object.keys(query).some(key => key !== "page") || typeof query.page !== "undefined" && (typeof query.page !== "string" || !/^[1-9]\d{0,3}$/.test(query.page))) notFound();
  const page = Number(query.page ?? "1");
  if (page > WORKSPACE_MEMBER_ROLE_LIMITS.maxPage) notFound();
  const team = await getWorkspaceMemberRoleRepository().listMembers(workspace.workspaceId, user.id, page);
  const canManage = team.canManage;
  const invitations = canManage ? await repository.listWorkspaceInvitations(workspace.workspaceId) : [];
  return (
    <WorkspaceShell activePath="/team" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header"><div><p className="eyebrow">Identity &amp; access</p><h1>Team</h1><p>Grant exact-email access through your configured identity provider. Market Me never sends or stores a password.</p></div></header>
        <section className={`resource-panel ${styles.panel}`}>
          <h2>Workspace members</h2><p>Loaded team snapshot · page {page} · {team.members.length} member{team.members.length === 1 ? "" : "s"} shown. Reload after changes for current roles.</p>
          {team.members.map(member => <article className={styles.summary} key={member.userId}><div><strong>{member.displayName}</strong>
            <p>{member.userId === user.id ? "Your membership" : "Authenticated workspace member"} · role revision {member.revision}</p></div><span className="status-pill status-green">{member.role}</span></article>)}
          <nav className={styles.actions} aria-label="Member pages">{page > 1 && <a href={`/team?page=${page - 1}`} className="button-secondary">Previous members</a>}
            {team.more && page < WORKSPACE_MEMBER_ROLE_LIMITS.maxPage && <a href={`/team?page=${page + 1}`} className="button-secondary">Next members</a>}</nav>
        </section>
        {canManage && <section className={`resource-panel ${styles.panel}`}><h2>Member role management</h2>
          <WorkspaceMemberRoleForm userId={user.id} workspaceId={workspace.workspaceId} members={team.members} /></section>}
        {canManage && <section className="resource-panel">
          <div className="resource-panel-head"><div><h2>Identity invitations</h2><p>Pending grants expire automatically and are consumed only by a matching verified email.</p></div></div>
          <TeamInvitations workspaceId={workspace.workspaceId} invitations={invitations} canManage={canManage} />
        </section>}
      </div>
    </WorkspaceShell>
  );
}
