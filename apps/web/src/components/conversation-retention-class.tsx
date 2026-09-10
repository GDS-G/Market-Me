"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type {
  ConversationLegalHoldCase,
  ConversationLegalHoldReleaseRequest,
  ConversationRetentionClass,
} from "@market-me/domain";
import type { WorkspaceRole } from "@market-me/database";

const STANDARD_CLASSES = [
  "standard",
  "personal_message",
  "imported_email",
] as const;

type StandardRetentionClass = (typeof STANDARD_CLASSES)[number];

export function ConversationRetentionClassControl({
  workspaceId,
  threadId,
  value,
  updatedAt,
  legalHolds,
  releaseRequests,
  currentUserId,
  workspaceRole,
}: {
  workspaceId: string;
  threadId: string;
  value: ConversationRetentionClass;
  updatedAt?: string;
  legalHolds: readonly ConversationLegalHoldCase[];
  releaseRequests: readonly ConversationLegalHoldReleaseRequest[];
  currentUserId: string;
  workspaceRole: WorkspaceRole;
}) {
  const router = useRouter();
  const activeHold = legalHolds.find((hold) => hold.status === "active");
  const [retentionClass, setRetentionClass] = useState<StandardRetentionClass>(
    activeHold?.previousRetentionClass ??
      (value === "legal_hold" ? "standard" : value),
  );
  const [reason, setReason] = useState("");
  const [caseReference, setCaseReference] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const releaseRequest = activeHold
    ? releaseRequests.find(
        (request) =>
          request.legalHoldCaseId === activeHold.id &&
          request.status === "pending",
      )
    : undefined;
  const canWrite = ["owner", "admin", "editor"].includes(workspaceRole);
  const canApprove = ["owner", "admin", "approver"].includes(workspaceRole);

  async function call(
    path: string,
    method: "PATCH" | "POST",
    body: Record<string, unknown>,
    action: string,
  ) {
    setPending(action);
    setError("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          payload?.error?.message ?? "The retention action could not be completed.",
        );
        return;
      }
      setReason("");
      setCaseReference("");
      setRequestNote("");
      setDecisionNote("");
      router.refresh();
    } catch {
      setError("The retention action could not reach the server.");
    } finally {
      setPending("");
    }
  }

  return (
    <section className="resource-panel retention-class-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Data lifecycle</p>
          <h2>Conversation retention and legal hold</h2>
          <p>
            Class controls eligibility. Erasure and legal-hold release each
            require a separate approved workflow.
          </p>
        </div>
        <ShieldCheck size={21} aria-hidden="true" />
      </div>

      {!activeHold ? (
        <>
          <div className="retention-class-controls">
            <RetentionClassField
              value={retentionClass}
              onChange={setRetentionClass}
            />
            {canWrite && (
              <button
                className="button-secondary"
                disabled={Boolean(pending) || retentionClass === value}
                onClick={() =>
                  call(
                    `/api/v1/conversations/${threadId}/retention-class`,
                    "PATCH",
                    { workspaceId, retentionClass },
                    "class",
                  )
                }
                type="button"
              >
                {pending === "class" ? "Saving…" : "Save retention class"}
              </button>
            )}
          </div>
          {canApprove && (
            <div className="retention-class-controls legal-hold-placement">
              <label className="field">
                <span>Legal-hold reason</span>
                <input
                  maxLength={1000}
                  minLength={3}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Case reference (optional)</span>
                <input
                  maxLength={200}
                  value={caseReference}
                  onChange={(event) => setCaseReference(event.target.value)}
                />
              </label>
              <button
                className="button-secondary"
                disabled={Boolean(pending) || reason.trim().length < 3}
                onClick={() =>
                  call(
                    `/api/v1/conversations/${threadId}/legal-holds`,
                    "POST",
                    {
                      workspaceId,
                      reason,
                      caseReference: caseReference.trim() || undefined,
                    },
                    "hold",
                  )
                }
                type="button"
              >
                {pending === "hold" ? "Placing…" : "Place legal hold"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="legal-hold-case">
          <strong>Active legal hold</strong>
          <p>{activeHold.reason}</p>
          {activeHold.caseReference && <p>Case: {activeHold.caseReference}</p>}
          <small>
            Placed by {activeHold.placedByDisplayName} on{" "}
            {formatDate(activeHold.placedAt)}.
          </small>

          {!releaseRequest && canWrite && (
            <div className="retention-class-controls">
              <RetentionClassField
                label="Class after approved release"
                value={retentionClass}
                onChange={setRetentionClass}
              />
              <label className="field">
                <span>Release request note</span>
                <input
                  maxLength={1000}
                  minLength={3}
                  value={requestNote}
                  onChange={(event) => setRequestNote(event.target.value)}
                />
              </label>
              <button
                className="button-secondary"
                disabled={Boolean(pending) || requestNote.trim().length < 3}
                onClick={() =>
                  call(
                    `/api/v1/conversation-legal-holds/${activeHold.id}/release-requests`,
                    "POST",
                    {
                      workspaceId,
                      targetRetentionClass: retentionClass,
                      requestNote,
                    },
                    "release-request",
                  )
                }
                type="button"
              >
                {pending === "release-request"
                  ? "Requesting…"
                  : "Request hold release"}
              </button>
            </div>
          )}

          {releaseRequest && (
            <div className="legal-hold-release-request">
              <p>
                Release to {label(releaseRequest.targetRetentionClass)} requested
                by {releaseRequest.requestedByDisplayName}.
              </p>
              {canApprove && releaseRequest.requestedBy !== currentUserId ? (
                <div className="retention-class-controls">
                  <label className="field">
                    <span>Decision note</span>
                    <input
                      maxLength={1000}
                      minLength={3}
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.target.value)}
                    />
                  </label>
                  <button
                    className="button-secondary"
                    disabled={Boolean(pending) || decisionNote.trim().length < 3}
                    onClick={() =>
                      call(
                        `/api/v1/conversation-legal-hold-release-requests/${releaseRequest.id}/decision`,
                        "POST",
                        { workspaceId, decision: "reject", decisionNote },
                        "reject",
                      )
                    }
                    type="button"
                  >
                    {pending === "reject" ? "Rejecting…" : "Reject release"}
                  </button>
                  <button
                    className="button-primary"
                    disabled={Boolean(pending) || decisionNote.trim().length < 3}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Release this legal hold? Retention eligibility may resume.",
                        )
                      ) {
                        void call(
                          `/api/v1/conversation-legal-hold-release-requests/${releaseRequest.id}/decision`,
                          "POST",
                          { workspaceId, decision: "approve", decisionNote },
                          "approve",
                        );
                      }
                    }}
                    type="button"
                  >
                    {pending === "approve" ? "Approving…" : "Approve release"}
                  </button>
                </div>
              ) : (
                <small>A different workspace approver must decide this release.</small>
              )}
            </div>
          )}
        </div>
      )}

      {updatedAt && (
        <p className="form-note">Retention last changed {formatDate(updatedAt)}</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function RetentionClassField({
  label: fieldLabel = "Retention class",
  value,
  onChange,
}: {
  label?: string;
  value: StandardRetentionClass;
  onChange: (value: StandardRetentionClass) => void;
}) {
  return (
    <label className="field">
      <span>{fieldLabel}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as StandardRetentionClass)}
      >
        {STANDARD_CLASSES.map((item) => (
          <option key={item} value={item}>
            {label(item)}
          </option>
        ))}
      </select>
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
