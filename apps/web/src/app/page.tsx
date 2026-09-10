import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CalendarDays, FileStack, FolderKanban, Megaphone, Plus, ShieldCheck } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository, getDraftRepository, getRepository } from "@/server/database";
import { formatDashboardTime, summarizeWorkspace } from "@/server/dashboard-data";

export default async function Home() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const repository = getRepository();
  const campaignRepository = getCampaignRepository();
  const [sources, packages, campaigns, instances, campaignApprovals, draftApprovals] = await Promise.all([
    repository.listSmartSources(workspace.workspaceId),
    repository.listContentPackages(workspace.workspaceId),
    campaignRepository.listCampaigns(workspace.workspaceId),
    campaignRepository.listCampaignInstances(workspace.workspaceId),
    campaignRepository.listApprovals(workspace.workspaceId, "pending"),
    getDraftRepository().listApprovals(workspace.workspaceId, "pending"),
  ]);
  const summary = summarizeWorkspace({ sources, packages, instances, campaignApprovals, draftApprovals });
  const canWrite = ["owner", "admin", "editor"].includes(workspace.role);
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));

  return (
    <WorkspaceShell activePath="/" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header">
          <div><p className="eyebrow">Your workspace</p><h1>Overview</h1><p>Saved content, workflow runs, and decisions for {workspace.workspaceName}. Refresh to see the latest state.</p></div>
          <div className="heading-actions">
            <Link className="button-secondary resource-button" href="/calendar"><CalendarDays size={16} />View calendar</Link>
            {canWrite && <Link className="button-primary resource-button" href="/campaigns/new"><Plus size={16} />Create campaign</Link>}
          </div>
        </header>

        <section className="metric-grid" aria-label="Workspace summary">
          <MetricCard icon={FolderKanban} tone="violet" label="Enabled sources" value={summary.enabledSources} note={`${sources.length} configured · not a health check`} href="/smart-sources" />
          <MetricCard icon={FileStack} tone="blue" label="Content packages" value={packages.length} note={`${summary.packagesNeedingReview} need review`} href="/content-packages" />
          <MetricCard icon={Megaphone} tone="green" label="Open campaign runs" value={summary.openRuns} note="Includes queued, paused, and awaiting approval" href="/campaigns" />
          <MetricCard icon={ShieldCheck} tone="amber" label="Pending approvals" value={summary.pendingApprovals} note="Review captured inputs before deciding" href="/approvals" />
        </section>

        <section className="dashboard-grid">
          <div className="dashboard-main">
            <section className="panel">
              <PanelHeader title="Recent content packages" subtitle="Most recently updated in this workspace" href="/content-packages" action="All packages" />
              {packages.length ? packages.slice(0, 5).map((item) => (
                <Link className="review-row" key={item.id} href={`/content-packages/${item.id}`}>
                  <FileStack size={18} /><div><strong>{item.title}</strong><p>Updated {formatDashboardTime(item.updatedAt)}</p></div>
                  <span className={`status-pill ${item.status === "needs_review" ? "status-amber" : "status-neutral"}`}>{item.status.replaceAll("_", " ")}</span>
                </Link>
              )) : <div className="review-row"><FileStack size={18} /><div><strong>No content packages yet</strong><p>Connect and synchronize a Smart Source to begin collecting content.</p><p><Link href="/smart-sources" style={{ textDecoration: "underline" }}>Open Smart Sources</Link></p></div></div>}
            </section>

            <section className="panel">
              <PanelHeader title="Recent campaign runs" subtitle="Recorded workflow state, not delivery or engagement estimates" href="/campaigns" action="All campaigns" />
              {instances.length ? instances.slice(0, 5).map((instance) => (
                <Link className="review-row" key={instance.id} href={`/campaign-instances/${instance.id}`}>
                  <Megaphone size={18} /><div><strong>{campaignNames.get(instance.campaignId) ?? "Campaign run"}</strong><p>{instance.stepRuns.filter((step) => step.status === "succeeded").length} of {instance.stepRuns.length} steps succeeded · created {formatDashboardTime(instance.createdAt)}</p></div>
                  <span className={`status-pill ${instance.status === "failed" ? "status-red" : instance.status === "active" ? "status-green" : "status-neutral"}`}>{instance.status.replaceAll("_", " ")}</span>
                </Link>
              )) : <div className="review-row"><Megaphone size={18} /><div><strong>No campaign runs yet</strong><p>Campaign drafts appear in Campaigns. A run is created only when a published version is activated.</p><p><Link href="/campaigns" style={{ textDecoration: "underline" }}>Open Campaigns</Link></p></div></div>}
            </section>

            <section className="panel">
              <PanelHeader title="Smart Sources" subtitle="Configuration and last recorded scan" href="/smart-sources" action="All sources" />
              {sources.length ? sources.slice(0, 5).map((source) => (
                <Link className="review-row" key={source.id} href={`/smart-sources/${source.id}/edit`}>
                  <FolderKanban size={18} /><div><strong>{source.name}</strong><p>{source.provider.replaceAll("_", " ")} · {source.lastScanAt ? `last scan ${formatDashboardTime(source.lastScanAt)}` : "No scan recorded"}</p></div>
                  <span className={`status-pill ${source.enabled ? "status-green" : "status-neutral"}`}>{source.enabled ? "Enabled" : "Paused"}</span>
                </Link>
              )) : <div className="review-row"><FolderKanban size={18} /><div><strong>No Smart Sources configured</strong><p>Connect Google Drive, Microsoft storage, or the local Companion from Smart Sources.</p><p><Link href="/smart-sources" style={{ textDecoration: "underline" }}>Set up content intake</Link></p></div></div>}
            </section>
          </div>

          <aside className="dashboard-side">
            <section className="panel">
              <PanelHeader title="Decisions to review" subtitle="Pending requests from persisted approval queues" href="/approvals" action="Review queue" />
              <div className="review-row"><ShieldCheck size={18} /><div><strong>{summary.pendingApprovals ? `${summary.pendingApprovals} pending approval${summary.pendingApprovals === 1 ? "" : "s"}` : "No pending approvals"}</strong><p>{draftApprovals.length} content draft · {campaignApprovals.length} workflow</p><p>Open the approval queue to inspect the exact snapshot and available decisions.</p></div></div>
              {summary.packagesNeedingReview > 0 && <Link className="review-row" href="/content-packages"><FileStack size={18} /><div><strong>{summary.packagesNeedingReview} package{summary.packagesNeedingReview === 1 ? "" : "s"} need review</strong><p>Package review is separate from publication approval.</p></div><ArrowUpRight size={14} /></Link>}
            </section>
            <section className="panel">
              <PanelHeader title="Workspace tools" subtitle="Continue with the next part of your workflow" />
              <Link className="review-row" href="/calendar"><CalendarDays size={18} /><div><strong>Campaign agenda</strong><p>Inspect saved timing, blocked plans, and run state.</p></div><ArrowUpRight size={14} /></Link>
              <Link className="review-row" href="/integrations"><FolderKanban size={18} /><div><strong>Connections and collector status</strong><p>Review configured integrations and operational alerts.</p></div><ArrowUpRight size={14} /></Link>
              <Link className="review-row" href="/ai-settings"><FileStack size={18} /><div><strong>AI configuration and usage</strong><p>Manage providers, policies, and recorded costs.</p></div><ArrowUpRight size={14} /></Link>
            </section>
          </aside>
        </section>
      </div>
    </WorkspaceShell>
  );
}

function MetricCard({ icon: Icon, tone, label, value, note, href }: { icon: typeof FolderKanban; tone: string; label: string; value: number; note: string; href: string }) {
  return <Link className="metric-card" href={href}><div className={`metric-icon tone-${tone}`}><Icon size={19} /></div><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></Link>;
}

function PanelHeader({ title, subtitle, href, action }: { title: string; subtitle: string; href?: string; action?: string }) {
  return <header className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{href && action && <Link href={href}>{action} <ArrowUpRight size={14} /></Link>}</header>;
}
