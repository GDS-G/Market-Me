import { getActiveWorkspace } from "@/server/active-workspace";
import { notFound, redirect } from "next/navigation";
import { WORKSPACE_MEMBER_ROLE_LIMITS, isWorkspaceMemberLifecycleError } from "@market-me/database";
import { TeamInvitations } from "@/components/team-invitations";
import { WorkspaceMemberRoleForm } from "@/components/workspace-member-role-form";
import { WorkspaceMemberRemovalPanel } from "@/components/workspace-member-removal-panel";
import styles from "@/components/workspace-management.module.css";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository, getWorkspaceMemberRoleRepository, getWorkspaceMemberLifecycleRepository } from "@/server/database";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const query = await searchParams;
  if (Object.keys(query).some(key => key !== "page" && key !== "invitationMember") || typeof query.page !== "undefined" && (typeof query.page !== "string" || !/^[1-9]\d{0,3}$/.test(query.page))) notFound();
  if (query.invitationMember !== undefined && (typeof query.invitationMember !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(query.invitationMember))) notFound();
  const page = Number(query.page ?? "1");
  if (page > WORKSPACE_MEMBER_ROLE_LIMITS.maxPage) notFound();
  const team = await getWorkspaceMemberRoleRepository().listMembers(workspace.workspaceId, user.id, page);
  const canManage = team.canManage;
  if (query.invitationMember && !canManage) notFound();
  let invitations;
  try {
    invitations = canManage ? query.invitationMember
      ? await getWorkspaceMemberLifecycleRepository().listPendingInvitations(workspace.workspaceId, query.invitationMember, user.id)
      : await repository.listWorkspaceInvitations(workspace.workspaceId) : [];
  } catch (error) { if (isWorkspaceMemberLifecycleError(error) && (error.code === "not_found" || error.code === "access_denied")) notFound(); throw error; }
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
        {canManage && <section className={`resource-panel ${styles.panel}`}><h2>Remove workspace access</h2>
          <WorkspaceMemberRemovalPanel userId={user.id} workspaceId={workspace.workspaceId} members={team.members} /></section>}
        {canManage && <section className="resource-panel" id="identity-invitations">
          <div className="resource-panel-head"><div><h2>Identity invitations</h2><p>Pending grants expire automatically and are consumed only by a matching verified email.</p></div></div>
          {query.invitationMember && <p>Related pending invitations for member {query.invitationMember}: incoming grants or grants issued by that member, at most 200 shown. Review and revoke only the invitations you intend to cancel. Reloading after each change reveals remaining related grants; unrelated invitations are excluded. <a href="/team#identity-invitations">Return to all recent invitations</a></p>}
          <TeamInvitations key={`${user.id}:${workspace.workspaceId}:${query.invitationMember ?? "recent"}`} workspaceId={workspace.workspaceId} invitations={invitations} canManage={canManage} showCreateForm={!query.invitationMember} />
        </section>}
      </div>
    </WorkspaceShell>
  );
}
