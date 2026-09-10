import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  ExternalLink,
  GitBranch,
  Target,
} from "lucide-react";
import { CampaignInstanceActions } from "@/components/campaign-instance-actions";
import { MailchimpReportSync } from "@/components/mailchimp-report-sync";
import { MastodonReportSync } from "@/components/mastodon-report-sync";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import {
  getCampaignRepository,
  getPublishingRepository,
} from "@/server/database";

export default async function CampaignInstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const canWrite = ["owner", "admin", "editor"].includes(workspace.role);
  const id = (await params).id;
  const [item, summary, publications, mailchimpReports, mastodonReports, mailchimpCollectionStates, mastodonCollectionStates] = await Promise.all([
    getCampaignRepository().getCampaignInstance(workspace.workspaceId, id),
    getPublishingRepository().getCampaignMeasurementSummary(
      workspace.workspaceId,
      id,
    ),
    getPublishingRepository().listPublicationActions(workspace.workspaceId, id),
    getPublishingRepository().listMailchimpCampaignReportSnapshots(workspace.workspaceId, id),
    getPublishingRepository().listMastodonStatusReportSnapshots(workspace.workspaceId, id),
    getPublishingRepository().listMailchimpReportCollectionStates(workspace.workspaceId, id),
    getPublishingRepository().listMastodonStatusReportCollectionStates(workspace.workspaceId, id),
  ]);
  if (!item) notFound();
  return (
    <WorkspaceShell
      activePath="/campaigns"
      workspaceName={workspace.workspaceName}
      userName={user.displayName}
    >
      <div className="resource-page form-page">
        <Link className="back-link" href="/campaigns">
          <ArrowLeft size={14} />
          Campaigns
        </Link>
        <header className="resource-header">
          <div>
            <p className="eyebrow">Durable instance</p>
            <h1>Campaign run</h1>
            <p>{item.temporalWorkflowId ?? "Waiting for workflow dispatch"}</p>
          </div>
          <span
            className={`status-pill ${item.status === "active" ? "status-green" : "status-neutral"}`}
          >
            {item.status}
          </span>
        </header>
        <section className="review-section">
          <div className="resource-panel-head">
            <div>
              <h2>Workflow steps</h2>
              <p>
                Every activity has one stable idempotency key and append-only
                attempt history.
              </p>
            </div>
          </div>
          {item.stepRuns.map((run) => (
            <article className="review-row" key={run.id}>
              <GitBranch size={18} />
              <div>
                <strong>{run.stepName ?? run.stepKey}</strong>
                <p>{run.idempotencyKey}</p>
                {run.lastError && <small>{run.lastError}</small>}
              </div>
              <span className="status-pill status-neutral">
                {run.status.replaceAll("_", " ")}
              </span>
            </article>
          ))}
        </section>
        <section className="review-section">
          <div className="resource-panel-head">
            <div>
              <h2>Published items</h2>
              <p>
                Provider results are distinct from workflow state so ambiguous
                deliveries remain visible.
              </p>
            </div>
          </div>
          {publications.length ? (
            publications.map((action) => {
              const report = mailchimpReports.find((snapshot) => snapshot.publicationActionId === action.id);
              const mastodonReport = mastodonReports.find((snapshot) => snapshot.publicationActionId === action.id);
              const collection = mailchimpCollectionStates.find((state) => state.publicationActionId === action.id);
              const mastodonCollection = mastodonCollectionStates.find((state) => state.publicationActionId === action.id);
              return (
              <article className="review-row" key={action.id}>
                <ExternalLink size={18} />
                <div>
                  <strong>{action.actionType.replaceAll("_", " ")}</strong>
                  <p>
                    {action.providerExternalId ??
                      action.lastError ??
                      "Awaiting provider confirmation"}
                  </p>
                  {action.providerUrl && (
                    <a
                      href={action.providerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open published item
                    </a>
                  )}
                  {report ? (
                    <p>
                      Mailchimp report: {report.emailsSent} sent · {report.uniqueOpens} unique opens · {report.uniqueClicks} unique clicks · {report.hardBounces + report.softBounces} bounces · {report.unsubscribed} unsubscribes · {report.abuseReports} complaints
                    </p>
                  ) : null}
                  {mastodonReport ? (
                    <p>
                      Mastodon aggregates: {mastodonReport.repliesCount} replies · {mastodonReport.reblogsCount} boosts · {mastodonReport.favouritesCount} favourites · observed {new Date(mastodonReport.observedAt).toLocaleString()}
                    </p>
                  ) : null}
                  {mastodonCollection ? (
                    <p>
                      Mastodon collector: {mastodonCollection.operationalStatus} · next {new Date(mastodonCollection.nextAttemptAt).toLocaleString()}
                      {mastodonCollection.lastSuccessAt ? ` · last success ${new Date(mastodonCollection.lastSuccessAt).toLocaleString()}` : ""}
                      {mastodonCollection.lastErrorCode ? ` · last result ${mastodonCollection.lastErrorCode.replaceAll("_", " ")}` : ""}
                    </p>
                  ) : null}
                  {collection ? (
                    <p>
                      Report schedule: next {new Date(collection.nextAttemptAt).toLocaleString()}
                      {collection.lastSuccessAt ? ` · last success ${new Date(collection.lastSuccessAt).toLocaleString()}` : ""}
                      {collection.lastErrorCode ? ` · last result ${collection.lastErrorCode.replaceAll("_", " ")}` : ""}
                      {collection.lastWebhookReceivedAt ? ` · webhook wakeups ${collection.webhookWakeupCount}, last ${new Date(collection.lastWebhookReceivedAt).toLocaleString()}` : ""}
                    </p>
                  ) : null}
                  {canWrite && action.provider === "mailchimp_email" && action.providerExternalId ? (
                    <MailchimpReportSync workspaceId={workspace.workspaceId} publicationActionId={action.id} />
                  ) : null}
                  {canWrite && action.provider === "mastodon_account" && action.status === "succeeded" && action.providerExternalId ? (
                    <MastodonReportSync workspaceId={workspace.workspaceId} publicationActionId={action.id} />
                  ) : null}
                </div>
                <span className="status-pill status-neutral">
                  {action.status}
                </span>
              </article>
              );
            })
          ) : (
            <p>No automated publication actions yet.</p>
          )}
        </section>
        <section className="review-section">
          <div className="resource-panel-head">
            <div>
              <h2>Measured outcomes</h2>
              <p>
                Activity metrics and business results remain separate normalized
                event types.
              </p>
            </div>
          </div>
          {Object.keys(summary.totals).length ? (
            Object.entries(summary.totals).map(([type, total]) => (
              <article className="review-row" key={type}>
                <BarChart3 size={18} />
                <div>
                  <strong>{type.replaceAll("_", " ")}</strong>
                  <p>
                    {summary.providerTotals[type] !== undefined
                      ? `${total.count} provider aggregate total`
                      : `${total.count} event${total.count === 1 ? "" : "s"}`}
                    {total.value ? ` · untyped value ${total.value}` : ""}
                    {Object.entries(summary.currencyTotals[type] ?? {}).map(
                      ([currency, value]) => ` · ${currency} ${value}`,
                    )}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <p>No measurement events or provider aggregates received.</p>
          )}
        </section>
        <section className="review-section">
          <div className="resource-panel-head">
            <div>
              <h2>Success criteria</h2>
              <p>
                {summary.criteria.length
                  ? summary.allCriteriaMet
                    ? summary.successTransition
                      ? `Every versioned Campaign goal is met. Workflow notification is ${summary.successTransition.status.replaceAll("_", " ")}.`
                      : "Every versioned Campaign goal is met. No durable workflow notification was recorded for this historical result."
                    : summary.successTransition
                      ? "Current totals are below one or more criteria; an earlier immutable workflow notification remains recorded."
                      : "Progress is evaluated from normalized events and explicit provider aggregates for this exact Campaign run."
                  : "This Campaign version has no success criteria."}
              </p>
            </div>
          </div>
          {summary.criteria.map((criterion) => (
            <article className="review-row" key={criterion.id}>
              <Target size={18} />
              <div>
                <strong>{criterion.eventType.replaceAll("_", " ")}</strong>
                {criterion.metric === "value" ? (
                  <p>
                    {criterion.currentValue} of {criterion.targetValue}{" "}
                    {criterion.currency} · criterion {criterion.id}
                  </p>
                ) : (
                  <p>
                    {criterion.currentCount} of {criterion.targetCount}{" "}
                    {summary.providerTotals[criterion.eventType] !== undefined
                      ? "provider aggregate"
                      : "events"}{" "}·
                    criterion {criterion.id}
                  </p>
                )}
              </div>
              <span
                className={`status-pill ${criterion.met ? "status-green" : "status-neutral"}`}
              >
                {criterion.met ? "met" : "in progress"}
              </span>
            </article>
          ))}
          {summary.successTransition ? (
            <article className="review-row">
              <GitBranch size={18} />
              <div>
                <strong>Success threshold workflow signal</strong>
                <p>
                  Queued{" "}
                  {new Date(
                    summary.successTransition.queuedAt,
                  ).toLocaleString()}
                  {summary.successTransition.deliveredAt
                    ? ` ・ delivered ${new Date(summary.successTransition.deliveredAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <span
                className={`status-pill ${
                  summary.successTransition.status === "completed"
                    ? "status-green"
                    : summary.successTransition.status === "failed" ||
                        summary.successTransition.status === "dead_letter"
                      ? "status-red"
                      : "status-neutral"
                }`}
              >
                {summary.successTransition.status.replaceAll("_", " ")}
              </span>
            </article>
          ) : null}
        </section>
        <CampaignInstanceActions
          workspaceId={workspace.workspaceId}
          instance={item}
        />
      </div>
    </WorkspaceShell>
  );
}
