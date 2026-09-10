import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { ConversationThreadForm } from "@/components/conversation-thread-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import {
  getCampaignRepository,
  getConversationRepository,
  getRelationshipRepository,
  getRepository,
} from "@/server/database";

export default async function NewConversationPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const [relationships, members, campaigns, destinations, contextDirectory] =
    await Promise.all([
      getRelationshipRepository().listRelationships(workspace.workspaceId),
      repository.listWorkspaceMembers(workspace.workspaceId),
      getCampaignRepository().listCampaigns(workspace.workspaceId),
      getCampaignRepository().listDestinations(workspace.workspaceId),
      getConversationRepository().listContextDirectory(workspace.workspaceId),
    ]);

  return (
    <WorkspaceShell
      activePath="/conversations"
      userName={user.displayName}
      workspaceName={workspace.workspaceName}
    >
      <div className="resource-page form-page">
        <Link className="back-link" href="/conversations">
          <ArrowLeft size={14} /> Conversations
        </Link>
        <header className="resource-header">
          <div>
            <p className="eyebrow">Provider-neutral history</p>
            <h1>New conversation</h1>
            <p>
              Create an inbox thread without triggering an outbound provider
              action.
            </p>
          </div>
        </header>
        {relationships.length === 0 ? (
          <section className="resource-panel empty-state conversation-empty">
            <span>
              <UserRound size={22} />
            </span>
            <h3>Add a relationship first</h3>
            <p>
              Every thread must be attached to a workspace relationship and its
              contact-safety state.
            </p>
            <Link className="button-primary" href="/conversations/new">
              New relationship
            </Link>
          </section>
        ) : (
          <ConversationThreadForm
            brands={contextDirectory.brands}
            campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
            channels={contextDirectory.channels}
            currentUserId={user.id}
            destinations={destinations.map(({ id, title }) => ({ id, title }))}
            members={members}
            publications={contextDirectory.publications}
            relationships={relationships.map(
              ({ id, displayName, effectiveContactPermission }) => ({
                id,
                displayName,
                contactPermission: effectiveContactPermission,
              }),
            )}
            workspaceId={workspace.workspaceId}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}
