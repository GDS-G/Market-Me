import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PreparationPresetForm } from "@/components/preparation-preset-form";
import { presetChoices,presetPageScope } from "@/server/preparation-preset-pages";

export default async function NewPresetPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const query=await searchParams;if(Object.keys(query).some(key=>key!=="workspaceId"))notFound();
  const {user,workspace,canWrite}=await presetPageScope(query.workspaceId);
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page">
    <Link className="back-link" href="/campaigns/presets">← Preparation presets</Link>
    <header className="resource-header"><div><p className="eyebrow">Review-first settings library</p><h1>Create preparation preset</h1><p>Share reusable General Announcement settings with members of this workspace.</p></div></header>
    {canWrite?<PreparationPresetForm workspaceId={workspace.workspaceId} userId={user.id} {...await presetChoices(workspace.workspaceId)}/>:<section className="resource-panel"><h2>Writer access required</h2><p>Owners, administrators and editors can save presets. No request was created.</p></section>}
  </div></WorkspaceShell>;
}
