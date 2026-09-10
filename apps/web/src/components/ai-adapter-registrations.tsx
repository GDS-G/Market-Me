"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiWorkspaceAdapterCandidate,
  AiWorkspaceAdapterRegistration,
} from "@market-me/domain";

interface AiAdapterRegistrationsProps {
  workspaceId: string;
  candidates: readonly AiWorkspaceAdapterCandidate[];
  registrations: readonly AiWorkspaceAdapterRegistration[];
  canManage: boolean;
}

export function AiAdapterRegistrations({
  workspaceId,
  candidates,
  registrations,
  canManage,
}: AiAdapterRegistrationsProps) {
  const router = useRouter();
  const registeredCandidateIds = useMemo(
    () => new Set(
      registrations
        .filter((registration) => registration.status === "registered")
        .map((registration) => registration.candidateId),
    ),
    [registrations],
  );
  const eligibleCandidates = candidates.filter(
    (candidate) =>
      candidate.status === "approved" && !registeredCandidateIds.has(candidate.id),
  );
  const [candidateId, setCandidateId] = useState("");
  const [retirementReasons, setRetirementReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();

  async function register() {
    if (!candidateId) return;
    setPending("register");
    setMessage(undefined);
    const response = await fetch("/api/v1/ai-adapter-registrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, candidateId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not register the candidate for deployment staging.",
      });
      return;
    }
    setCandidateId("");
    setMessage({
      kind: "success",
      text: "Candidate registered in tenant-scoped deployment staging; routing remains disabled.",
    });
    router.refresh();
  }

  async function retire(registration: AiWorkspaceAdapterRegistration) {
    setPending(registration.id);
    setMessage(undefined);
    const response = await fetch(
      `/api/v1/ai-adapter-registrations/${registration.id}/retire`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          retirementReason: retirementReasons[registration.id] ?? "",
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setPending("");
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: body?.error?.message ?? "Could not retire the deployment registration.",
      });
      return;
    }
    setMessage({
      kind: "success",
      text: "Deployment registration retired; routing and execution remain disabled.",
    });
    router.refresh();
  }

  return (
    <section className="resource-panel ai-adapter-registration-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Tenant-scoped deployment staging</p>
          <h2>Workspace adapter registrations</h2>
          <p>
            Registration snapshots approved evidence for a later deployment review. It does not
            add the model to routing, configure invocation, bind pricing, or authorize execution.
          </p>
        </div>
        <span className="status-pill status-amber">Unavailable</span>
      </div>

      {canManage && (
        <div className="ai-adapter-registration-form">
          <label className="field">
            <span>Approved candidate</span>
            <select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
              <option value="">Choose approved evidence</option>
              {eligibleCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.provider} / {candidate.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button-primary"
            type="button"
            disabled={!candidateId || pending === "register"}
            onClick={register}
          >
            {pending === "register" ? "Registering..." : "Register for deployment staging"}
          </button>
        </div>
      )}

      <div className="ai-adapter-registration-list">
        {registrations.length === 0 ? (
          <p>No workspace adapter has been registered for deployment staging.</p>
        ) : (
          registrations.map((registration) => (
            <article className="metric-card" key={registration.id}>
              <div>
                <strong>{registration.displayName}</strong>
                <p>{registration.provider} / {registration.modelId}</p>
                <small>
                  {registration.status} &middot; {registration.capabilities.map(formatCapability).join(", ")}
                  {" "}&middot; cloud &middot; paid reservation required
                </small>
                <small>Unavailable &middot; no invocation adapter &middot; routing disabled</small>
                {registration.retirementReason && (
                  <small>Retirement: {registration.retirementReason}</small>
                )}
              </div>
              {canManage && registration.status === "registered" && (
                <div className="ai-provider-connection-actions">
                  <label className="field">
                    <span>Retirement reason</span>
                    <textarea
                      value={retirementReasons[registration.id] ?? ""}
                      maxLength={500}
                      onChange={(event) =>
                        setRetirementReasons((current) => ({
                          ...current,
                          [registration.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={pending === registration.id || !retirementReasons[registration.id]?.trim()}
                    onClick={() => retire(registration)}
                  >
                    Retire registration
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
      {message && (
        <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

function formatCapability(value: string) {
  return value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}
