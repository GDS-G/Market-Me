import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MessageSquareText, ShieldBan } from "lucide-react";
import { ConversationActions } from "@/components/conversation-actions";
import { ConversationAssistant } from "@/components/conversation-assistant";
import { ConversationHandoffPanel } from "@/components/conversation-handoff-panel";
import { ConversationReadControl } from "@/components/conversation-read-control";
import { ConversationResponseComposer } from "@/components/conversation-response-composer";
import { ConversationRetentionClassControl } from "@/components/conversation-retention-class";
import { ConversationReviewRequests } from "@/components/conversation-review-requests";
import { ConversationSharedResources } from "@/components/conversation-shared-resources";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import {
  getCampaignRepository,
  getConversationAssistantRepository,
  getConversationComposerRepository,
  getConversationRepository,
  getRepository,
} from "@/server/database";

export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const repository = getRepository();
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const threadId = (await params).id;
  const [thread, members, campaigns, destinations, contextDirectory, responseSuggestions, composerState, legalHolds, legalHoldReleaseRequests] =
    await Promise.all([
      getConversationRepository().getThread(
        workspace.workspaceId,
        threadId,
        user.id,
      ),
      repository.listWorkspaceMembers(workspace.workspaceId),
      getCampaignRepository().listCampaigns(workspace.workspaceId),
      getCampaignRepository().listDestinations(workspace.workspaceId),
      getConversationRepository().listContextDirectory(workspace.workspaceId),
      getConversationAssistantRepository().listSuggestions(
        workspace.workspaceId,
        threadId,
      ),
      getConversationComposerRepository().getState(
        workspace.workspaceId,
        threadId,
      ),
      getConversationRepository().listLegalHoldCases(workspace.workspaceId, threadId),
      getConversationRepository().listLegalHoldReleaseRequests(workspace.workspaceId, threadId),
    ]);
  if (!thread) notFound();

  return (
    <WorkspaceShell
      activePath="/conversations"
      userName={user.displayName}
      workspaceName={workspace.workspaceName}
    >
      <div className="resource-page conversation-detail">
        <Link className="back-link" href="/conversations">
          <ArrowLeft size={14} /> Conversations
        </Link>
        <header className="resource-header">
          <div>
            <p className="eyebrow">
              {thread.relationshipDisplayName} · {thread.provider}
            </p>
            <h1>{thread.subject}</h1>
            <p>
              {thread.messageCount} recorded message
              {thread.messageCount === 1 ? "" : "s"} · {label(thread.status)}
            </p>
            <p>
              Relationship: {label(thread.relationshipStage)} {" · "}
              {thread.priorThreadCount} prior conversation
              {thread.priorThreadCount === 1 ? "" : "s"} {" · "}
              {thread.priorMessageCount} prior message
              {thread.priorMessageCount === 1 ? "" : "s"}
              {thread.lastPriorInteractionAt
                ? ` · Last prior interaction ${formatDate(thread.lastPriorInteractionAt)}`
                : ""}
            </p>
            {thread.routingSuggestion && (
              <p className="conversation-routing-suggestion">
                Suggested route: {thread.routingSuggestion.ruleName} →{" "}
                {label(thread.routingSuggestion.targetStatus)}
                {thread.routingSuggestion.targetOwnerDisplayName
                  ? ` to ${thread.routingSuggestion.targetOwnerDisplayName}`
                  : ""}{" "}
                {" · Matches "}
                {thread.routingSuggestion.matchedOn.map(label).join(", ")}.
                Review and use the controls below to apply it.
              </p>
            )}
            {(thread.brandProfileName ||
              thread.campaignName ||
              thread.destinationTitle) && (
              <p>
                Context: {thread.brandProfileName ?? ""}
                {thread.brandProfileStatus
                  ? ` (${label(thread.brandProfileStatus)})`
                  : ""}
                {thread.brandProfileName &&
                (thread.campaignName || thread.destinationTitle)
                  ? " · "
                  : ""}
                {thread.campaignName ?? ""}
                {thread.campaignName && thread.destinationTitle ? " · " : ""}
                {thread.destinationTitle ?? ""}
              </p>
            )}
            {(thread.channelConnectionName || thread.publicationActionId) && (
              <p>
                Account: {thread.channelConnectionName ?? "None"}
                {thread.channelProvider
                  ? ` (${label(thread.channelProvider)})`
                  : ""}
                {thread.publicationActionId ? " · Publication: " : ""}
                {thread.publicationActionId
                  ? (thread.publicationExternalId ??
                    thread.publicationActionId.slice(0, 8))
                  : ""}
                {thread.publicationStatus
                  ? ` (${label(thread.publicationStatus)})`
                  : ""}
              </p>
            )}
            {thread.serviceLevel && (
              <p className={`conversation-service-level service-${thread.serviceLevel.state}`}>
                Service level: {label(thread.serviceLevel.state)} · due {formatDate(thread.serviceLevel.dueAt)}
                {thread.serviceLevel.source === "manual" ? " · manual deadline" : " · workspace policy"}
              </p>
            )}
          </div>
          <ConversationReadControl
            threadId={thread.id}
            unreadCount={thread.unreadCount}
            workspaceId={workspace.workspaceId}
          />
        </header>

        {thread.contactPermission === "suppressed" && (
          <aside className="contact-safety-banner" role="status">
            <ShieldBan size={18} />
            <div>
              <strong>Do not contact</strong>
              <p>
                History and internal notes remain available. Any future outbound
                adapter must block delivery.
              </p>
            </div>
          </aside>
        )}

        <div className="conversation-detail-grid">
          <section className="resource-panel conversation-history">
            <div className="resource-panel-head">
              <div>
                <h2>Message history</h2>
                <p>Chronological, provider-neutral records</p>
              </div>
            </div>
            {thread.messages.length === 0 ? (
              <div className="empty-state conversation-empty">
                <span>
                  <MessageSquareText size={22} />
                </span>
                <h3>No messages recorded</h3>
                <p>
                  Add an internal note or wait for a future connector to ingest
                  provider history.
                </p>
              </div>
            ) : (
              <div className="message-list">
                {thread.messages.map((message) => (
                  <article
                    className={`message-card message-${message.kind}`}
                    key={message.id}
                  >
                    <div>
                      <span className="status-pill">{label(message.kind)}</span>
                      <time dateTime={message.occurredAt}>
                        {formatDate(message.occurredAt)}
                      </time>
                    </div>
                    <p>{message.body}</p>
                    <small>
                      {message.authorDisplay ||
                        (message.kind === "internal_note"
                          ? user.displayName
                          : thread.provider)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </section>
          <ConversationActions
            brands={contextDirectory.brands}
            campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
            channels={contextDirectory.channels}
            currentUserId={user.id}
            destinations={destinations.map(({ id, title }) => ({ id, title }))}
            members={members}
            publications={contextDirectory.publications}
            thread={thread}
            workspaceId={workspace.workspaceId}
          />
        </div>
        <ConversationSharedResources
          destinations={destinations.map(({ id, title }) => ({ id, title }))}
          historyCount={thread.sharedResourceHistoryCount}
          publications={contextDirectory.publications}
          resources={thread.recentSharedResources}
          threadId={thread.id}
          workspaceId={workspace.workspaceId}
        />
        <ConversationRetentionClassControl
          currentUserId={user.id}
          legalHolds={legalHolds}
          releaseRequests={legalHoldReleaseRequests}
          threadId={thread.id}
          updatedAt={thread.retentionClassUpdatedAt}
          value={thread.retentionClass}
          workspaceId={workspace.workspaceId}
          workspaceRole={workspace.role}
        />
        <ConversationAssistant
          suggestions={responseSuggestions}
          threadId={thread.id}
          workspaceId={workspace.workspaceId}
        />
        <ConversationResponseComposer
          currentUserId={user.id}
          sourceSuggestion={responseSuggestions.find(
            (suggestion) => suggestion.status === "active",
          )}
          state={composerState}
          threadId={thread.id}
          workspaceId={workspace.workspaceId}
        />
        <ConversationReviewRequests
          currentUserId={user.id}
          members={members}
          thread={thread}
          workspaceId={workspace.workspaceId}
        />
        <ConversationHandoffPanel
          thread={thread}
          workspaceId={workspace.workspaceId}
        />
      </div>
    </WorkspaceShell>
  );
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
