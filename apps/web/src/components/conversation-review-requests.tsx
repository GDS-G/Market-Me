"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredConversationThread, WorkspaceMember } from "@market-me/database";

export function ConversationReviewRequests({
  currentUserId,
  members,
  thread,
  workspaceId,
}: {
  currentUserId: string;
  members: readonly WorkspaceMember[];
  thread: StoredConversationThread;
  workspaceId: string;
}) {
  const router = useRouter();
  const [requestedReviewerId, setRequestedReviewerId] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [sourceMessageId, setSourceMessageId] = useState("");
  const [requestText, setRequestText] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const internalNotes = thread.messages.filter(
    (message) => message.kind === "internal_note",
  );
  const reviewerOptions = members.filter(
    (member) =>
      member.userId !== currentUserId && member.assignableToConversations,
  );
  const mentionOptions = members.filter(
    (member) =>
      member.userId !== currentUserId &&
      member.userId !== requestedReviewerId,
  );

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${thread.id}/review-requests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          conversationThreadId: thread.id,
          requestedReviewerId,
          mentionedUserIds,
          sourceMessageId: sourceMessageId || undefined,
          requestText,
          dueAt: toIso(dueAt),
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not request review.");
      return;
    }
    setRequestedReviewerId("");
    setMentionedUserIds([]);
    setSourceMessageId("");
    setRequestText("");
    setDueAt("");
    router.refresh();
  }

  async function closeRequest(
    reviewRequestId: string,
    status: "resolved" | "cancelled",
  ) {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${thread.id}/review-requests/${reviewRequestId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not close the review request.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="resource-panel conversation-review-panel">
      <div className="resource-panel-head">
        <div>
          <h2>Internal review requests</h2>
          <p>
            Ask one eligible teammate to review, optionally cite an internal
            note, and mention other workspace members. Nothing here is sent to
            the contact.
          </p>
        </div>
        <span className="status-pill">
          {thread.openReviewRequestCount} open
        </span>
      </div>

      <form className="review-request-form" onSubmit={createRequest}>
        <div className="field-grid">
          <label className="field">
            <span>Requested reviewer</span>
            <select
              required
              value={requestedReviewerId}
              onChange={(event) => {
                const next = event.target.value;
                setRequestedReviewerId(next);
                setMentionedUserIds((current) =>
                  current.filter((userId) => userId !== next),
                );
              }}
            >
              <option value="">Choose a teammate</option>
              {reviewerOptions.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName} · {label(member.role)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Cite internal note (optional)</span>
            <select
              value={sourceMessageId}
              onChange={(event) => setSourceMessageId(event.target.value)}
            >
              <option value="">No cited note</option>
              {internalNotes.map((note) => (
                <option key={note.id} value={note.id}>
                  {formatDate(note.occurredAt)} · {excerpt(note.body)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due (optional)</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>What should be reviewed?</span>
          <textarea
            required
            maxLength={10_000}
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            placeholder="Check the proposed next step against the approved account context."
          />
        </label>
        {mentionOptions.length > 0 && (
          <fieldset className="review-mention-fieldset">
            <legend>Mention additional teammates (optional)</legend>
            <div className="review-mention-grid">
              {mentionOptions.map((member) => (
                <label key={member.userId}>
                  <input
                    type="checkbox"
                    checked={mentionedUserIds.includes(member.userId)}
                    onChange={(event) =>
                      setMentionedUserIds((current) =>
                        event.target.checked
                          ? [...current, member.userId]
                          : current.filter((userId) => userId !== member.userId),
                      )
                    }
                  />
                  {member.displayName}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <button
          className="button-primary"
          disabled={pending || !requestedReviewerId || !requestText.trim()}
        >
          Request internal review
        </button>
      </form>

      <div className="review-request-list">
        {thread.reviewRequests.length === 0 ? (
          <p className="muted">No internal review requests yet.</p>
        ) : (
          thread.reviewRequests.map((request) => {
            const citedNote = request.sourceMessageId
              ? internalNotes.find((note) => note.id === request.sourceMessageId)
              : undefined;
            return (
              <article className="review-request-card" key={request.id}>
                <div className="review-request-head">
                  <div>
                    <strong>{request.requestedReviewerDisplayName}</strong>
                    <span className={`status-pill status-${request.status}`}>
                      {label(request.status)}
                    </span>
                  </div>
                  <time dateTime={request.createdAt}>
                    {formatDate(request.createdAt)}
                  </time>
                </div>
                <p>{request.requestText}</p>
                <small>
                  Requested by {request.requestedByDisplayName}
                  {request.dueAt ? ` · Due ${formatDate(request.dueAt)}` : ""}
                </small>
                {citedNote && (
                  <blockquote>
                    Cited internal note: {excerpt(citedNote.body, 180)}
                  </blockquote>
                )}
                {request.mentionedMembers.length > 0 && (
                  <p className="review-mentions">
                    Mentioned: {request.mentionedMembers.map((member) => member.displayName).join(", ")}
                  </p>
                )}
                {request.status === "open" && (
                  <div className="review-request-actions">
                    {request.requestedReviewerId === currentUserId && (
                      <button
                        className="button-secondary"
                        disabled={pending}
                        onClick={() => closeRequest(request.id, "resolved")}
                        type="button"
                      >
                        Mark reviewed
                      </button>
                    )}
                    {request.requestedBy === currentUserId && (
                      <button
                        className="button-secondary"
                        disabled={pending}
                        onClick={() => closeRequest(request.id, "cancelled")}
                        type="button"
                      >
                        Cancel request
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function excerpt(value: string, limit = 72): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}
