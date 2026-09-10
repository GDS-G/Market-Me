"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ConversationPublicationOption,
  StoredConversationSharedResource,
} from "@market-me/database";

export function ConversationSharedResources({
  workspaceId,
  threadId,
  destinations,
  publications,
  resources,
  historyCount,
}: {
  workspaceId: string;
  threadId: string;
  destinations: readonly { id: string; title: string }[];
  publications: readonly ConversationPublicationOption[];
  resources: readonly StoredConversationSharedResource[];
  historyCount: number;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [observedAt, setObservedAt] = useState(localDateTime());
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const [kind, id] = target.split(":", 2);
    if (!id || (kind !== "destination" && kind !== "publication")) return;
    setSaving(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${threadId}/shared-resources`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          idempotencyKey,
          observedAt: new Date(observedAt).toISOString(),
          kind,
          ...(kind === "destination"
            ? { destinationId: id }
            : { publicationActionId: id }),
        }),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Could not record the shared resource.");
      setSaving(false);
      return;
    }
    setTarget("");
    setObservedAt(localDateTime());
    setIdempotencyKey(crypto.randomUUID());
    setSaving(false);
    router.refresh();
  }

  return (
    <section className="form-section conversation-shared-resources">
      <div>
        <h2>Previously shared</h2>
        <p>
          Record reviewed evidence that a Destination link or Publication was
          actually shared. Related context alone is not treated as proof.
        </p>
      </div>
      <div>
        <form className="shared-resource-form" onSubmit={submit}>
          <label className="field">
            <span>Shared Destination or Publication</span>
            <select
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Choose recorded evidence</option>
              {destinations.map((destination) => (
                <option
                  key={`destination:${destination.id}`}
                  value={`destination:${destination.id}`}
                >
                  Destination · {destination.title}
                </option>
              ))}
              {publications.map((publication) => (
                <option
                  key={`publication:${publication.id}`}
                  value={`publication:${publication.id}`}
                >
                  Publication · {publication.channelConnectionName} ·{" "}
                  {publication.providerExternalId ?? publication.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Observed shared time</span>
            <input
              required
              type="datetime-local"
              value={observedAt}
              onChange={(event) => setObservedAt(event.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button-secondary" disabled={saving || !target}>
            {saving ? "Recording…" : "Record observed share"}
          </button>
        </form>
        <div className="shared-resource-list">
          {resources.map((resource) => (
            <article key={resource.id}>
              <strong>{resourceLabel(resource)}</strong>
              <p>
                {resource.isCurrentThread
                  ? "This thread"
                  : resource.sourceThreadSubject}{" "}
                {" · "}
                {new Date(resource.observedAt).toLocaleString()}
              </p>
              {resource.destinationCanonicalUrl && (
                <a
                  href={resource.destinationCanonicalUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open recorded Destination
                </a>
              )}
            </article>
          ))}
          {!resources.length && (
            <p>No reviewed Destination or Publication shares recorded.</p>
          )}
          {historyCount > resources.length && (
            <p>
              Showing {resources.length} of {historyCount} recent records.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function resourceLabel(resource: StoredConversationSharedResource): string {
  if (resource.kind === "destination") {
    return `Destination: ${resource.destinationTitle ?? resource.destinationId}`;
  }
  const publication =
    resource.publicationExternalId ?? resource.publicationActionId ?? "unknown";
  return `Publication: ${resource.channelConnectionName ?? "Account"} · ${publication}`;
}

function localDateTime(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
