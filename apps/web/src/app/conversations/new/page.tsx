import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RelationshipForm } from "@/components/relationship-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";


export default async function NewRelationshipPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");

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
            <p className="eyebrow">Relationship foundation</p>
            <h1>Add relationship</h1>
            <p>
              Record only known business context and explicit provider identity
              evidence.
            </p>
          </div>
        </header>
        <RelationshipForm
          currentUserId={user.id}
          currentUserName={user.displayName}
          workspaceId={workspace.workspaceId}
        />
      </div>
    </WorkspaceShell>
  );
}
