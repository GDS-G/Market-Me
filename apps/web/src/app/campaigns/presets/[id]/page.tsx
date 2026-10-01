import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PreparationPresetForm } from "@/components/preparation-preset-form";
import { presetDetailPath,presetSettingsSchema } from "@/components/preparation-preset-contract";
import { getPreparationPresetRepository } from "@/server/database";
import { presetChoices,presetPageNumber,presetPageScope } from "@/server/preparation-preset-pages";
import styles from "@/components/preparation-preset.module.css";

export default async function PresetPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const query=await searchParams;if(Object.keys(query).some(key=>!["workspaceId","version","before"].includes(key)))notFound();
  const parsed=z.uuid().safeParse((await params).id);if(!parsed.success)notFound();
  const {user,workspace,canWrite}=await presetPageScope(query.workspaceId),versionNumber=presetPageNumber(query.version),before=presetPageNumber(query.before);
  const repository=getPreparationPresetRepository();
  const [saved,history]=await Promise.all([repository.get(workspace.workspaceId,parsed.data,user.id,versionNumber),repository.history(workspace.workspaceId,parsed.data,user.id,before)]);
  if(!saved)notFound();
  const {root,version}=saved,configuration=presetSettingsSchema.parse(version.configuration),detail=presetDetailPath(workspace.workspaceId,root.id);
  const prepare=`/campaigns/prepare?workspaceId=${encodeURIComponent(workspace.workspaceId)}&presetId=${root.id}&presetVersion=${version.versionNumber}&presetRevision=${root.revision}`;
  return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page">
    <Link className="back-link" href="/campaigns/presets">← Preparation presets</Link>
    <header className="resource-header"><div><p className="eyebrow">Immutable saved version {version.versionNumber}</p><h1>{version.title}</h1><p>{root.archived?"Archived — new copies are disabled.":"Available for an explicit settings copy."} Latest version {root.latestVersionNumber} · library revision {root.revision}.</p></div></header>
    <section className={`resource-panel ${styles.details}`} aria-label="Saved preset settings"><h2>What this version prepares</h2><p>{version.notes||"No library notes"}</p>
      <p>Campaign name: {configuration.name}</p><p>Description: {configuration.description||"None"}</p><p>Information depth: {configuration.informationDepth.replaceAll("_"," ")}. Promotional strength: {configuration.promotionalStrength.replaceAll("_"," ")}. Timezone: {configuration.timezone}.</p>
      <p>{configuration.brandProfileVersionId?"One exact Brand version selected.":"No Brand selected."} {configuration.audienceProfileVersionIds.length} ordered Audience versions selected. {configuration.destinationId?"One Destination selected.":"No Destination selected."}</p>
      <p>General Announcement compiler v1 creates draft-only awareness planning. Current profile publication and ceilings are checked again before a new copy or save; historical selections may now be unavailable.</p>
      {version.copiedFrom&&<p>Cloned from <Link href={presetDetailPath(workspace.workspaceId,version.copiedFrom.presetId,version.copiedFrom.versionNumber)}>saved source version {version.copiedFrom.versionNumber}</Link>. Later edits are independent.</p>}
      {canWrite&&!root.archived&&<Link className="button-primary resource-button" href={prepare}>Review and copy into preparation</Link>}
      <p>Copying is a separate explicit action on the preparation form. It will not replace a saved recovery attempt, choose a package or grant an approval. Existing Campaigns and source bindings remain unchanged.</p>
    </section>
    <section className={`resource-panel ${styles.details}`}><h2>Version history</h2><ol>{history.items.map(item=><li key={item.versionNumber}><Link href={presetDetailPath(workspace.workspaceId,root.id,item.versionNumber)}>v{item.versionNumber} · {item.title}</Link><time dateTime={item.createdAt}>{item.createdAt.replace("T"," ").replace("Z"," UTC")}</time></li>)}</ol>
      <div className={styles.actions}>{before&&<Link href={detail}>Newest history</Link>}{history.more&&<Link href={`${detail}&version=${version.versionNumber}&before=${history.items.at(-1)!.versionNumber}`}>Older history</Link>}</div></section>
    {canWrite?<PreparationPresetForm workspaceId={workspace.workspaceId} userId={user.id} {...await presetChoices(workspace.workspaceId)} saved={{presetId:root.id,revision:root.revision,versionNumber:version.versionNumber,latestVersionNumber:root.latestVersionNumber,archived:root.archived,title:version.title,notes:version.notes,configuration}}/>
      :<p>Writer access is required to create a new version, clone, copy or change archive state.</p>}
  </div></WorkspaceShell>;
}
