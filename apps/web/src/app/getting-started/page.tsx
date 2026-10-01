import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Compass, RefreshCw } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getWorkspaceStartRepository } from "@/server/database";
import { formatDashboardTime } from "@/server/dashboard-data";
import { buildWorkspaceStartGuide } from "@/server/workspace-start-guide";
import styles from "./start-guide.module.css";

const supportingTools = Object.freeze([
  { title: "Supporting context", href: "/context-packs", description: "Add reviewed background documents and facts when incoming content needs more explanation." },
  { title: "Brand and audience", href: "/audience", description: "Use published profiles to shape voice and audience variants without changing the approved facts." },
  { title: "Destination links", href: "/destinations", description: "Choose where a call to action should lead. A saved link is not a connected publishing account." },
  { title: "Preparation presets", href: "/campaigns/presets", description: "Reuse reviewed settings by explicitly copying their values. Copying does not approve content or start work." },
]);
const signalLabels = Object.freeze({ empty: "No saved activity", saved: "Saved activity", attention: "Inspect current state" });

export default async function GettingStartedPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  if (Object.keys(await searchParams).length) notFound();
  const snapshot = await getWorkspaceStartRepository().getSnapshot(workspace.workspaceId, user.id);
  if (!snapshot || snapshot.workspaceId !== workspace.workspaceId) notFound();
  const guide = buildWorkspaceStartGuide(snapshot);

  return <WorkspaceShell activePath="/getting-started" workspaceName={workspace.workspaceName} userName={user.displayName}>
    <div className={`resource-page ${styles.page}`}>
      <header className="resource-header">
        <div><p className="eyebrow">Your content-to-campaign guide</p><h1>Start here</h1><p>A clear next step for {workspace.workspaceName}, whether you are starting fresh or returning to saved work.</p></div>
        <a className="button-secondary resource-button" href="/getting-started"><RefreshCw size={16} aria-hidden="true" />Refresh saved state</a>
      </header>

      <section className={styles.next} aria-labelledby="next-step-heading">
        <div className={styles.nextIcon}><Compass size={24} aria-hidden="true" /></div>
        <div className={styles.nextBody}><p className="eyebrow">Suggested next step</p><h2 id="next-step-heading">{guide.recommendation.title}</h2>
          <p>{guide.recommendation.reason}</p>
          <Link className="button-primary resource-button" prefetch={false} href={guide.recommendation.href}>{guide.recommendation.label}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>

      <aside className={styles.role} aria-label="Your current role and saved-state limits">
        <p><strong>Your current workspace role: {snapshot.role}.</strong> {guide.roleSummary} <Link prefetch={false} href="/team">View team roles</Link></p>
        <p>Saved-state snapshot: <time dateTime={snapshot.observedAt}>{formatDashboardTime(snapshot.observedAt, "UTC", "millisecond")}</time>. Refresh to update it.</p>
        <p>These totals may describe unrelated items, not one completed journey. They do not prove health, current eligibility or delivery. Opening this guide does not configure, approve, activate or send anything.</p>
      </aside>

      <section aria-labelledby="workflow-heading">
        <div className={styles.sectionHeader}><h2 id="workflow-heading">From a folder to reviewed work</h2><p>Follow the relevant stage. Each action opens an existing tool; consequential changes require their own review.</p></div>
        <ol className={styles.stages} role="list">
          {guide.stages.map((stage, index) => <li className={styles.stage} role="listitem" key={stage.key} id={`guide-${stage.key}`}>
            <span className={styles.number} aria-hidden="true">{index + 1}</span>
            <div className={styles.stageBody}>
              <div className={styles.stageHeading}><h3>{stage.title}</h3><span className={stage.signal === "attention" ? styles.attention : styles.saved}>{signalLabels[stage.signal]}</span></div>
              <p>{stage.description}</p>
              <p className={styles.evidence}>{stage.evidence}</p>
              <p className={styles.boundary}>{stage.boundary}</p>
              {stage.handoff && <p className={styles.handoff}>{stage.handoff}</p>}
              <Link className={styles.stageLink} prefetch={false} href={stage.action.href}>{stage.action.label}<ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
          </li>)}
        </ol>
      </section>

      <details className={styles.supporting}>
        <summary>Optional supporting choices</summary>
        <p>Use these when they improve the content you are preparing. They are not mandatory completion boxes, and your role still controls changes.</p>
        <div className={styles.tools}>{supportingTools.map(tool => <article key={tool.href}><h3><Link prefetch={false} href={tool.href}>{tool.title}</Link></h3><p>{tool.description}</p></article>)}</div>
      </details>
      {guide.canWrite && <p className={styles.advanced}>Already know your workflow? <Link prefetch={false} href="/campaigns/new">Open the advanced campaign editor</Link>. It is separate from the review-first preparation path.</p>}
    </div>
  </WorkspaceShell>;
}
