import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RelationshipForm } from "@/components/relationship-form";
import { RelationshipIdentityResolution } from "@/components/relationship-identity-resolution";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRelationshipRepository } from "@/server/database";

export default async function EditRelationshipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const relationshipId = (await params).id;
  const relationshipRepository = getRelationshipRepository();
  const [relationship, relationships, resolution] = await Promise.all([
    relationshipRepository.getRelationship(workspace.workspaceId, relationshipId),
    relationshipRepository.listRelationships(workspace.workspaceId),
    relationshipRepository.getIdentityResolution(
      workspace.workspaceId,
      relationshipId,
    ),
  ]);
  if (!relationship) notFound();
  if (!resolution) notFound();

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
            <p className="eyebrow">Relationship context and safety</p>
            <h1>{relationship.displayName}</h1>
            <p>
              Suppression changes are independent of relationship stage and
              remain auditable.
            </p>
          </div>
        </header>
        <RelationshipForm
          currentUserId={user.id}
          currentUserName={user.displayName}
          relationship={relationship}
          workspaceId={workspace.workspaceId}
        />
        <RelationshipIdentityResolution
          candidates={relationships
            .filter((candidate) => candidate.id !== relationship.id)
            .map(({ id, displayName, organizationName, identities }) => ({
              id,
              displayName,
              organizationName,
              identities,
            }))}
          relationshipId={relationship.id}
          resolution={resolution}
          workspaceId={workspace.workspaceId}
        />
      </div>
    </WorkspaceShell>
  );
}
