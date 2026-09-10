import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { randomUUID } from "node:crypto";
import { ContextPackForm } from "@/components/context-pack-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository } from "@/server/database";

export default async function EditContextPackPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const pack = await repository.getContextPack(workspace.workspaceId, (await params).id);
  if (!pack) notFound();
  return <WorkspaceShell activePath="/context-packs" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page"><Link className="back-link" href="/context-packs"><ArrowLeft size={14} />Context Packs</Link><header className="resource-header"><div><p className="eyebrow">Versioned grounding</p><h1>{pack.name}</h1><p>{pack.currentVersion ? `Published version ${pack.currentVersion.versionNumber}. Saving changes creates or updates a separate draft.` : "Draft only. Publish after source and fact review."}</p></div></header><ContextPackForm key={pack.draftVersion?.id ?? `published-${pack.currentVersion?.id ?? "none"}`} workspaceId={workspace.workspaceId} sourceIdSeed={randomUUID()} pack={pack} /></div></WorkspaceShell>;
}
