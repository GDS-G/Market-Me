import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DestinationForm } from "@/components/destination-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";


export default async function NewDestinationPage() { const user = await getAuthenticatedUser(); if (!user) redirect("/login"); const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login"); return <WorkspaceShell activePath="/destinations" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page"><Link className="back-link" href="/destinations"><ArrowLeft size={14} />Destinations</Link><header className="resource-header"><div><p className="eyebrow">New registry entry</p><h1>Add destination</h1><p>Record the canonical identity and business metadata.</p></div></header><DestinationForm workspaceId={workspace.workspaceId} /></div></WorkspaceShell>; }
