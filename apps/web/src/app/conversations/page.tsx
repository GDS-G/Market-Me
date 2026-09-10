import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  MessageSquareText,
  Plus,
  Settings2,
  ShieldBan,
  UserRound,
} from "lucide-react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ConversationRoutingRules } from "@/components/conversation-routing-rules";
import { ConversationAttentionQueue } from "@/components/conversation-attention-queue";
import { ConversationServiceLevelPolicy } from "@/components/conversation-service-level-policy";
import { ConversationRetentionPolicy } from "@/components/conversation-retention-policy";
import { RelationshipIdentityCandidates } from "@/components/relationship-identity-candidates";
import {
  CONVERSATION_INTENTS,
  CONVERSATION_SENTIMENTS,
  CONVERSATION_STATUSES,
  CONVERSATION_URGENCIES,
} from "@market-me/domain";
import { getAuthenticatedUser } from "@/server/auth";
import { conversationThreadQuerySchema } from "@/server/conversation-schema";
import {
  getCampaignRepository,
  getConversationRepository,
  getRelationshipRepository,
  getRepository,
} from "@/server/database";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const canOperateLegalHolds = ["owner", "admin", "editor", "approver"].includes(
    workspace.role,
  );
  const [
    relationships,
    members,
    campaigns,
    destinations,
    contextDirectory,
    routingRules,
    serviceLevelPolicy,
    identitySuggestions,
    attentionItems,
    retentionPolicy,
    retentionCandidates,
    retentionErasureRequests,
    activeLegalHolds,
    legalHoldReleaseRequests,
    recentLegalHoldReleaseDecisions,
  ] = await Promise.all([
    getRelationshipRepository().listRelationships(workspace.workspaceId),
    getRepository().listWorkspaceMembers(workspace.workspaceId),
    getCampaignRepository().listCampaigns(workspace.workspaceId),
    getCampaignRepository().listDestinations(workspace.workspaceId),
    getConversationRepository().listContextDirectory(workspace.workspaceId),
    getConversationRepository().listRoutingRules(workspace.workspaceId),
    getConversationRepository().getServiceLevelPolicy(workspace.workspaceId),
    getRelationshipRepository().listIdentitySuggestions(workspace.workspaceId),
    getConversationRepository().listAttentionItems(workspace.workspaceId),
    getConversationRepository().getRetentionPolicy(workspace.workspaceId),
    getConversationRepository().listRetentionCandidates(workspace.workspaceId),
    getConversationRepository().listRetentionErasureRequests(workspace.workspaceId),
    canOperateLegalHolds
      ? getConversationRepository().listActiveLegalHolds(workspace.workspaceId)
      : Promise.resolve([]),
    canOperateLegalHolds
      ? getConversationRepository().listPendingLegalHoldReleaseRequests(
          workspace.workspaceId,
        )
      : Promise.resolve([]),
    canOperateLegalHolds
      ? getConversationRepository().listRecentLegalHoldReleaseDecisions(
          workspace.workspaceId,
        )
      : Promise.resolve([]),
  ]);
  const requested = await searchParams;
  const parsedQuery = conversationThreadQuerySchema.safeParse({
    search: first(requested.search),
    campaign: first(requested.campaign),
    destination: first(requested.destination),
    brand: first(requested.brand),
    account: first(requested.account),
    publication: first(requested.publication),
    provider: first(requested.provider),
    status: first(requested.status),
    sentiment: first(requested.sentiment),
    intent: first(requested.intent),
    urgency: first(requested.urgency),
    owner: first(requested.owner),
    handoff: first(requested.handoff),
    deadline: first(requested.deadline),
    read: first(requested.read),
    activityFrom: first(requested.activityFrom),
    activityTo: first(requested.activityTo),
  });
  const query = parsedQuery.success
    ? parsedQuery.data
    : conversationThreadQuerySchema.parse({});
  const threads = await getConversationRepository().listThreads(
    workspace.workspaceId,
    {
      search: query.search,
      campaignId: query.campaign,
      destinationId: query.destination,
      brandProfileId: query.brand,
      channelConnectionId: query.account,
      publicationActionId: query.publication,
      provider: query.provider,
      status: query.status,
      sentiment: query.sentiment,
      intent: query.intent,
      urgency: query.urgency,
      assignedOwnerId:
        query.owner === "me"
          ? user.id
          : query.owner === "unassigned"
            ? null
            : query.owner,
      handoff: query.handoff,
      deadline: query.deadline,
      unread:
        query.read === "unread"
          ? true
          : query.read === "read"
            ? false
            : undefined,
      activityFrom: query.activityFrom
        ? `${query.activityFrom}T00:00:00.000Z`
        : undefined,
      activityTo: query.activityTo
        ? `${query.activityTo}T23:59:59.999Z`
        : undefined,
      limit: query.limit,
    },
    user.id,
  );
  const hasFilters = Object.entries(query).some(
    ([key, value]) => key !== "limit" && value !== undefined,
  );
  const suppressedCount = relationships.filter(
    (relationship) =>
      relationship.effectiveContactPermission === "suppressed",
  ).length;

  return (
    <WorkspaceShell
      activePath="/conversations"
      userName={user.displayName}
      workspaceName={workspace.workspaceName}
    >
      <div className="resource-page">
        <header className="resource-header">
          <div>
            <p className="eyebrow">Provider-neutral inbox</p>
            <h1>Conversations</h1>
            <p>
              Review thread history, assign ownership, and keep internal notes
              separate from anything a connector could deliver.
            </p>
          </div>
          <div className="resource-header-actions">
            <Link
              className="button-secondary resource-button"
              href="/conversations/new"
            >
              <UserRound size={15} /> New relationship
            </Link>
            <Link
              className="button-primary resource-button"
              href="/conversations/new-thread"
            >
              <Plus size={15} /> New conversation
            </Link>
          </div>
        </header>

        <ConversationAttentionQueue items={attentionItems} />

        <form
          action="/conversations"
          className="conversation-filters"
          method="get"
        >
          <label className="field filter-search">
            <span>
              Search contact, subject, messages, brand, campaign, account,
              publication, or topic
            </span>
            <input
              defaultValue={query.search}
              name="search"
              placeholder="Search inbox"
            />
          </label>
          <label className="field">
            <span>Provider</span>
            <input
              defaultValue={query.provider}
              name="provider"
              placeholder="Any provider"
            />
          </label>
          <label className="field">
            <span>Campaign</span>
            <select defaultValue={query.campaign ?? ""} name="campaign">
              <option value="">Any campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Brand</span>
            <select defaultValue={query.brand ?? ""} name="brand">
              <option value="">Any brand</option>
              {contextDirectory.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name} · {label(brand.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Destination</span>
            <select defaultValue={query.destination ?? ""} name="destination">
              <option value="">Any destination</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Account</span>
            <select defaultValue={query.account ?? ""} name="account">
              <option value="">Any account</option>
              {contextDirectory.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} · {label(channel.provider)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Publication</span>
            <select defaultValue={query.publication ?? ""} name="publication">
              <option value="">Any publication</option>
              {contextDirectory.publications.map((publication) => (
                <option key={publication.id} value={publication.id}>
                  {publication.channelConnectionName} ·{" "}
                  {publication.providerExternalId ?? publication.id.slice(0, 8)}{" "}
                  · {label(publication.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select defaultValue={query.status ?? ""} name="status">
              <option value="">Any status</option>
              {CONVERSATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <select defaultValue={query.owner ?? ""} name="owner">
              <option value="">Any owner</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {members
                .filter(
                  (member) =>
                    member.assignableToConversations &&
                    member.userId !== user.id,
                )
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    Assigned to {member.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Sentiment</span>
            <select defaultValue={query.sentiment ?? ""} name="sentiment">
              <option value="">Any sentiment</option>
              {CONVERSATION_SENTIMENTS.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Intent</span>
            <select defaultValue={query.intent ?? ""} name="intent">
              <option value="">Any intent</option>
              {CONVERSATION_INTENTS.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Urgency</span>
            <select defaultValue={query.urgency ?? ""} name="urgency">
              <option value="">Any urgency</option>
              {CONVERSATION_URGENCIES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Handoff</span>
            <select defaultValue={query.handoff ?? ""} name="handoff">
              <option value="">Any handoff state</option>
              <option value="open">Open handoff</option>
              <option value="none">No open handoff</option>
            </select>
          </label>
          <label className="field">
            <span>Deadline</span>
            <select defaultValue={query.deadline ?? ""} name="deadline">
              <option value="">Any deadline</option>
              <option value="overdue">Overdue</option>
              <option value="upcoming">Upcoming</option>
              <option value="none">No deadline</option>
            </select>
          </label>
          <label className="field">
            <span>Read state</span>
            <select defaultValue={query.read ?? ""} name="read">
              <option value="">Any read state</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
          </label>
          <label className="field">
            <span>Active from</span>
            <input
              defaultValue={query.activityFrom}
              name="activityFrom"
              type="date"
            />
          </label>
          <label className="field">
            <span>Active through</span>
            <input
              defaultValue={query.activityTo}
              name="activityTo"
              type="date"
            />
          </label>
          <div className="conversation-filter-actions">
            <button className="button-primary">Apply filters</button>
            {hasFilters && (
              <Link className="button-secondary" href="/conversations">
                Clear
              </Link>
            )}
          </div>
        </form>

        <section className="resource-panel conversation-inbox">
          <div className="resource-panel-head">
            <div>
              <h2>Inbox</h2>
              <p>
                {threads.length} {hasFilters ? "matching " : ""}provider-neutral
                thread
                {threads.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          {threads.length === 0 ? (
            <div className="empty-state conversation-empty">
              <span>
                <MessageSquareText size={22} />
              </span>
              <h3>
                {hasFilters
                  ? "No conversations match"
                  : "No conversation threads yet"}
              </h3>
              <p>
                Create a manual thread to preserve message history and internal
                context.
              </p>
              {relationships.length > 0 && (
                <Link
                  className="button-primary"
                  href="/conversations/new-thread"
                >
                  <Plus size={15} /> New conversation
                </Link>
              )}
            </div>
          ) : (
            <div className="conversation-list">
              {threads.map((thread) => (
                <Link
                  className="conversation-row"
                  href={`/conversations/threads/${thread.id}`}
                  key={thread.id}
                >
                  <span className="resource-icon">
                    <MessageSquareText size={18} />
                  </span>
                  <div className="conversation-summary">
                    <div>
                      <strong>{thread.subject}</strong>
                      <span className="status-pill">
                        {label(thread.status)}
                      </span>
                      {thread.unreadCount > 0 && (
                        <span className="status-pill status-violet">
                          {thread.unreadCount} unread
                        </span>
                      )}
                      {thread.activeHandoff && (
                        <span className="status-pill status-amber">
                          Handoff open
                        </span>
                      )}
                      {thread.urgency !== "unknown" && (
                        <span
                          className={`status-pill ${thread.urgency === "critical" || thread.urgency === "high" ? "status-red" : "status-neutral"}`}
                        >
                          {label(thread.urgency)} urgency
                        </span>
                      )}
                    </div>
                    <p>
                      {thread.latestMessage?.body ??
                        "No messages recorded yet."}
                    </p>
                    <small>
                      {thread.relationshipDisplayName} · {thread.provider} ·{" "}
                      {thread.messageCount} message
                      {thread.messageCount === 1 ? "" : "s"}
                      {" · "}
                      {thread.assignedOwnerDisplayName ?? "Unassigned"}
                      {" · "}
                      {label(thread.sentiment)} sentiment
                      {" · "}
                      {label(thread.intent)} intent
                    </small>
                    <small className="conversation-context">
                      Relationship: {label(thread.relationshipStage)} {" · "}
                      {thread.priorThreadCount} prior conversation
                      {thread.priorThreadCount === 1 ? "" : "s"} {" · "}
                      {thread.priorMessageCount} prior message
                      {thread.priorMessageCount === 1 ? "" : "s"}
                      {thread.lastPriorInteractionAt
                        ? ` · Last prior interaction ${formatDate(thread.lastPriorInteractionAt)}`
                        : ""}
                    </small>
                    {thread.routingSuggestion && (
                      <small className="conversation-routing-suggestion">
                        Suggested route: {thread.routingSuggestion.ruleName} →{" "}
                        {label(thread.routingSuggestion.targetStatus)}
                        {thread.routingSuggestion.targetOwnerDisplayName
                          ? ` to ${thread.routingSuggestion.targetOwnerDisplayName}`
                          : ""}{" "}
                        {" · Matches "}
                        {thread.routingSuggestion.matchedOn
                          .map(label)
                          .join(", ")}
                      </small>
                    )}
                    {thread.sharedResourceHistoryCount > 0 && (
                      <small className="conversation-context">
                        Previously shared:{" "}
                        {thread.recentSharedResources
                          .map((resource) =>
                            resource.kind === "destination"
                              ? (resource.destinationTitle ?? "Destination")
                              : `${resource.channelConnectionName ?? "Account"} publication ${resource.publicationExternalId ?? resource.publicationActionId?.slice(0, 8) ?? ""}`,
                          )
                          .join(" · ")}
                        {thread.sharedResourceHistoryCount >
                        thread.recentSharedResources.length
                          ? ` · +${thread.sharedResourceHistoryCount - thread.recentSharedResources.length} more`
                          : ""}
                      </small>
                    )}
                    {(thread.brandProfileName ||
                      thread.campaignName ||
                      thread.destinationTitle) && (
                      <small className="conversation-context">
                        {thread.brandProfileName
                          ? `Brand: ${thread.brandProfileName}${thread.brandProfileStatus ? ` (${label(thread.brandProfileStatus)})` : ""}`
                          : ""}
                        {thread.brandProfileName &&
                        (thread.campaignName || thread.destinationTitle)
                          ? " · "
                          : ""}
                        {thread.campaignName
                          ? `Campaign: ${thread.campaignName}`
                          : ""}
                        {thread.campaignName && thread.destinationTitle
                          ? " · "
                          : ""}
                        {thread.destinationTitle
                          ? `Destination: ${thread.destinationTitle}`
                          : ""}
                      </small>
                    )}
                    {(thread.channelConnectionName ||
                      thread.publicationActionId) && (
                      <small className="conversation-context">
                        {thread.channelConnectionName
                          ? `Account: ${thread.channelConnectionName}${thread.channelProvider ? ` (${label(thread.channelProvider)})` : ""}`
                          : ""}
                        {thread.channelConnectionName &&
                        thread.publicationActionId
                          ? " · "
                          : ""}
                        {thread.publicationActionId
                          ? `Publication: ${thread.publicationExternalId ?? thread.publicationActionId.slice(0, 8)}${thread.publicationStatus ? ` (${label(thread.publicationStatus)})` : ""}`
                          : ""}
                      </small>
                    )}
                    {(thread.responseDueAt || thread.followUpAt) && (
                      <small className="conversation-deadlines">
                        {thread.responseDueAt
                          ? `Response due ${formatDate(thread.responseDueAt)}`
                          : ""}
                        {thread.responseDueAt && thread.followUpAt ? " · " : ""}
                        {thread.followUpAt
                          ? `Follow up ${formatDate(thread.followUpAt)}`
                          : ""}
                      </small>
                    )}
                    {thread.serviceLevel && (
                      <small className={`conversation-service-level service-${thread.serviceLevel.state}`}>
                        Service level: {label(thread.serviceLevel.state)} · due {formatDate(thread.serviceLevel.dueAt)}
                        {thread.serviceLevel.source === "manual" ? " · manual deadline" : " · workspace policy"}
                      </small>
                    )}
                    {thread.openReviewRequestCount > 0 && (
                      <small className="conversation-review-count">
                        {thread.openReviewRequestCount} open internal review
                        {thread.openReviewRequestCount === 1 ? "" : "s"}
                      </small>
                    )}
                  </div>
                  {thread.contactPermission === "suppressed" && (
                    <span className="status-pill status-red">
                      <ShieldBan size={12} /> do not contact
                    </span>
                  )}
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="resource-panel">
          <div className="resource-panel-head">
            <div>
              <h2>Relationship registry</h2>
              <p>
                {relationships.length} record
                {relationships.length === 1 ? "" : "s"} · {suppressedCount} do
                not contact
              </p>
            </div>
          </div>
          {relationships.length === 0 ? (
            <div className="empty-state">
              <span>
                <MessageSquareText size={22} />
              </span>
              <h3>No relationship records yet</h3>
              <p>
                Add a contact manually now; connector-backed inbox messages can
                attach to the same registry later.
              </p>
            </div>
          ) : (
            <div className="resource-table">
              {relationships.map((relationship) => (
                <article className="resource-row" key={relationship.id}>
                  <span className="resource-icon">
                    {relationship.effectiveContactPermission === "suppressed" ? (
                      <ShieldBan size={18} />
                    ) : (
                      <UserRound size={18} />
                    )}
                  </span>
                  <div className="resource-primary">
                    <strong>{relationship.displayName}</strong>
                    <p>
                      {relationship.organizationName || "Independent contact"} ·{" "}
                      {relationship.identities.length} provider identit
                      {relationship.identities.length === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <div>
                    <span className="resource-label">Stage</span>
                    <strong>{label(relationship.stage)}</strong>
                  </div>
                  <span
                    className={`status-pill ${relationship.effectiveContactPermission === "suppressed" ? "status-red" : "status-green"}`}
                  >
                    {relationship.effectiveContactPermission === "suppressed"
                      ? "do not contact"
                      : "contact allowed"}
                  </span>
                  <Link
                    aria-label={`Edit ${relationship.displayName}`}
                    className="icon-link"
                    href={`/conversations/${relationship.id}/edit`}
                  >
                    <Settings2 size={16} />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
        <RelationshipIdentityCandidates
          suggestions={identitySuggestions}
          workspaceId={workspace.workspaceId}
        />
        <ConversationRoutingRules
          brands={contextDirectory.brands}
          channels={contextDirectory.channels}
          members={members}
          rules={routingRules}
          workspaceId={workspace.workspaceId}
        />
        <ConversationServiceLevelPolicy
          policy={serviceLevelPolicy}
          workspaceId={workspace.workspaceId}
        />
        <ConversationRetentionPolicy
          activeLegalHolds={activeLegalHolds}
          candidates={retentionCandidates}
          currentUserId={user.id}
          erasureRequests={retentionErasureRequests}
          legalHoldReleaseRequests={legalHoldReleaseRequests}
          recentLegalHoldReleaseDecisions={recentLegalHoldReleaseDecisions}
          policy={retentionPolicy}
          workspaceRole={workspace.role}
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

function first(value: string | string[] | undefined): string | undefined {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected || undefined;
}
