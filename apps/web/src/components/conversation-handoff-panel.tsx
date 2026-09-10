"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredConversationThread } from "@market-me/database";

export function ConversationHandoffPanel({
  workspaceId,
  thread,
}: {
  workspaceId: string;
  thread: StoredConversationThread;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    contactSummary: "",
    importance: "",
    requestOrOffer: "",
    priorResponseSummary: "",
    relevantContext: "",
    suggestedResponse: "",
    dueAt: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${thread.id}/handoffs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          conversationThreadId: thread.id,
          ...values,
          dueAt: values.dueAt
            ? new Date(values.dueAt).toISOString()
            : undefined,
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not request the handoff.");
      return;
    }
    router.refresh();
  }

  async function close(status: "resolved" | "cancelled") {
    if (!thread.activeHandoff) return;
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${thread.id}/handoffs/${thread.activeHandoff.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not close the handoff.");
      return;
    }
    router.refresh();
  }

  const previous = thread.handoffs.filter(
    (handoff) => handoff.status !== "open",
  );
  return (
    <section className="resource-panel handoff-panel">
      <div className="resource-panel-head">
        <div>
          <h2>Human handoff</h2>
          <p>A structured brief for human review; it never sends a response.</p>
        </div>
      </div>
      {thread.activeHandoff ? (
        <div className="handoff-brief">
          <Brief brief={thread.activeHandoff} />
          <div className="handoff-actions">
            <button
              className="button-primary"
              disabled={pending}
              onClick={() => close("resolved")}
              type="button"
            >
              Resolve handoff
            </button>
            <button
              className="button-secondary"
              disabled={pending}
              onClick={() => close("cancelled")}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form className="handoff-form" onSubmit={create}>
          <label className="field">
            <span>Who is the contact?</span>
            <textarea
              required
              value={values.contactSummary}
              onChange={(event) => set("contactSummary", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Why does this matter?</span>
            <textarea
              required
              value={values.importance}
              onChange={(event) => set("importance", event.target.value)}
            />
          </label>
          <label className="field">
            <span>What did they ask or offer?</span>
            <textarea
              required
              value={values.requestOrOffer}
              onChange={(event) => set("requestOrOffer", event.target.value)}
            />
          </label>
          <label className="field">
            <span>What has already been said?</span>
            <textarea
              value={values.priorResponseSummary}
              onChange={(event) =>
                set("priorResponseSummary", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Relevant campaign and business context</span>
            <textarea
              value={values.relevantContext}
              onChange={(event) => set("relevantContext", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Suggested next response</span>
            <textarea
              value={values.suggestedResponse}
              onChange={(event) => set("suggestedResponse", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Handoff deadline (optional)</span>
            <input
              type="datetime-local"
              value={values.dueAt}
              onChange={(event) => set("dueAt", event.target.value)}
            />
          </label>
          <button className="button-primary" disabled={pending}>
            Request human handoff
          </button>
        </form>
      )}
      {previous.length > 0 && (
        <details className="handoff-history">
          <summary>Previous handoffs ({previous.length})</summary>
          {previous.map((handoff) => (
            <Brief brief={handoff} key={handoff.id} />
          ))}
        </details>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Brief({
  brief,
}: {
  brief: StoredConversationThread["handoffs"][number];
}) {
  return (
    <article className="handoff-card">
      <div>
        <span
          className={`status-pill ${brief.status === "open" ? "status-amber" : "status-green"}`}
        >
          {brief.status}
        </span>
        {brief.dueAt && (
          <time dateTime={brief.dueAt}>Due {formatDate(brief.dueAt)}</time>
        )}
      </div>
      <dl>
        <div>
          <dt>Contact</dt>
          <dd>{brief.contactSummary}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{brief.importance}</dd>
        </div>
        <div>
          <dt>Asked or offered</dt>
          <dd>{brief.requestOrOffer}</dd>
        </div>
        {brief.priorResponseSummary && (
          <div>
            <dt>Already said</dt>
            <dd>{brief.priorResponseSummary}</dd>
          </div>
        )}
        {brief.relevantContext && (
          <div>
            <dt>Relevant context</dt>
            <dd>{brief.relevantContext}</dd>
          </div>
        )}
        {brief.suggestedResponse && (
          <div>
            <dt>Suggested response</dt>
            <dd>{brief.suggestedResponse}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
