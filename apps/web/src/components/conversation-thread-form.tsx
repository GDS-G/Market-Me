"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONVERSATION_INTENTS,
  CONVERSATION_SENTIMENTS,
  CONVERSATION_STATUSES,
  CONVERSATION_URGENCIES,
} from "@market-me/domain";
import type {
  ConversationBrandOption,
  ConversationChannelOption,
  ConversationPublicationOption,
  WorkspaceMember,
} from "@market-me/database";

type RelationshipOption = {
  id: string;
  displayName: string;
  contactPermission: "allowed" | "suppressed";
};

type CampaignOption = { id: string; name: string };
type DestinationOption = { id: string; title: string };

export function ConversationThreadForm({
  workspaceId,
  brands,
  currentUserId,
  campaigns,
  channels,
  destinations,
  members,
  publications,
  relationships,
}: {
  workspaceId: string;
  brands: readonly ConversationBrandOption[];
  currentUserId: string;
  campaigns: readonly CampaignOption[];
  channels: readonly ConversationChannelOption[];
  destinations: readonly DestinationOption[];
  members: readonly WorkspaceMember[];
  publications: readonly ConversationPublicationOption[];
  relationships: readonly RelationshipOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    relationshipId: relationships[0]?.id ?? "",
    brandProfileId: "",
    campaignId: "",
    destinationId: "",
    channelConnectionId: "",
    publicationActionId: "",
    provider: "manual",
    providerThreadId: "",
    subject: "",
    status: "new",
    sentiment: "unknown",
    intent: "unknown",
    urgency: "unknown",
    assignedOwnerId: "",
    responseDueAt: "",
    followUpAt: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selected = relationships.find(
    (relationship) => relationship.id === values.relationshipId,
  );
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(key === "status" && value === "unassigned"
        ? { assignedOwnerId: "" }
        : {}),
    }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/v1/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        relationshipId: values.relationshipId,
        brandProfileId: values.brandProfileId || null,
        campaignId: values.campaignId || null,
        destinationId: values.destinationId || null,
        channelConnectionId: values.channelConnectionId || null,
        publicationActionId: values.publicationActionId || null,
        provider: values.provider,
        providerThreadId: values.providerThreadId.trim() || undefined,
        subject: values.subject,
        status: values.status,
        sentiment: values.sentiment,
        intent: values.intent,
        urgency: values.urgency,
        assignedOwnerId: values.assignedOwnerId || undefined,
        responseDueAt: toIso(values.responseDueAt),
        followUpAt: toIso(values.followUpAt),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not create the conversation.");
      return;
    }
    router.push(`/conversations/threads/${payload.data.id}`);
    router.refresh();
  }

  return (
    <form className="resource-form" onSubmit={submit}>
      <section className="form-section">
        <div>
          <h2>Thread identity</h2>
          <p>
            Create a provider-neutral record. This form records history and does
            not send anything.
          </p>
        </div>
        <div className="field-grid">
          <label className="field field-wide">
            <span>Relationship</span>
            <select
              required
              value={values.relationshipId}
              onChange={(event) => set("relationshipId", event.target.value)}
            >
              {relationships.map((relationship) => (
                <option key={relationship.id} value={relationship.id}>
                  {relationship.displayName}
                  {relationship.contactPermission === "suppressed"
                    ? " — do not contact"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {selected?.contactPermission === "suppressed" && (
            <p className="form-error field-wide">
              This relationship is do-not-contact. Inbound history and internal
              notes are allowed; future outbound actions must remain blocked.
            </p>
          )}
          <label className="field">
            <span>Provider</span>
            <input
              required
              value={values.provider}
              onChange={(event) => set("provider", event.target.value)}
              placeholder="manual, email, discord"
            />
          </label>
          <label className="field">
            <span>Provider thread ID (optional)</span>
            <input
              value={values.providerThreadId}
              onChange={(event) => set("providerThreadId", event.target.value)}
            />
          </label>
          <label className="field field-wide">
            <span>Subject</span>
            <input
              required
              value={values.subject}
              onChange={(event) => set("subject", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Related brand (optional)</span>
            <select
              value={values.brandProfileId}
              onChange={(event) => set("brandProfileId", event.target.value)}
            >
              <option value="">No brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name} · {label(brand.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Related campaign (optional)</span>
            <select
              value={values.campaignId}
              onChange={(event) => set("campaignId", event.target.value)}
            >
              <option value="">No campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Related destination (optional)</span>
            <select
              value={values.destinationId}
              onChange={(event) => set("destinationId", event.target.value)}
            >
              <option value="">No destination</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Related account (optional)</span>
            <select
              value={values.channelConnectionId}
              onChange={(event) => {
                const next = event.target.value;
                const selectedPublication = publications.find(
                  (publication) =>
                    publication.id === values.publicationActionId,
                );
                setValues((current) => ({
                  ...current,
                  channelConnectionId: next,
                  publicationActionId:
                    selectedPublication?.channelConnectionId === next
                      ? current.publicationActionId
                      : "",
                }));
              }}
            >
              <option value="">No account</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} · {label(channel.provider)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Related publication (optional)</span>
            <select
              value={values.publicationActionId}
              onChange={(event) => {
                const publication = publications.find(
                  (option) => option.id === event.target.value,
                );
                setValues((current) => ({
                  ...current,
                  publicationActionId: event.target.value,
                  channelConnectionId:
                    publication?.channelConnectionId ??
                    current.channelConnectionId,
                }));
              }}
            >
              <option value="">No publication</option>
              {publications.map((publication) => (
                <option key={publication.id} value={publication.id}>
                  {publicationLabel(publication)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={values.status}
              onChange={(event) => set("status", event.target.value)}
            >
              {CONVERSATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <select
              value={values.assignedOwnerId}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  assignedOwnerId: event.target.value,
                  status: event.target.value ? "assigned" : "unassigned",
                }))
              }
            >
              <option value="">Unassigned</option>
              {members
                .filter((member) => member.assignableToConversations)
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                    {member.userId === currentUserId ? " (me)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Sentiment</span>
            <select
              value={values.sentiment}
              onChange={(event) => set("sentiment", event.target.value)}
            >
              {CONVERSATION_SENTIMENTS.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Intent</span>
            <select
              value={values.intent}
              onChange={(event) => set("intent", event.target.value)}
            >
              {CONVERSATION_INTENTS.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Urgency</span>
            <select
              value={values.urgency}
              onChange={(event) => set("urgency", event.target.value)}
            >
              {CONVERSATION_URGENCIES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Response due (optional)</span>
            <input
              type="datetime-local"
              value={values.responseDueAt}
              onChange={(event) => set("responseDueAt", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Follow-up reminder (optional)</span>
            <input
              type="datetime-local"
              value={values.followUpAt}
              onChange={(event) => set("followUpAt", event.target.value)}
            />
          </label>
        </div>
      </section>
      <div className="form-actions">
        <button
          className="button-primary"
          disabled={pending || relationships.length === 0}
        >
          {pending ? "Creating…" : "Create conversation"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function publicationLabel(publication: ConversationPublicationOption): string {
  return `${publication.channelConnectionName} · ${publication.providerExternalId ?? publication.id.slice(0, 8)} · ${label(publication.status)}`;
}

function toIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}
