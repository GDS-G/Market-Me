"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ConversationBrandOption,
  ConversationChannelOption,
  ConversationPublicationOption,
  StoredConversationThread,
  WorkspaceMember,
} from "@market-me/database";
import {
  CONVERSATION_INTENTS,
  CONVERSATION_SENTIMENTS,
  CONVERSATION_STATUSES,
  CONVERSATION_URGENCIES,
} from "@market-me/domain";

export function ConversationActions({
  workspaceId,
  brands,
  currentUserId,
  campaigns,
  channels,
  destinations,
  members,
  publications,
  thread,
}: {
  workspaceId: string;
  brands: readonly ConversationBrandOption[];
  currentUserId: string;
  campaigns: readonly { id: string; name: string }[];
  channels: readonly ConversationChannelOption[];
  destinations: readonly { id: string; title: string }[];
  members: readonly WorkspaceMember[];
  publications: readonly ConversationPublicationOption[];
  thread: StoredConversationThread;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(thread.status);
  const [assignedOwnerId, setAssignedOwnerId] = useState(
    thread.assignedOwnerId ?? "",
  );
  const [brandProfileId, setBrandProfileId] = useState(
    thread.brandProfileId ?? "",
  );
  const [campaignId, setCampaignId] = useState(thread.campaignId ?? "");
  const [destinationId, setDestinationId] = useState(
    thread.destinationId ?? "",
  );
  const [channelConnectionId, setChannelConnectionId] = useState(
    thread.channelConnectionId ?? "",
  );
  const [publicationActionId, setPublicationActionId] = useState(
    thread.publicationActionId ?? "",
  );
  const [sentiment, setSentiment] = useState(thread.sentiment);
  const [intent, setIntent] = useState(thread.intent);
  const [urgency, setUrgency] = useState(thread.urgency);
  const [responseDueAt, setResponseDueAt] = useState(
    toLocalInput(thread.responseDueAt),
  );
  const [followUpAt, setFollowUpAt] = useState(toLocalInput(thread.followUpAt));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function updateThread() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/conversations/${thread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        relationshipId: thread.relationshipId,
        brandProfileId: brandProfileId || null,
        campaignId: campaignId || null,
        destinationId: destinationId || null,
        channelConnectionId: channelConnectionId || null,
        publicationActionId: publicationActionId || null,
        provider: thread.provider,
        providerThreadId: thread.providerThreadId,
        subject: thread.subject,
        status,
        sentiment,
        intent,
        urgency,
        assignedOwnerId: assignedOwnerId || undefined,
        responseDueAt: toIso(responseDueAt),
        followUpAt: toIso(followUpAt),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not update the conversation.");
      return;
    }
    router.refresh();
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/conversations/${thread.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, body: note }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not add the internal note.");
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <div className="conversation-controls">
      <section className="resource-panel">
        <div className="resource-panel-head">
          <div>
            <h2>Ownership and state</h2>
            <p>State changes update the local inbox record only.</p>
          </div>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => {
                const next = event.target.value as typeof status;
                setStatus(next);
                if (next === "unassigned") setAssignedOwnerId("");
              }}
            >
              {CONVERSATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <select
              value={assignedOwnerId}
              onChange={(event) => {
                setAssignedOwnerId(event.target.value);
                setStatus(event.target.value ? "assigned" : "unassigned");
              }}
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
            <span>Response due</span>
            <input
              type="datetime-local"
              value={responseDueAt}
              onChange={(event) => setResponseDueAt(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Related brand</span>
            <select
              value={brandProfileId}
              onChange={(event) => setBrandProfileId(event.target.value)}
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
            <span>Related campaign</span>
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
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
            <span>Related destination</span>
            <select
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
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
            <span>Related account</span>
            <select
              value={channelConnectionId}
              onChange={(event) => {
                const next = event.target.value;
                const publication = publications.find(
                  (option) => option.id === publicationActionId,
                );
                setChannelConnectionId(next);
                if (publication?.channelConnectionId !== next) {
                  setPublicationActionId("");
                }
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
            <span>Related publication</span>
            <select
              value={publicationActionId}
              onChange={(event) => {
                const publication = publications.find(
                  (option) => option.id === event.target.value,
                );
                setPublicationActionId(event.target.value);
                if (publication) {
                  setChannelConnectionId(publication.channelConnectionId);
                }
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
            <span>Sentiment</span>
            <select
              value={sentiment}
              onChange={(event) =>
                setSentiment(event.target.value as typeof sentiment)
              }
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
              value={intent}
              onChange={(event) =>
                setIntent(event.target.value as typeof intent)
              }
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
              value={urgency}
              onChange={(event) =>
                setUrgency(event.target.value as typeof urgency)
              }
            >
              {CONVERSATION_URGENCIES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Follow-up reminder</span>
            <input
              type="datetime-local"
              value={followUpAt}
              onChange={(event) => setFollowUpAt(event.target.value)}
            />
          </label>
        </div>
        <button
          className="button-secondary"
          disabled={pending}
          onClick={updateThread}
          type="button"
        >
          Save state
        </button>
      </section>

      <form className="resource-panel" onSubmit={addNote}>
        <div className="resource-panel-head">
          <div>
            <h2>Add internal note</h2>
            <p>
              Internal notes are a closed message kind and cannot be sent by any
              connector.
            </p>
          </div>
        </div>
        <label className="field">
          <span>Note</span>
          <textarea
            required
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button className="button-primary" disabled={pending || !note.trim()}>
          Add internal note
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
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

function toLocalInput(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
