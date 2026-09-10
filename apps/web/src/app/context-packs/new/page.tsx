import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { randomUUID } from "node:crypto";
import { ContextPackForm } from "@/components/context-pack-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";


export default async function NewContextPackPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  return <WorkspaceShell activePath="/context-packs" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page"><Link className="back-link" href="/context-packs"><ArrowLeft size={14} />Context Packs</Link><header className="resource-header"><div><p className="eyebrow">New knowledge set</p><h1>Create Context Pack</h1><p>Start with explicit approved sources; publish only after review.</p></div></header><ContextPackForm workspaceId={workspace.workspaceId} sourceIdSeed={randomUUID()} /></div></WorkspaceShell>;
}
