import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DestinationForm } from "@/components/destination-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

export default async function EditDestinationPage({ params }: { params: Promise<{ id: string }> }) { const user = await getAuthenticatedUser(); if (!user) redirect("/login"); const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login"); const item = await getCampaignRepository().getDestination(workspace.workspaceId, (await params).id); if (!item) notFound(); return <WorkspaceShell activePath="/destinations" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page"><Link className="back-link" href="/destinations"><ArrowLeft size={14} />Destinations</Link><header className="resource-header"><div><p className="eyebrow">Canonical identity</p><h1>{item.title}</h1><p>Changes affect future campaign associations; completed workflow history retains its captured outputs.</p></div></header><DestinationForm workspaceId={workspace.workspaceId} destination={item} /></div></WorkspaceShell>; }
