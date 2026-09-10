import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CalendarDays, Clock3, FilePenLine } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getCampaignRepository } from "@/server/database";
import { formatDashboardTime, loadCampaignAgenda, type CampaignAgendaEntry } from "@/server/dashboard-data";
import styles from "./calendar.module.css";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ scope?: string | string[]; campaign?: string | string[] }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const [{ campaigns, entries }, query] = await Promise.all([loadCampaignAgenda(workspace.workspaceId, getCampaignRepository()), searchParams]);
  const scope = typeof query.scope === "string" && ["all", "finished", "plans"].includes(query.scope) ? query.scope : "open";
  const campaignId = typeof query.campaign === "string" && campaigns.some((campaign) => campaign.id === query.campaign) ? query.campaign : "";
  const selected = entries.filter((entry) => (!campaignId || entry.campaignId === campaignId) && (scope === "all" || (scope === "plans" ? entry.origin !== "run" : entry.origin === "run" && entry.finished === (scope === "finished"))));
  const timed = selected.filter((entry) => entry.scheduledAt);
  const untimed = selected.filter((entry) => !entry.scheduledAt);

  return (
    <WorkspaceShell activePath="/calendar" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header"><div><p className="eyebrow">Campaign timing</p><h1>Calendar</h1><p>A chronological agenda of saved step schedules. Target times are not delivery promises: dependencies, approvals, and run state still apply.</p></div><Link className="button-secondary resource-button" href="/campaigns">Manage campaigns <ArrowUpRight size={15} /></Link></header>

        <form key={`${scope}:${campaignId}`} className={styles.filters} action="/calendar" method="get">
          <label>Show<select name="scope" defaultValue={scope}><option value="open">Open run steps</option><option value="finished">Finished run steps</option><option value="plans">Unactivated plans</option><option value="all">All steps and plans</option></select></label>
          <label>Campaign<select name="campaign" defaultValue={campaignId}><option value="">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
          <button type="submit" className="button-primary resource-button">Apply filters</button>
          <Link href="/calendar" className="button-secondary resource-button">Reset</Link>
        </form>
        <p className={styles.summary}>{selected.length} step{selected.length === 1 ? "" : "s"} shown · Times include the campaign version&apos;s timezone. Open steps without a fixed time appear below.</p>
        {entries.some((entry) => entry.origin !== "run") && scope === "open" && <p className={styles.notice}>Saved campaign plans are not queued runs. <Link href={`/calendar?scope=plans${campaignId ? `&campaign=${encodeURIComponent(campaignId)}` : ""}`}>View unactivated plans</Link>.</p>}

        {!selected.length ? <section className="resource-panel"><div className="empty-state"><span><CalendarDays size={24} /></span><h2>No steps in this view</h2><p>{entries.length ? "Try another campaign or include finished steps and unactivated plans." : "Create a campaign, define its steps, then activate a published version when it is ready. Nothing is scheduled yet."}</p><Link className="button-primary resource-button" href={entries.length ? "/calendar?scope=all" : "/campaigns"}>{entries.length ? "Show all steps and plans" : "Open Campaigns"}</Link></div></section> : <>
          {timed.length > 0 && <section className={`resource-panel ${styles.section}`}><div className="resource-panel-head"><div><h2>Exact-time targets</h2><p>Sorted from earliest to latest by absolute time.</p></div></div><ol className={styles.agenda}>{timed.map((entry) => <AgendaItem key={entry.id} entry={entry} />)}</ol></section>}
          {untimed.length > 0 && <section className={`resource-panel ${styles.section}`}><div className="resource-panel-head"><div><h2>Without a fixed time</h2><p>Dependency-based steps, relative waits, and schedules needing attention.</p></div></div><ol className={styles.agenda}>{untimed.map((entry) => <AgendaItem key={entry.id} entry={entry} />)}</ol></section>}
        </>}
      </div>
    </WorkspaceShell>
  );
}

function AgendaItem({ entry }: { entry: CampaignAgendaEntry }) {
  const isPlan = entry.origin !== "run";
  return <li className={styles.item}>
    <div className={styles.when}>{entry.scheduledAt ? <><CalendarDays size={17} /><time dateTime={entry.scheduledAt}>{formatDashboardTime(entry.scheduledAt, entry.timezone)}</time></> : <><Clock3 size={17} /><span>No fixed time</span></>}</div>
    <div className={styles.detail}>
      <Link href={entry.href} className={styles.title}>{entry.stepName} <ArrowUpRight size={14} /></Link>
      <p>{entry.campaignName} · {entry.timing}</p>
      <p>{isPlan ? <><FilePenLine size={12} /> {entry.origin === "draft" ? "Draft plan" : "Published plan"} — not activated or queued</> : `Run: ${entry.runStatus?.replaceAll("_", " ")} · step: ${entry.status.replaceAll("_", " ")}`}</p>
      {entry.warnings.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
    </div>
    <span className={`status-pill ${entry.warnings.length ? "status-amber" : entry.finished ? "status-neutral" : isPlan ? "status-violet" : "status-green"}`}>{isPlan ? "Plan only" : entry.finished ? "Finished" : "Open"}</span>
  </li>;
}
