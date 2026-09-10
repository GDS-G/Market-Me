"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArchiveRestore, ShieldCheck } from "lucide-react";
import type {
  ConversationRetentionCandidate,
  ConversationRetentionErasureRequest,
  ConversationLegalHoldCase,
  ConversationLegalHoldReleaseRequest,
} from "@market-me/domain";
import type {
  StoredConversationRetentionPolicy,
  WorkspaceRole,
} from "@market-me/database";

export function ConversationRetentionPolicy({
  workspaceId,
  policy,
  candidates,
  erasureRequests,
  activeLegalHolds,
  legalHoldReleaseRequests,
  recentLegalHoldReleaseDecisions,
  currentUserId,
  workspaceRole,
}: {
  workspaceId: string;
  policy?: StoredConversationRetentionPolicy;
  candidates: readonly ConversationRetentionCandidate[];
  erasureRequests: readonly ConversationRetentionErasureRequest[];
  activeLegalHolds: readonly ConversationLegalHoldCase[];
  legalHoldReleaseRequests: readonly ConversationLegalHoldReleaseRequest[];
  recentLegalHoldReleaseDecisions: readonly ConversationLegalHoldReleaseRequest[];
  currentUserId: string;
  workspaceRole: WorkspaceRole;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    enabled: policy?.enabled ?? false,
    standardDays: String(policy?.standardDays ?? 365),
    personalMessageDays: String(policy?.personalMessageDays ?? 180),
    importedEmailDays: String(policy?.importedEmailDays ?? 365),
  });
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const canRequest = ["owner", "admin", "editor"].includes(workspaceRole);
  const canDecide = ["owner", "admin", "approver"].includes(workspaceRole);
  const pendingRequests = erasureRequests.filter(
    (request) => request.status === "pending",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending("policy");
    setError("");
    const response = await fetch("/api/v1/conversation-retention-policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        enabled: values.enabled,
        standardDays: Number(values.standardDays),
        personalMessageDays: Number(values.personalMessageDays),
        importedEmailDays: Number(values.importedEmailDays),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(body?.error?.message ?? "Could not save the retention policy.");
      return;
    }
    router.refresh();
  }

  async function requestErasure(candidate: ConversationRetentionCandidate) {
    const key = `request:${candidate.conversationThreadId}`;
    setPending(key);
    setError("");
    const response = await fetch(
      `/api/v1/conversations/${candidate.conversationThreadId}/retention-erasure-requests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          requestNote:
            notes[key]?.trim() ||
            "Retention window elapsed; request policy erasure.",
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(
        body?.error?.message ?? "Could not request conversation erasure.",
      );
      return;
    }
    router.refresh();
  }

  async function decideErasure(
    request: ConversationRetentionErasureRequest,
    decision: "execute" | "reject",
  ) {
    const key = `decision:${request.id}`;
    const decisionNote = notes[key]?.trim();
    if (!decisionNote || decisionNote.length < 3) {
      setError("Enter a decision note of at least three characters.");
      return;
    }
    if (
      decision === "execute" &&
      !window.confirm(
        `Permanently erase ${request.subject ?? "this conversation"} and its dependent conversation records? This cannot be undone.`,
      )
    )
      return;
    setPending(`${key}:${decision}`);
    setError("");
    const response = await fetch(
      `/api/v1/conversation-retention-erasure-requests/${request.id}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, decision, decisionNote }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(
        body?.error?.message ?? "Could not decide the erasure request.",
      );
      return;
    }
    router.refresh();
  }

  async function decideHoldRelease(
    request: ConversationLegalHoldReleaseRequest,
    decision: "approve" | "reject",
  ) {
    const key = `hold-decision:${request.id}`;
    const decisionNote = notes[key]?.trim();
    if (!decisionNote || decisionNote.length < 3) {
      setError("Enter a hold-release decision note of at least three characters.");
      return;
    }
    if (
      decision === "approve" &&
      !window.confirm(
        `Release the legal hold on ${request.subject ?? "this conversation"}? Retention eligibility may resume.`,
      )
    )
      return;
    setPending(`${key}:${decision}`);
    setError("");
    const response = await fetch(
      `/api/v1/conversation-legal-hold-release-requests/${request.id}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, decision, decisionNote }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setError(body?.error?.message ?? "Could not decide the hold release request.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="resource-panel conversation-retention-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Approved retention governance</p>
          <h2>Conversation retention policy</h2>
          <p>
            Configure eligibility windows for closed threads. Erasure is manual,
            requires a different approver, and is blocked by legal hold.
          </p>
        </div>
        <ArchiveRestore size={21} aria-hidden="true" />
      </div>
      <form className="retention-policy-form" onSubmit={submit}>
        <label className="field retention-enabled">
          <span>Retention execution</span>
          <input
            checked={values.enabled}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            type="checkbox"
          />
          Enabled
        </label>
        <Days
          label="Standard records"
          value={values.standardDays}
          onChange={(value) =>
            setValues((current) => ({ ...current, standardDays: value }))
          }
        />
        <Days
          label="Personal messages"
          value={values.personalMessageDays}
          onChange={(value) =>
            setValues((current) => ({ ...current, personalMessageDays: value }))
          }
        />
        <Days
          label="Imported email"
          value={values.importedEmailDays}
          onChange={(value) =>
            setValues((current) => ({ ...current, importedEmailDays: value }))
          }
        />
        <button
          className="button-secondary"
          disabled={Boolean(pending)}
          type="submit"
        >
          {pending === "policy" ? "Saving…" : "Save retention policy"}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="retention-preview">
        <h3>Eligible closed threads ({candidates.length})</h3>
        {!policy?.enabled ? (
          <p>Enable the policy to calculate eligibility. No automatic purge runs.</p>
        ) : candidates.length === 0 ? (
          <p>No resolved or archived thread is currently eligible.</p>
        ) : (
          candidates.slice(0, 20).map((candidate) => {
            const existing = pendingRequests.find(
              (request) =>
                request.conversationThreadId === candidate.conversationThreadId,
            );
            const key = `request:${candidate.conversationThreadId}`;
            return (
              <article key={candidate.conversationThreadId}>
                <div>
                  <strong>{candidate.subject}</strong>
                  <p>{candidate.relationshipDisplayName}</p>
                </div>
                <span className="status-pill">
                  {label(candidate.retentionClass)}
                </span>
                <time dateTime={candidate.eligibleAfter}>
                  Eligible {formatDate(candidate.eligibleAfter)}
                </time>
                {existing ? (
                  <span className="status-pill status-amber">
                    Erasure pending
                  </span>
                ) : canRequest ? (
                  <button
                    className="button-secondary"
                    disabled={Boolean(pending)}
                    onClick={() => requestErasure(candidate)}
                    type="button"
                  >
                    {pending === key ? "Requesting…" : "Request erasure"}
                  </button>
                ) : null}
              </article>
            );
          })
        )}
      </div>
      <div className="retention-preview">
        <h3>
          <ShieldCheck size={17} aria-hidden="true" /> Approval queue (
          {pendingRequests.length})
        </h3>
        {pendingRequests.length === 0 ? (
          <p>No conversation erasure request is awaiting a decision.</p>
        ) : (
          pendingRequests.map((request) => {
            const key = `decision:${request.id}`;
            const selfRequested = request.requestedBy === currentUserId;
            return (
              <article key={request.id}>
                <div>
                  <strong>{request.subject ?? "Conversation unavailable"}</strong>
                  <p>
                    {request.relationshipDisplayName ?? "Relationship unavailable"}
                    {" · "}Requested by {request.requestedByDisplayName}
                  </p>
                </div>
                <span className="status-pill">
                  {label(request.retentionClass)}
                </span>
                <time dateTime={request.requestedAt}>
                  Requested {formatDate(request.requestedAt)}
                </time>
                {canDecide && !selfRequested ? (
                  <div className="retention-decision-actions">
                    <input
                      aria-label={`Decision note for ${request.subject ?? request.id}`}
                      maxLength={1000}
                      minLength={3}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      placeholder="Required decision note"
                      value={notes[key] ?? ""}
                    />
                    <button
                      className="button-secondary"
                      disabled={Boolean(pending)}
                      onClick={() => decideErasure(request, "reject")}
                      type="button"
                    >
                      {pending === `${key}:reject` ? "Rejecting…" : "Reject"}
                    </button>
                    <button
                      className="button-primary"
                      disabled={Boolean(pending)}
                      onClick={() => decideErasure(request, "execute")}
                      type="button"
                    >
                      {pending === `${key}:execute`
                        ? "Erasing…"
                        : "Execute erasure"}
                    </button>
                  </div>
                ) : selfRequested ? (
                  <small>
                    A different workspace approver must decide this request.
                  </small>
                ) : null}
              </article>
            );
          })
        )}
      </div>
      {(activeLegalHolds.length > 0 || legalHoldReleaseRequests.length > 0) && (
        <div className="retention-preview legal-hold-operations">
          <h3>
            <ShieldCheck size={17} aria-hidden="true" /> Legal-hold operations (
            {activeLegalHolds.length})
          </h3>
          {activeLegalHolds.map((hold) => {
            const releaseRequest = legalHoldReleaseRequests.find(
              (request) => request.legalHoldCaseId === hold.id,
            );
            const selfRequested = releaseRequest?.requestedBy === currentUserId;
            const key = releaseRequest
              ? `hold-decision:${releaseRequest.id}`
              : `hold:${hold.id}`;
            return (
              <article key={hold.id}>
                <div>
                  <strong>{hold.subject ?? "Conversation unavailable"}</strong>
                  <p>
                    {hold.relationshipDisplayName ?? "Relationship unavailable"}
                    {" · "}Placed by {hold.placedByDisplayName}
                  </p>
                  <p>{hold.reason}</p>
                  {hold.caseReference && <small>Case: {hold.caseReference}</small>}
                </div>
                <span className="status-pill status-amber">Active hold</span>
                <time dateTime={hold.placedAt}>{formatDate(hold.placedAt)}</time>
                <Link
                  className="button-secondary"
                  href={`/conversations/threads/${hold.conversationThreadId}`}
                >
                  Review conversation
                </Link>
                {releaseRequest && canDecide && !selfRequested ? (
                  <div className="retention-decision-actions">
                    <p>
                      Release to {label(releaseRequest.targetRetentionClass)}
                      {" · "}Requested by {releaseRequest.requestedByDisplayName}
                    </p>
                    <input
                      aria-label={`Hold release decision note for ${hold.subject ?? hold.id}`}
                      maxLength={1000}
                      minLength={3}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      placeholder="Required decision note"
                      value={notes[key] ?? ""}
                    />
                    <button
                      className="button-secondary"
                      disabled={Boolean(pending)}
                      onClick={() => decideHoldRelease(releaseRequest, "reject")}
                      type="button"
                    >
                      {pending === `${key}:reject` ? "Rejecting…" : "Reject release"}
                    </button>
                    <button
                      className="button-primary"
                      disabled={Boolean(pending)}
                      onClick={() => decideHoldRelease(releaseRequest, "approve")}
                      type="button"
                    >
                      {pending === `${key}:approve` ? "Approving…" : "Approve release"}
                    </button>
                  </div>
                ) : releaseRequest && selfRequested ? (
                  <small>A different workspace approver must decide this release.</small>
                ) : releaseRequest ? (
                  <small>
                    Release to {label(releaseRequest.targetRetentionClass)} is awaiting an approver.
                  </small>
                ) : (
                  <small>No release request is pending.</small>
                )}
              </article>
            );
          })}
        </div>
      )}
      {recentLegalHoldReleaseDecisions.length > 0 && (
        <div className="retention-preview legal-hold-decisions">
          <h3>
            <ShieldCheck size={17} aria-hidden="true" /> Recent legal-hold decisions
          </h3>
          {recentLegalHoldReleaseDecisions.slice(0, 20).map((request) => (
            <article key={request.id}>
              <div>
                <strong>{request.subject ?? "Conversation unavailable"}</strong>
                <p>
                  {request.relationshipDisplayName ?? "Relationship unavailable"}
                  {" · "}Requested by {request.requestedByDisplayName}
                </p>
                <p>
                  Release to {label(request.targetRetentionClass)}: {request.requestNote}
                </p>
                {request.decisionNote && (
                  <small>
                    Decision by {request.decidedByDisplayName ?? "Unknown member"}: {request.decisionNote}
                  </small>
                )}
              </div>
              <span
                className={`status-pill ${request.status === "approved" ? "status-green" : "status-neutral"}`}
              >
                {label(request.status)}
              </span>
              {request.decidedAt && (
                <time dateTime={request.decidedAt}>
                  {formatDate(request.decidedAt)}
                </time>
              )}
              {request.subject && (
                <Link
                  className="button-secondary"
                  href={`/conversations/threads/${request.conversationThreadId}`}
                >
                  Review conversation
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
      {erasureRequests.some((request) => request.status !== "pending") && (
        <div className="retention-preview">
          <h3>Recent decisions</h3>
          {erasureRequests
            .filter((request) => request.status !== "pending")
            .slice(0, 20)
            .map((request) => (
              <article key={request.id}>
                <div>
                  <strong>
                    {request.status === "executed"
                      ? "Erased conversation"
                      : request.subject ?? "Rejected request"}
                  </strong>
                  <p>
                    Decided by {request.decidedByDisplayName ?? "Unknown member"}
                  </p>
                </div>
                <span
                  className={`status-pill ${request.status === "executed" ? "status-green" : "status-neutral"}`}
                >
                  {label(request.status)}
                </span>
                {request.decidedAt && (
                  <time dateTime={request.decidedAt}>
                    {formatDate(request.decidedAt)}
                  </time>
                )}
              </article>
            ))}
        </div>
      )}
    </section>
  );
}

function Days({
  label: text,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{text} (days)</span>
      <input
        min="1"
        max="3650"
        required
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
