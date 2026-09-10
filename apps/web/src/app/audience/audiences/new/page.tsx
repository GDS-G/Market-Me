import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link"; import { redirect } from "next/navigation"; import { ArrowLeft } from "lucide-react";
import { AudienceProfileForm } from "@/components/profile-forms";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
export default async function Page() { const user = await getAuthenticatedUser(); if (!user) redirect("/login"); const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login"); return <WorkspaceShell activePath="/audience" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page"><Link className="back-link" href="/audience"><ArrowLeft size={14} />Brands &amp; Audiences</Link><header className="resource-header"><div><p className="eyebrow">New intended audience</p><h1>Create Audience Profile</h1><p>Guide appropriate presentation without inferring sensitive personal traits.</p></div></header><AudienceProfileForm workspaceId={workspace.workspaceId} /></div></WorkspaceShell>; }
