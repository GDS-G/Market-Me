"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FilePenLine, Users } from "lucide-react";
import type {
  StoredConversationComposerState,
  StoredConversationResponseSuggestion,
} from "@market-me/database";

export function ConversationResponseComposer({
  workspaceId,
  threadId,
  currentUserId,
  state,
  sourceSuggestion,
}: {
  workspaceId: string;
  threadId: string;
  currentUserId: string;
  state: StoredConversationComposerState;
  sourceSuggestion?: StoredConversationResponseSuggestion;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [body, setBody] = useState(state.draft?.body ?? "");
  const [sourceSuggestionId, setSourceSuggestionId] = useState(
    state.draft?.sourceSuggestionId,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function setPresence(active: boolean, keepalive = false) {
    await fetch(`/api/v1/conversations/${threadId}/response-draft/presence`, {
      method: active ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
      keepalive,
    }).catch(() => undefined);
  }

  function beginDrafting() {
    void setPresence(true);
    if (!timer.current)
      timer.current = setInterval(() => void setPresence(true), 60_000);
  }

  function endDrafting() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    void setPresence(false, true);
  }

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      void fetch(
        `/api/v1/conversations/${threadId}/response-draft/presence`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId }),
          keepalive: true,
        },
      ).catch(() => undefined);
    },
    [threadId, workspaceId],
  );

  function useSuggestion() {
    if (!sourceSuggestion?.responseText) return;
    setBody(sourceSuggestion.responseText);
    setSourceSuggestionId(sourceSuggestion.id);
    beginDrafting();
  }

  async function save() {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${threadId}/response-draft`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, body, sourceSuggestionId }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not save the response draft.");
      return;
    }
    router.refresh();
  }

  async function discard() {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${threadId}/response-draft`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok && response.status !== 404) {
      setError(payload?.error?.message ?? "Could not discard the response draft.");
      return;
    }
    setBody("");
    setSourceSuggestionId(undefined);
    endDrafting();
    router.refresh();
  }

  return (
    <section className="resource-panel conversation-composer-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Shared response composer</p>
          <h2>Prepare the next response together</h2>
          <p>Saved locally for review. This composer never sends externally.</p>
        </div>
        <FilePenLine size={22} aria-hidden="true" />
      </div>

      {state.presences.length > 0 && (
        <div className="composer-presence" role="status">
          <Users size={17} aria-hidden="true" />
          <span>
            {state.presences
              .map((presence) =>
                presence.actorKind === "assistant"
                  ? "Conversation Assistant is drafting"
                  : presence.actorUserId === currentUserId
                    ? "You are drafting"
                    : `${presence.actorDisplayName} is drafting`,
              )
              .join(" · ")}
          </span>
        </div>
      )}

      <label className="composer-field">
        <span>Review-only response draft</span>
        <textarea
          maxLength={20_000}
          onBlur={endDrafting}
          onChange={(event) => {
            setBody(event.target.value);
            beginDrafting();
          }}
          onFocus={beginDrafting}
          placeholder="Write or adapt a response for team review…"
          rows={8}
          value={body}
        />
      </label>

      <div className="composer-meta">
        <span>{body.length.toLocaleString()} / 20,000 characters</span>
        {state.draft && (
          <span>
            Last saved by {state.draft.updatedByDisplayName} · {formatDate(state.draft.updatedAt)}
          </span>
        )}
        {sourceSuggestionId && (
          <span className="composer-provenance">
            <Bot size={14} aria-hidden="true" /> Adapted from an evidence-backed assistant suggestion
          </span>
        )}
      </div>

      <div className="assistant-actions">
        {sourceSuggestion?.responseText && (
          <button
            className="button-secondary"
            disabled={pending}
            onClick={useSuggestion}
            type="button"
          >
            Use assistant suggestion
          </button>
        )}
        <button
          className="button-primary"
          disabled={pending || !body.trim()}
          onClick={save}
          type="button"
        >
          Save review draft
        </button>
        {state.draft && (
          <button
            className="button-secondary"
            disabled={pending}
            onClick={discard}
            type="button"
          >
            Discard shared draft
          </button>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
