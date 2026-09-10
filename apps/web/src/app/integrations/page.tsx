import { getActiveWorkspace } from "@/server/active-workspace";
import { redirect } from "next/navigation";
import { ConnectorCard } from "@/components/connector-card";
import { ChannelConnectionForm } from "@/components/channel-connection-form";
import { MeasurementKeyForm } from "@/components/measurement-key-form";
import { MailchimpWebhookConfig } from "@/components/mailchimp-webhook-config";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getConnectorStatuses } from "@/server/connectors";
import {
  getCampaignRepository,
  getPublishingRepository,
  getRepository,
} from "@/server/database";
import { getServerConfiguration } from "@/server/config";

export default async function IntegrationsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const connections = await repository.listStorageConnections(
    workspace.workspaceId,
  );
  const manifests = getConnectorStatuses();
  const webhooksConfigured = Boolean(
    getServerConfiguration().publicWebhookBaseUrl,
  );
  const publicWebhookBaseUrl = getServerConfiguration().publicWebhookBaseUrl?.replace(/\/$/u, "");
  const publishingRepository = getPublishingRepository();
  const [channelConnections, measurementKeys, webhookHealthStates, mastodonCollectionOperations, mastodonCollectionAlerts] = await Promise.all([
    publishingRepository.listChannelConnections(workspace.workspaceId),
    publishingRepository.listMeasurementKeys(workspace.workspaceId),
    publishingRepository.listMailchimpWebhookHealthStates(workspace.workspaceId),
    publishingRepository.getMastodonStatusReportCollectionOperationsSummary(workspace.workspaceId),
    publishingRepository.listMastodonStatusReportCollectionAlerts(workspace.workspaceId),
  ]);
  const webhookHealthByConnection = new Map(webhookHealthStates.map((state) => [state.connectionId, state]));
  const campaigns = await getCampaignRepository().listCampaigns(
    workspace.workspaceId,
  );
  return (
    <WorkspaceShell
      activePath="/integrations"
      workspaceName={workspace.workspaceName}
      userName={user.displayName}
    >
      <div className="resource-page">
        <header className="resource-header">
          <div>
            <p className="eyebrow">Storage access</p>
            <h1>Integrations</h1>
            <p>
              Provider access uses delegated OAuth, least-privilege scopes, and
              encrypted tokens.
            </p>
          </div>
        </header>
        <div className="connector-grid">
          {manifests.map((manifest) => (
            <ConnectorCard
              key={manifest.provider}
              manifest={manifest}
              workspaceId={workspace.workspaceId}
              webhooksConfigured={webhooksConfigured}
              connected={connections.some(
                (connection) =>
                  connection.provider === manifest.provider &&
                  connection.status === "active",
              )}
            />
          ))}
        </div>
        <section className="form-section">
          <div>
            <h2>Publishing channels</h2>
            <p>
              Capabilities are discovered per action. Discord and Slack provide
              governed community publishing, Mastodon provides an owned social
              account, and Mailchimp provides owned email.
            </p>
          </div>
          <div className="field-grid">
            <div className="field-wide">
              {mastodonCollectionOperations.total > 0 ? (
                <div className="list-card">
                  <div>
                    <strong>Mastodon collector operations</strong>
                    <p>
                      {mastodonCollectionOperations.total} total · {mastodonCollectionOperations.scheduled} scheduled · {mastodonCollectionOperations.pending} pending · {mastodonCollectionOperations.collecting} collecting · {mastodonCollectionOperations.retrying} retrying · {mastodonCollectionOperations.overdue} overdue · {mastodonCollectionOperations.abandoned} abandoned
                    </p>
                    {mastodonCollectionOperations.oldestOverdueAt ? <small>Oldest overdue: {new Date(mastodonCollectionOperations.oldestOverdueAt).toLocaleString()}</small> : null}
                    {mastodonCollectionOperations.oldestAbandonedClaimAt ? <small>Oldest abandoned claim: {new Date(mastodonCollectionOperations.oldestAbandonedClaimAt).toLocaleString()}</small> : null}
                  </div>
                  <span className={`status-pill ${mastodonCollectionOperations.overdue + mastodonCollectionOperations.abandoned > 0 ? "status-red" : "status-green"}`}>
                    {mastodonCollectionOperations.overdue + mastodonCollectionOperations.abandoned > 0 ? "attention" : "no backlog"}
                  </span>
                </div>
              ) : null}
              {mastodonCollectionAlerts.length ? (
                <div className="list-card">
                  <div>
                    <strong>Mastodon collector alert history</strong>
                    <p>Observed by the enabled collector for eligible recent publications. This history does not detect a stopped worker or deliver external notifications.</p>
                    {mastodonCollectionAlerts.map((alert) => (
                      <p key={alert.id}>
                        {alert.status} · {alert.alertType} · {alert.affectedCount} affected · oldest {new Date(alert.oldestAt).toLocaleString()}
                        <br />
                        <small>First detected {new Date(alert.firstDetectedAt).toLocaleString()} · last detected {new Date(alert.lastDetectedAt).toLocaleString()}{alert.resolvedAt ? ` · resolved ${new Date(alert.resolvedAt).toLocaleString()}` : ""}</small>
                      </p>
                    ))}
                  </div>
                  <span className={`status-pill ${mastodonCollectionAlerts.some((alert) => alert.status === "active") ? "status-red" : "status-green"}`}>
                    {mastodonCollectionAlerts.some((alert) => alert.status === "active") ? "active" : "resolved"}
                  </span>
                </div>
              ) : null}
              {channelConnections.length ? (
                channelConnections.map((connection) => (
                  <div className="list-card" key={connection.id}>
                    <div>
                      <strong>{connection.name}</strong>
                      <p>{connection.provider === "discord_webhook"
                        ? "Discord webhook · text and reviewed image publishing"
                        : connection.provider === "slack_webhook"
                          ? "Slack webhook · text publishing up to 4,000 characters"
                          : connection.provider === "mastodon_account"
                            ? `Mastodon account · public text and up to ${String(connection.configuration.attachmentsPerMessage ?? 0)} reviewed images per status`
                          : "Mailchimp audience · approved email and aggregate reports"} · {connection.status}</p>
                      <code>{connection.id}</code>
                    </div>
                    <span className={`status status-${connection.status}`}>
                      {connection.status}
                    </span>
                    {connection.provider === "mailchimp_email" && publicWebhookBaseUrl ? <MailchimpWebhookConfig
                      workspaceId={workspace.workspaceId} connectionId={connection.id}
                      callbackUrl={`${publicWebhookBaseUrl}/api/webhooks/mailchimp/${connection.id}`}
                      configured={connection.configuration.webhookSigningConfigured === true}
                      management={typeof connection.configuration.webhookManagement === "string" ? connection.configuration.webhookManagement : undefined}
                      monitoredHealth={webhookHealthByConnection.get(connection.id)?.lastHealthCode}
                      lastCheckedAt={webhookHealthByConnection.get(connection.id)?.lastCheckedAt
                        ? new Date(webhookHealthByConnection.get(connection.id)!.lastCheckedAt!).toISOString() : undefined}
                      consecutiveFailures={webhookHealthByConnection.get(connection.id)?.consecutiveFailureCount}
                      lastMonitorError={webhookHealthByConnection.get(connection.id)?.lastErrorCode}
                    /> : null}
                  </div>
                ))
              ) : (
                <p>No publishing channels configured.</p>
              )}
            </div>
            <ChannelConnectionForm workspaceId={workspace.workspaceId} />
          </div>
        </section>
        <section className="form-section">
          <div>
            <h2>Measurement ingestion</h2>
            <p>
              Use scoped bearer keys for server-to-server conversions;
              tracked-link visits need no cookie or personal identifier.
            </p>
          </div>
          <div className="field-grid">
            <MeasurementKeyForm
              workspaceId={workspace.workspaceId}
              keys={measurementKeys}
              campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
            />
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
