"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, ShieldCheck } from "lucide-react";
import type { StoredConversationResponseSuggestion } from "@market-me/database";

export function ConversationAssistant({
  workspaceId,
  threadId,
  suggestions,
}: {
  workspaceId: string;
  threadId: string;
  suggestions: readonly StoredConversationResponseSuggestion[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = suggestions.find((suggestion) => suggestion.status === "active");
  const history = suggestions.filter((suggestion) => suggestion.status !== "active");

  async function generate() {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${threadId}/response-suggestions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(
        payload?.error?.message ?? "Could not generate a safe response suggestion.",
      );
      return;
    }
    router.refresh();
  }

  async function dismiss() {
    if (!active) return;
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${threadId}/response-suggestions/${active.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status: "dismissed" }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not dismiss the suggestion.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="resource-panel conversation-assistant-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Conversation Assistant</p>
          <h2>Evidence-backed response suggestion</h2>
          <p>
            Deterministic local assistance with explicit uncertainty and citations.
            Nothing here is sent externally.
          </p>
        </div>
        <Bot size={22} aria-hidden="true" />
      </div>

      {active ? (
        <Suggestion suggestion={active} />
      ) : (
        <div className="assistant-empty">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>
            Generate a review-only suggestion from the latest twenty external
            messages and approved structured context.
          </p>
        </div>
      )}

      <div className="assistant-actions">
        <button
          className="button-primary"
          disabled={pending}
          onClick={generate}
          type="button"
        >
          {active ? "Regenerate from current context" : "Generate suggestion"}
        </button>
        {active && (
          <button
            className="button-secondary"
            disabled={pending}
            onClick={dismiss}
            type="button"
          >
            Dismiss suggestion
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {history.length > 0 && (
        <details className="assistant-history">
          <summary>Previous suggestions ({history.length})</summary>
          {history.map((suggestion) => (
            <Suggestion key={suggestion.id} suggestion={suggestion} compact />
          ))}
        </details>
      )}
    </section>
  );
}

function Suggestion({
  suggestion,
  compact = false,
}: {
  suggestion: StoredConversationResponseSuggestion;
  compact?: boolean;
}) {
  return (
    <article className={`assistant-suggestion ${compact ? "assistant-compact" : ""}`}>
      <div className="assistant-suggestion-meta">
        <span className="status-pill status-neutral">
          {label(suggestion.recommendation)}
        </span>
        <span className="status-pill">{label(suggestion.status)}</span>
        <span>Uncertainty {Math.round(suggestion.uncertainty * 100)}%</span>
        <span>{label(suggestion.recommendedPromotionalStrength)} promotion</span>
      </div>
      <p>{suggestion.summary}</p>
      {!compact && suggestion.identifiedQuestions.length > 0 && (
        <div>
          <h3>Questions identified</h3>
          <ul>
            {suggestion.identifiedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      {!compact && suggestion.responseText && (
        <div className="assistant-response-copy">
          <h3>Review-only draft</h3>
          <p>{suggestion.responseText}</p>
        </div>
      )}
      {!compact && !suggestion.responseText && (
        <p className="assistant-no-response">
          No external response is drafted for this recommendation.
        </p>
      )}
      {!compact && (
        <div className="assistant-evidence-grid">
          <div>
            <h3>Supporting context</h3>
            <ol>
              {suggestion.citations.map((citation, index) => (
                <li key={`${citation.kind}-${citation.sourceId}`}>
                  <strong>[{index + 1}] {citation.label}</strong>
                  {citation.excerpt && <p>{citation.excerpt}</p>}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3>Uncertainty</h3>
            <ul>
              {suggestion.uncertaintyReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <h3>Factual claims</h3>
            {suggestion.claims.length ? (
              <ul>
                {suggestion.claims.map((claim) => (
                  <li key={claim.text}>
                    {claim.text} {claim.citationIndexes.map((index) => `[${index + 1}]`).join(" ")}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No factual business claim was added.</p>
            )}
          </div>
        </div>
      )}
      <small>
        {suggestion.generatorProvider}/{suggestion.generatorModel} {suggestion.generatorVersion}
        {" · "}prompt {suggestion.promptVersion}{" · "}{formatDate(suggestion.createdAt)}
      </small>
    </article>
  );
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
