import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getWorkspaceAnalyticsRepository } from "@/server/database";
import { formatDashboardTime } from "@/server/dashboard-data";
import { analyticsExportPath } from "@/server/workspace-analytics-export";
import { ANALYTICS_EVENT_SECTIONS, analyticsCount, analyticsDecimal, analyticsEventSection, analyticsLabel, workspaceAnalyticsPath, workspaceAnalyticsQuery } from "@/server/workspace-analytics-view";
import styles from "./analytics.module.css";

function ObservedTime({ value }: { value: string }) { return <time dateTime={value}>{formatDashboardTime(value, "UTC", "millisecond")}</time>; }

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getAuthenticatedUser(); if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login");
  let campaignId: string | undefined;
  try { campaignId = workspaceAnalyticsQuery(await searchParams, workspace.workspaceId); } catch { notFound(); }
  const data = await getWorkspaceAnalyticsRepository().getSnapshot(workspace.workspaceId, user.id, campaignId);
  if (!data || data.workspaceId !== workspace.workspaceId || (data.campaign?.id ?? undefined) !== campaignId) notFound();
  const path = workspaceAnalyticsPath(workspace.workspaceId, campaignId);
  return <WorkspaceShell activePath="/analytics" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className={`resource-page ${styles.page}`}>
      <header className="resource-header"><div><p className="eyebrow">Activity is not the same as impact</p><h1>Analytics</h1><p>Inspect what has been recorded, where it came from and what is still unknown.</p></div>
        <a href={path} className="button-secondary resource-button"><RefreshCw size={16} aria-hidden="true" />Refresh recorded data</a>
      </header>
      <aside className={styles.scope} aria-label="Reporting scope and limits">
        <div><strong>{data.campaign ? `Campaign: ${data.campaign.name}` : `Workspace: ${workspace.workspaceName}`}</strong><span className={styles.tag}>All-time recorded data</span></div>
        <p>Snapshot: <ObservedTime value={data.observedAt} />. Refresh reads saved data; it does not contact providers or start work.</p>
        <p>{data.campaign ? "Only explicitly linked or consistently run-linked events are included. Unattributed or contradictory links are excluded." : "Includes workspace events without a Campaign link. No attribution is inferred from visits, timing or destination links."}</p>
        <div className={styles.links}>{data.campaign && <Link prefetch={false} href={workspaceAnalyticsPath(workspace.workspaceId)}>All workspace data</Link>}<Link prefetch={false} href="/campaigns">Choose a Campaign from Campaigns</Link></div>
      </aside>

      <section className={styles.panel} aria-labelledby="download-heading"><h2 id="download-heading">Download this report</h2>
        <p className={styles.intro}>Each download reads a fresh snapshot in this scope, without contacting providers. It includes the same limits: up to 200 event groups and 20 recent runs, with complete headline counts and coverage flags. It is not a full-history export.</p>
        <div className={styles.links}><a href={analyticsExportPath(workspace.workspaceId, "json", campaignId)} download>Download JSON</a><a href={analyticsExportPath(workspace.workspaceId, "csv", campaignId)} download>Download CSV</a></div>
        <p className={styles.note}>Use JSON to preserve exact values and original labels. When importing CSV into a spreadsheet, set all columns to text to prevent rounding and automatic conversion. Potential formula labels are marked [text]. Files may contain user-supplied information; share them only with intended recipients.</p>
      </section>

      <section aria-labelledby="activity-heading"><h2 id="activity-heading">Recorded campaign activity</h2><p className={styles.intro}>Operational records, not conversions or delivery guarantees. A completed run is not proof of a business outcome.</p>
        <dl className={styles.totals}><div><dt>Campaign runs</dt><dd>{analyticsCount(data.totals.campaignRuns)}</dd></div><div><dt>Publication actions</dt><dd>{analyticsCount(data.totals.publicationActions)}</dd></div><div><dt>Recorded events</dt><dd>{analyticsCount(data.totals.measurementEvents)}</dd></div></dl>
        <div className={styles.columns}><article className={styles.panel}><h3>Run states</h3>{data.runStatuses.length ? <dl className={styles.statuses}>{data.runStatuses.map(row => <div key={row.status}><dt>{analyticsLabel(row.status)}</dt><dd>{analyticsCount(row.count)}</dd></div>)}</dl> : <p>No Campaign runs recorded in this scope.</p>}</article>
          <article className={styles.panel}><h3>Publication states</h3>{data.publicationStatuses.length ? <dl className={styles.statuses}>{data.publicationStatuses.map(row => <div key={`${row.provider}:${row.status}`}><dt>{analyticsLabel(row.provider)} · {analyticsLabel(row.status)}</dt><dd>{analyticsCount(row.count)}</dd></div>)}</dl> : <p>No publication actions recorded in this scope.</p>}</article></div>
      </section>

      <section aria-labelledby="events-heading"><h2 id="events-heading">Event observations</h2><p className={styles.intro}>Grouped by event type, collector source and currency. Counts include repeated events; values use their original recorded units. A missing value is not zero. Source labels are collector-supplied, not independently verified.</p>
        <p className={styles.coverage}>{analyticsCount(data.measurements.groupCount)} group{data.measurements.groupCount === "1" ? "" : "s"} recorded. Showing {data.measurements.items.length}{data.measurements.hasMore ? " selected in event/source/currency order; more groups are not shown. Headline counts still include every event. Select a Campaign to narrow the scope." : "; all groups in this scope are shown."}</p>
        {data.measurements.items.length === 0 ? <div className={styles.empty}><h3>No event observations yet</h3><p>Not measured here does not mean no real-world activity. Existing tracking or an authorized event collector must record observations before they can appear.</p></div> : ANALYTICS_EVENT_SECTIONS.map(section => {
          const items = data.measurements.items.filter(item => analyticsEventSection(item.eventType) === section.key);
          return items.length > 0 && <section className={styles.eventSection} key={section.key} aria-labelledby={`events-${section.key}`}><h3 id={`events-${section.key}`}>{section.title}</h3><p>{section.description}</p>
            <div className={styles.cards}>{items.map(item => <article className={styles.panel} key={JSON.stringify([item.eventType, item.source, item.currency])}>
              <h4>{analyticsLabel(item.eventType)}</h4><p className={styles.source}>Source: <span>{item.source}</span></p>
              <dl className={styles.facts}><div><dt>Recorded events</dt><dd>{analyticsCount(item.eventCount)}</dd></div><div><dt>Events with a value</dt><dd>{analyticsCount(item.valueCount)}</dd></div>
                <div><dt>{item.currency ? `Recorded value (${item.currency})` : "Recorded value (no currency specified)"}</dt><dd>{item.valueTotal === null ? "No value recorded" : analyticsDecimal(item.valueTotal)}</dd></div></dl>
              <p className={styles.note}>{item.currency ? "Currencies are not converted or combined. This is a recorded amount, not verified revenue or a financial ledger." : "No monetary or physical unit is inferred from an unlabeled value."}</p>
              <details><summary>Recorded event time range</summary><p>First: <ObservedTime value={item.firstOccurredAt} /></p><p>Last: <ObservedTime value={item.lastOccurredAt} /></p></details>
            </article>)}</div></section>;
        })}
      </section>

      <section aria-labelledby="providers-heading"><h2 id="providers-heading">Provider-reported lifetime totals</h2><p className={styles.intro}>Mailchimp and Mastodon reports already collected for recorded publications. Only the latest correction-aware totals are summed; historical report snapshots are not added together. These are separate from event observations above.</p>
        <p className={styles.note}>Each metric covers its listed number of publications only. “Unique” is the provider’s per-publication definition, not unique people across this workspace. Observation times show when reports were collected, not when interactions happened or whether totals are current now.</p>
        {data.providerMetrics.length === 0 ? <div className={styles.empty}><h3>No provider totals observed</h3><p>Provider coverage and freshness are unknown until reports are collected. Missing observations are not zero engagement.</p></div> : <div className={styles.cards}>{data.providerMetrics.map(item => <article className={styles.panel} key={`${item.provider}:${item.metricType}`}>
          <p className="eyebrow">{analyticsLabel(item.provider)}</p><h3>{analyticsLabel(item.metricType)}</h3><p className={styles.metric}>{analyticsCount(item.metricTotal)}</p><p>Across {analyticsCount(item.publicationCount)} publication{item.publicationCount === "1" ? "" : "s"} with this metric recorded.</p>
          <details><summary>Report observation range</summary><p>Earliest current observation: <ObservedTime value={item.firstObservedAt} /></p><p>Latest current observation: <ObservedTime value={item.lastObservedAt} /></p></details>
        </article>)}</div>}
      </section>

      <section aria-labelledby="runs-heading"><h2 id="runs-heading">Recent recorded runs</h2><p className={styles.intro}>Showing {data.recentRuns.items.length}{data.recentRuns.hasMore ? " most recently created runs; older runs are not listed." : ` run${data.recentRuns.items.length === 1 ? "" : "s"}; all runs in this scope are shown.`} Names are current Campaign labels; each run retains its exact plan version.</p>
        {data.recentRuns.items.length === 0 ? <p>No recorded runs to inspect.</p> : <ol className={styles.runs}>{data.recentRuns.items.map(run => <li key={run.id}><div><h3>{run.campaignName}</h3><p>{analyticsLabel(run.status)} · <ObservedTime value={run.createdAt} /></p></div><div className={styles.links}><Link prefetch={false} href={`/campaign-instances/${run.id}`}>Inspect run</Link>{!data.campaign && <Link prefetch={false} href={workspaceAnalyticsPath(workspace.workspaceId, run.campaignId)}>This Campaign’s analytics</Link>}</div></li>)}</ol>}
      </section>
      <aside className={styles.limits}><h2>What this view does not claim</h2><p>No inferred attribution, conversion rates, ROI, cross-source unique people, experiments or automatic recommendations. Counts and recorded amounts alone cannot establish causation, data completeness or business success. No personal event details, provider payloads or credentials are displayed.</p></aside>
    </div>
  </WorkspaceShell>;
}
