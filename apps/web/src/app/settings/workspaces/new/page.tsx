import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { workspaceManagementUuid } from "@market-me/database";
import { WorkspaceShell } from "@/components/workspace-shell";
import { WorkspaceManagementForm } from "@/components/workspace-management-form";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getWorkspaceManagementRepository } from "@/server/database";
import styles from "@/components/workspace-management.module.css";

export default async function NewWorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  const query = await searchParams;
  if (Object.keys(query).some(key => key !== "organizationId") || typeof query.organizationId !== "string") notFound();
  let organizationId: string;
  try { organizationId = workspaceManagementUuid(query.organizationId); } catch { notFound(); }
  const organization = await getWorkspaceManagementRepository().getCreationOrganization(organizationId, user.id);
  if (!organization) notFound();
  return <WorkspaceShell activePath="/settings" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className="resource-page form-page"><Link href="/settings" className="back-link">Back to settings</Link>
      <header className="resource-header"><div><p className="eyebrow">Organization owner</p><h1>New workspace</h1><p>Separate access and content from your existing workspaces.</p></div></header>
      <section className={`resource-panel ${styles.panel}`}><WorkspaceManagementForm operation="create" userId={user.id} organizationId={organization.id} organizationName={organization.name} /></section>
    </div>
  </WorkspaceShell>;
}
