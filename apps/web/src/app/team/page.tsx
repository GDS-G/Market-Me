import { getActiveWorkspace } from "@/server/active-workspace";
import { redirect } from "next/navigation";
import { UsersRound } from "lucide-react";
import { TeamInvitations } from "@/components/team-invitations";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository } from "@/server/database";

export default async function TeamPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const canManage = ["owner", "admin"].includes(workspace.role);
  const [members, invitations] = await Promise.all([
    repository.listWorkspaceMembers(workspace.workspaceId),
    canManage ? repository.listWorkspaceInvitations(workspace.workspaceId) : Promise.resolve([]),
  ]);
  return (
    <WorkspaceShell activePath="/team" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header"><div><p className="eyebrow">Identity &amp; access</p><h1>Team</h1><p>Grant exact-email access through your configured identity provider. Market Me never sends or stores a password.</p></div></header>
        <section className="resource-panel">
          <div className="resource-panel-head"><div><h2>Workspace members</h2><p>{members.length} active member{members.length === 1 ? "" : "s"}</p></div></div>
          <div className="resource-table">
            {members.map((member) => <article className="resource-row team-member-row" key={member.userId}><span className="resource-icon"><UsersRound size={18} /></span><div className="resource-primary"><strong>{member.displayName}</strong><p>Authenticated workspace member</p></div><span className="status-pill status-green">{member.role}</span></article>)}
          </div>
        </section>
        {canManage && <section className="resource-panel">
          <div className="resource-panel-head"><div><h2>Identity invitations</h2><p>Pending grants expire automatically and are consumed only by a matching verified email.</p></div></div>
          <TeamInvitations workspaceId={workspace.workspaceId} invitations={invitations} canManage={canManage} />
        </section>}
      </div>
    </WorkspaceShell>
  );
}
