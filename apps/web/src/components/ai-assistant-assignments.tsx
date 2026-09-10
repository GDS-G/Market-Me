"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AiAssistantAction,
  AiAssistantCostPreview,
  AiAssistantProfile,
  AiAssistantProfileId,
  AiAssistantSelection,
  AiAssistantWorkPlan,
} from "@market-me/domain";

export function AiAssistantAssignments({
  workspaceId,
  profiles,
  selections,
  automaticSelections,
  workPlans,
  costPreviews,
  canEdit,
}: {
  workspaceId: string;
  profiles: readonly AiAssistantProfile[];
  selections: readonly AiAssistantSelection[];
  automaticSelections: readonly AiAssistantSelection[];
  workPlans: readonly AiAssistantWorkPlan[];
  costPreviews: readonly AiAssistantCostPreview[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<AiAssistantAction, string>>(
    Object.fromEntries(
      selections.map((selection) => [
        selection.action,
        selection.automatic ? "" : selection.profile.id,
      ]),
    ) as Record<AiAssistantAction, string>,
  );
  const [pending, setPending] = useState(false);
  const [quotePendingAction, setQuotePendingAction] =
    useState<AiAssistantAction>();
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await fetch("/api/v1/ai-assistant-assignments", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        assignments: Object.entries(values)
          .filter(([, profileId]) => profileId)
          .map(([action, profileId]) => ({ action, profileId })),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(
        body?.error?.message ?? "Could not save the assistant assignments.",
      );
      return;
    }
    setMessage("Assistant assignments saved.");
    router.refresh();
  }

  async function createQuote(
    preview: Extract<AiAssistantCostPreview, { status: "quoted" }>,
  ) {
    setQuotePendingAction(preview.action);
    setMessage("");
    const response = await fetch("/api/v1/ai-assistant-cost-quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        action: preview.action,
        rateCardId: preview.rateCardId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setQuotePendingAction(undefined);
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Could not create the durable quote.");
      return;
    }
    setMessage(`Durable quote ${body.data.id} created.`);
    router.refresh();
  }

  return (
    <form className="resource-panel ai-assistant-panel" onSubmit={submit}>
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">Governed role selection</p>
          <h2>AI assistants</h2>
          <p>
            Automatic is the default. A workspace choice changes the role presented for an action, never provider or execution authority. Currency previews use closed server-owned metering profiles and exact effective rate cards.
          </p>
        </div>
        <span className="status-pill status-green">
          {Object.values(values).some(Boolean) ? "Workspace choices" : "Automatic"}
        </span>
      </div>
      <div className="ai-assistant-grid">
        {selections.map((selection) => {
          const automatic = automaticSelections.find(
            (item) => item.action === selection.action,
          )!;
          const workPlan = workPlans.find(
            (item) => item.selection.action === selection.action,
          )!;
          const costPreview = costPreviews.find(
            (item) => item.action === selection.action,
          )!;
          const compatible = profiles.filter(
            (profile) =>
              profile.actions.includes(selection.action) &&
              profile.capabilities.includes(selection.requiredCapability),
          );
          const selectedId = values[selection.action] as
            | AiAssistantProfileId
            | "";
          const selectedProfile =
            profiles.find((profile) => profile.id === selectedId) ??
            automatic.profile;
          return (
            <article key={selection.action}>
              <div>
                <p className="eyebrow">{label(selection.action)}</p>
                <h3>{selectedProfile.displayName}</h3>
                <p>{selectedProfile.purpose}</p>
              </div>
              <label className="field">
                <span>Assistant</span>
                <select
                  disabled={!canEdit || pending}
                  value={selectedId}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [selection.action]: event.target.value,
                    }))
                  }
                >
                  <option value="">Automatic — {automatic.profile.displayName}</option>
                  {compatible.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                {label(selection.requiredCapability)} · {selectedProfile.outputKinds.map(label).join(" · ")}
              </small>
              <div className="ai-assistant-readiness">
                <span className={`status-pill ${workPlan.status === "ready" ? "status-green" : "status-amber"}`}>
                  {workPlan.status === "ready"
                    ? `Ready · ${label(workPlan.estimatedCost!)} cost`
                    : "Not configured"}
                </span>
                <small>
                  {costPreview.status === "quoted"
                    ? `${formatQuote(costPreview)} planning quote - ${costPreview.reasons[0]}`
                    : costPreview.reasons[0] ?? workPlan.reasons[0]}
                </small>
              </div>
              {canEdit && costPreview.status === "quoted" && (
                <button
                  className="button-secondary"
                  disabled={Boolean(quotePendingAction) || pending}
                  onClick={() => createQuote(costPreview)}
                  type="button"
                >
                  {quotePendingAction === selection.action
                    ? "Creating quote..."
                    : "Create durable quote"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      <p className="ai-selection-summary">
        Every assistant is presentation and planning only. Privacy, evidence, permissions, budgets, approvals, and connector capability are still validated by deterministic services.
      </p>
      {canEdit && (
        <button className="button-primary" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save assistant assignments"}
        </button>
      )}
      {message && (
        <p className={message.includes("saved") || message.includes("created") ? "form-success" : "form-error"} role="status">
          {message}
        </p>
      )}
    </form>
  );
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatQuote(
  preview: Extract<AiAssistantCostPreview, { status: "quoted" }>,
) {
  const divisor = 10 ** preview.minorUnitExponent;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: preview.currency,
    minimumFractionDigits: preview.minorUnitExponent,
    maximumFractionDigits: preview.minorUnitExponent,
  });
  const minimum = formatter.format(preview.minimumCostMinor / divisor);
  const maximum = formatter.format(preview.maximumCostMinor / divisor);
  return minimum === maximum ? minimum : `${minimum}-${maximum}`;
}
