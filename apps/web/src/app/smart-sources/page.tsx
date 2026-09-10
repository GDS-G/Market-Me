import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban, Plus, Settings2 } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getRepository } from "@/server/database";

const providerLabels = {
  google_drive: "Google Drive",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  local: "Local folder",
} as const;

export default async function SmartSourcesPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const sources = await repository.listSmartSources(workspace.workspaceId);

  return (
    <WorkspaceShell activePath="/smart-sources" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header">
          <div><p className="eyebrow">Content intake</p><h1>Smart Sources</h1><p>Turn stable folder activity into governed, traceable content packages.</p></div>
          <Link className="button-primary resource-button" href="/smart-sources/new"><Plus size={15} />New Smart Source</Link>
        </header>
        <section className="resource-panel">
          <div className="resource-panel-head"><div><h2>Configured sources</h2><p>{sources.length} source{sources.length === 1 ? "" : "s"} in this workspace</p></div></div>
          {sources.length === 0 ? (
            <div className="empty-state"><span><FolderKanban size={22} /></span><h3>No Smart Sources yet</h3><p>Connect a folder, define readiness, then test the configuration before processing begins.</p><Link className="button-primary resource-button" href="/smart-sources/new">Create the first source</Link></div>
          ) : (
            <div className="resource-table">
              {sources.map((source) => (
                <article className="resource-row" key={source.id}>
                  <span className="resource-icon"><FolderKanban size={18} /></span>
                  <div className="resource-primary"><strong>{source.name}</strong><p>{source.locations.map((location) => location.displayPath).join(", ")}</p></div>
                  <div><span className="resource-label">Provider</span><strong>{providerLabels[source.provider]}</strong></div>
                  <div><span className="resource-label">Readiness</span><strong>{source.readinessMode.replaceAll("_", " ")}</strong></div>
                  <span className={`status-pill ${source.enabled ? "status-green" : "status-neutral"}`}>{source.enabled ? "Enabled" : "Paused"}</span>
                  <Link className="icon-link" href={`/smart-sources/${source.id}/edit`} aria-label={`Edit ${source.name}`}><Settings2 size={16} /></Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
