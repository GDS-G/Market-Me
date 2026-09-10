"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAMPAIGN_METRIC_TYPES,
  CAMPAIGN_STEP_TYPES,
  EXECUTION_METHODS,
  SCHEDULE_TYPES,
  PROVIDER_AGGREGATE_METRIC_TYPES,
  MAX_DEPENDENCY_DELAY_SECONDS,
  type CampaignMetricType,
  type CampaignStepType,
} from "@market-me/domain";
import type {
  StoredAudienceProfile,
  StoredBrandProfile,
  StoredCampaign,
  StoredCampaignPreviewOption,
  StoredContentPackage,
  StoredDestination,
} from "@market-me/database";
import { CampaignPreviewPicker } from "@/components/campaign-preview-picker";
import { serializeStepDraft, toStepDraft, type StepDraft } from "./campaign-step-form";

type CriterionDraft = {
  id: string;
  eventType: CampaignMetricType;
  metric: "count" | "value";
  targetCount: number;
  targetValue: number;
  currency: string;
};
const newStep = (id: string): StepDraft => ({
  id: `step_${id.replaceAll("-", "").slice(0, 8)}`,
  name: "Manual handoff",
  operationType: "manual_handoff",
  capability: "manual.handoff",
  dependsOn: "",
  dependencyDelaySeconds: 0,
  approvalRequired: true,
  scheduleType: "immediate",
  scheduledAt: "",
  preferredWindowStart: "",
  preferredWindowEnd: "",
  condition: "{}",
  executionMethods: ["manual_handoff"],
  optional: false,
  maxAttempts: 3,
  timeoutSeconds: 300,
  inputs: "{}",
  outputs: "{}",
});
const newCriterion = (id: string): CriterionDraft => ({
  id: `goal_${id.replaceAll("-", "").slice(0, 8)}`,
  eventType: "destination_visit",
  metric: "count",
  targetCount: 1,
  targetValue: 1,
  currency: "USD",
});
const isProviderAggregateMetric = (type: CampaignMetricType) =>
  (PROVIDER_AGGREGATE_METRIC_TYPES as readonly string[]).includes(type);

export function CampaignForm({
  workspaceId,
  stepSeed,
  campaign,
  packages,
  destinations,
  brandProfiles = [],
  audienceProfiles = [],
  channelConnections: _channelConnections = [],
  previewOptions = [],
}: {
  workspaceId: string;
  stepSeed: string;
  campaign?: StoredCampaign;
  packages: readonly StoredContentPackage[];
  destinations: readonly StoredDestination[];
  brandProfiles?: readonly StoredBrandProfile[];
  audienceProfiles?: readonly StoredAudienceProfile[];
  channelConnections?: readonly {
    id: string;
    name: string;
    provider: string;
  }[];
  previewOptions?: readonly StoredCampaignPreviewOption[];
}) {
  void _channelConnections;
  const router = useRouter();
  const version = campaign?.draftVersion ?? campaign?.currentVersion;
  const [values, setValues] = useState({
    name: campaign?.name ?? "",
    description: campaign?.description ?? "",
    objective: version?.objective ?? "awareness",
    destinationId: version?.destinationId ?? "",
    brandProfileVersionId: version?.brandProfileVersionId ?? "",
    audienceProfileVersionIds: [...(version?.audienceProfileVersionIds ?? [])],
    informationDepth: version?.informationDepth ?? "contextual",
    promotionalStrength: version?.promotionalStrength ?? "standard",
    autonomyMode: version?.autonomyMode ?? "approval_required",
    timezone:
      version?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    context: JSON.stringify(version?.context ?? {}, null, 2),
    contentPackageIds: [...(version?.contentPackageIds ?? [])],
    successCriteria: (version?.successCriteria ?? []).map(
      (criterion): CriterionDraft =>
        criterion.metric === "value"
          ? { ...criterion, targetCount: 1 }
          : { ...criterion, metric: "count", targetValue: 1, currency: "USD" },
    ),
    successAction: version?.successAction ?? "notify_only",
    steps: version?.steps.map(toStepDraft) ?? [newStep(stepSeed)],
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const set = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));
  const updateStep = (index: number, patch: Partial<StepDraft>) =>
    setValues((current) => ({
      ...current,
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    }));
  const updateCriterion = (index: number, patch: Partial<CriterionDraft>) =>
    setValues((current) => ({
      ...current,
      successCriteria: current.successCriteria.map((criterion, position) =>
        position === index ? { ...criterion, ...patch } : criterion,
      ),
    }));
  function body() {
    return {
      workspaceId,
      name: values.name,
      description: values.description,
      objective: values.objective,
      contentPackageIds: values.contentPackageIds,
      destinationId: values.destinationId || undefined,
      brandProfileVersionId: values.brandProfileVersionId || undefined,
      audienceProfileVersionIds: values.audienceProfileVersionIds,
      informationDepth: values.informationDepth,
      promotionalStrength: values.promotionalStrength,
      autonomyMode: values.autonomyMode,
      timezone: values.timezone,
      context: JSON.parse(values.context),
      successCriteria: values.successCriteria.map((criterion) =>
        criterion.metric === "value"
          ? {
              id: criterion.id,
              eventType: criterion.eventType,
              metric: "value" as const,
              targetValue: criterion.targetValue,
              currency: criterion.currency.toUpperCase(),
            }
          : {
              id: criterion.id,
              eventType: criterion.eventType,
              metric: "count" as const,
              targetCount: criterion.targetCount,
            },
      ),
      successAction: values.successAction,
      steps: values.steps.map(serializeStepDraft),
    };
  }
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    let request;
    try {
      request = body();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check the campaign JSON, UTC schedule times, and dependency delay.");
      setPending(false);
      return false;
    }
    const response = await fetch(
      campaign ? `/api/v1/campaigns/${campaign.id}` : "/api/v1/campaigns",
      {
        method: campaign ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not save the campaign.");
      return false;
    }
    if (!campaign) router.push(`/campaigns/${payload.data.id}/edit`);
    setMessage("Campaign draft saved.");
    router.refresh();
    return true;
  }
  async function action(kind: "publish" | "activate") {
    if (!campaign || (kind === "publish" && !(await save()))) return;
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/v1/campaigns/${campaign.id}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok)
      setError(payload?.error?.message ?? `Could not ${kind} campaign.`);
    else
      setMessage(
        kind === "publish"
          ? `Published version ${payload.data.currentVersion.versionNumber}.`
          : "The currently published campaign version was queued for the durable workflow worker. Unsaved draft edits were not activated.",
      );
    router.refresh();
  }
  return (
    <form className="resource-form" onSubmit={save}>
      <section className="form-section">
        <div>
          <h2>Campaign intent</h2>
          <p>
            Version the objective, approved packages, destination, controls, and
            timezone.
          </p>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Name</span>
            <input
              required
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Objective</span>
            <select
              value={values.objective}
              onChange={(e) => set("objective", e.target.value)}
            >
              <option value="awareness">Awareness</option>
              <option value="website_traffic">Website traffic</option>
              <option value="lead_generation">Lead generation</option>
              <option value="sales">Sales</option>
              <option value="registrations">Registrations</option>
              <option value="fundraising">Fundraising</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="field field-wide">
            <span>Description</span>
            <textarea
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Destination</span>
            <select
              value={values.destinationId}
              onChange={(e) => set("destinationId", e.target.value)}
            >
              <option value="">No campaign destination</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Timezone</span>
            <input
              value={values.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Brand Profile version</span>
            <select
              value={values.brandProfileVersionId}
              onChange={(e) => set("brandProfileVersionId", e.target.value)}
            >
              <option value="">No Brand Profile</option>
              {values.brandProfileVersionId &&
                !brandProfiles.some(
                  (profile) =>
                    profile.currentVersion?.id === values.brandProfileVersionId,
                ) && (
                  <option value={values.brandProfileVersionId}>
                    Pinned historical version
                  </option>
                )}
              {brandProfiles
                .filter((profile) => profile.currentVersion)
                .map((profile) => (
                  <option
                    key={profile.currentVersion!.id}
                    value={profile.currentVersion!.id}
                  >
                    {profile.name} · v{profile.currentVersion!.versionNumber}
                  </option>
                ))}
            </select>
          </label>
          <div className="field">
            <span>Audience Profile versions</span>
            {values.audienceProfileVersionIds
              .filter(
                (id) =>
                  !audienceProfiles.some(
                    (profile) => profile.currentVersion?.id === id,
                  ),
              )
              .map((id) => (
                <label className="checkbox-row" key={id}>
                  <input
                    type="checkbox"
                    checked
                    onChange={(event) =>
                      !event.target.checked &&
                      set(
                        "audienceProfileVersionIds",
                        values.audienceProfileVersionIds.filter(
                          (candidate) => candidate !== id,
                        ),
                      )
                    }
                  />
                  Pinned historical version
                </label>
              ))}
            {audienceProfiles
              .filter((profile) => profile.currentVersion)
              .map((profile) => (
                <label
                  className="checkbox-row"
                  key={profile.currentVersion!.id}
                >
                  <input
                    type="checkbox"
                    checked={values.audienceProfileVersionIds.includes(
                      profile.currentVersion!.id,
                    )}
                    onChange={(event) =>
                      set(
                        "audienceProfileVersionIds",
                        event.target.checked
                          ? [
                              ...values.audienceProfileVersionIds,
                              profile.currentVersion!.id,
                            ]
                          : values.audienceProfileVersionIds.filter(
                              (id) => id !== profile.currentVersion!.id,
                            ),
                      )
                    }
                  />
                  {profile.name} · v{profile.currentVersion!.versionNumber}
                </label>
              ))}
          </div>
          <label className="field">
            <span>Information depth</span>
            <select
              value={values.informationDepth}
              onChange={(e) => set("informationDepth", e.target.value)}
            >
              <option value="minimal">Minimal</option>
              <option value="teaser">Teaser</option>
              <option value="contextual">Contextual</option>
              <option value="detailed">Detailed</option>
              <option value="comprehensive">Comprehensive</option>
            </select>
          </label>
          <label className="field">
            <span>Promotional strength</span>
            <select
              value={values.promotionalStrength}
              onChange={(e) => set("promotionalStrength", e.target.value)}
            >
              <option value="informational">Informational</option>
              <option value="subtle">Subtle</option>
              <option value="light">Light</option>
              <option value="standard">Standard</option>
              <option value="strong">Strong</option>
            </select>
          </label>
          <label className="field">
            <span>Autonomy</span>
            <select
              value={values.autonomyMode}
              onChange={(e) => set("autonomyMode", e.target.value)}
            >
              <option value="draft_only">Draft only</option>
              <option value="approval_required">Approval every action</option>
              <option value="campaign_approval">Approve campaign</option>
              <option value="fully_autonomous">Fully autonomous</option>
              <option value="approve_uncertain">Approve uncertain (review required)</option>
              <option value="approve_first_occurrence">Approve first occurrence (review required)</option>
              <option value="confidence_based">Confidence based (review required)</option>
              <option value="custom">Custom (explicit step gates)</option>
            </select>
            <small>Draft only cannot activate. Confidence and history-based modes retain review until supporting evidence is implemented. Explicit step approvals are never waived.</small>
          </label>
          <label className="field field-wide">
            <span>Campaign context (JSON)</span>
            <textarea
              value={values.context}
              onChange={(e) => set("context", e.target.value)}
            />
          </label>
          <div className="field field-wide">
            <span>Approved Content Packages</span>
            {packages.length ? (
              packages.map((item) => (
                <label className="checkbox-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={values.contentPackageIds.includes(item.id)}
                    onChange={(event) =>
                      set(
                        "contentPackageIds",
                        event.target.checked
                          ? [...values.contentPackageIds, item.id]
                          : values.contentPackageIds.filter(
                              (id) => id !== item.id,
                            ),
                      )
                    }
                  />
                  {item.title}
                </label>
              ))
            ) : (
              <p>
                No approved packages are available. Campaigns without a package
                are valid for manual workflows.
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="form-section">
        <div>
          <h2>Success criteria</h2>
          <p>
            Version auditable event-count or exact-currency value goals with the
            Campaign. Measurements never change the approved definition.
          </p>
        </div>
        <div className="field-grid">
          <label className="field field-wide">
            <span>When every success criterion is met</span>
            <select
              value={values.successAction}
              onChange={(event) => set("successAction", event.target.value)}
            >
              <option value="notify_only">Notify workflow only</option>
              <option value="pause">Pause before future workflow steps</option>
            </select>
            <small>
              Pausing is durable and resumable. It does not cancel work already
              in flight or mark the Campaign complete.
            </small>
          </label>
          {values.successCriteria.map((criterion, index) => (
            <div className="form-subsection field-wide" key={criterion.id}>
              <label className="field">
                <span>Criterion ID</span>
                <input
                  required
                  pattern="[a-z][a-z0-9_-]*"
                  value={criterion.id}
                  onChange={(event) =>
                    updateCriterion(index, { id: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Measured signal</span>
                <select
                  value={criterion.eventType}
                  onChange={(event) =>
                    updateCriterion(index, {
                      eventType: event.target.value as CampaignMetricType,
                      ...(isProviderAggregateMetric(event.target.value as CampaignMetricType)
                        ? { metric: "count" as const }
                        : {}),
                    })
                  }
                >
                  {CAMPAIGN_METRIC_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Metric</span>
                <select
                  value={criterion.metric}
                  onChange={(event) =>
                    updateCriterion(index, {
                      metric: event.target.value as CriterionDraft["metric"],
                    })
                  }
                >
                  <option value="count">Event count</option>
                  <option value="value" disabled={isProviderAggregateMetric(criterion.eventType)}>
                    Exact-currency value
                  </option>
                </select>
              </label>
              {criterion.metric === "count" ? (
                <label className="field">
                  <span>{isProviderAggregateMetric(criterion.eventType) ? "Target aggregate total" : "Target event count"}</span>
                  <input
                    required
                    type="number"
                    min={1}
                    max={1000000000}
                    value={criterion.targetCount}
                    onChange={(event) =>
                      updateCriterion(index, {
                        targetCount: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Target value</span>
                    <input
                      required
                      type="number"
                      min="0.000001"
                      max={1000000000000}
                      step="0.000001"
                      value={criterion.targetValue}
                      onChange={(event) =>
                        updateCriterion(index, {
                          targetValue: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Currency</span>
                    <input
                      required
                      minLength={3}
                      maxLength={3}
                      pattern="[A-Z]{3}"
                      value={criterion.currency}
                      onChange={(event) =>
                        updateCriterion(index, {
                          currency: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                </>
              )}
              <button
                className="button-secondary"
                type="button"
                onClick={() =>
                  set(
                    "successCriteria",
                    values.successCriteria.filter(
                      (_, position) => position !== index,
                    ),
                  )
                }
              >
                Remove criterion
              </button>
            </div>
          ))}
          <button
            className="button-secondary"
            type="button"
            disabled={values.successCriteria.length >= 20}
            onClick={() =>
              set("successCriteria", [
                ...values.successCriteria,
                newCriterion(crypto.randomUUID()),
              ])
            }
          >
            Add success criterion
          </button>
        </div>
      </section>
      <section className="form-section">
        <div>
          <h2>Workflow graph</h2>
          <p>
            Dependencies create ordered or parallel branches. Step IDs are
            stable workflow keys.
          </p>
        </div>
        <div className="field-grid">
          {values.steps.map((step, index) => (
            <div className="form-subsection field-wide" key={step.id}>
              <label className="field">
                <span>Step ID</span>
                <input
                  required
                  pattern="[a-z][a-z0-9_-]*"
                  value={step.id}
                  onChange={(e) => updateStep(index, { id: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  required
                  value={step.name}
                  onChange={(e) => updateStep(index, { name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Operation</span>
                <select
                  value={step.operationType}
                  onChange={(e) =>
                    updateStep(index, {
                      operationType: e.target.value as CampaignStepType,
                    })
                  }
                >
                  {CAMPAIGN_STEP_TYPES.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Capability</span>
                <input
                  required
                  value={step.capability}
                  onChange={(e) =>
                    updateStep(index, { capability: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Dependencies, comma separated</span>
                <input
                  value={step.dependsOn}
                  onChange={(e) =>
                    updateStep(index, { dependsOn: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Delay after dependencies (seconds)</span>
                <input type="number" required min={0} max={MAX_DEPENDENCY_DELAY_SECONDS} step={1}
                  value={Number.isNaN(step.dependencyDelaySeconds) ? "" : step.dependencyDelaySeconds}
                  onChange={(event) => updateStep(index, { dependencyDelaySeconds: event.target.valueAsNumber })} />
                <small>Zero adds no delay. A positive value requires dependencies and starts from each predecessor&apos;s first recorded success or partial success, not from when this form is saved. Campaigns combining bounded scheduling with companion execution remain saved-only.</small>
              </label>
              <label className="field">
                <span>Schedule</span>
                <select
                  value={step.scheduleType}
                  onChange={(e) =>
                    updateStep(index, { scheduleType: e.target.value as StepDraft["scheduleType"] })
                  }
                >
                  <option value="immediate">Immediate</option>
                  <option value="dependency">After dependencies</option>
                  <option value="exact_time">Exact time</option>
                  <option value="preferred_window">Preferred request-start window</option>
                  {SCHEDULE_TYPES.filter((kind) => !["immediate", "dependency", "exact_time", "preferred_window"].includes(kind)).map((kind) => (
                    <option key={kind} value={kind}>{kind.replaceAll("_", " ")} (plan only)</option>
                  ))}
                </select>
                {!["immediate", "dependency", "exact_time", "preferred_window"].includes(step.scheduleType) && <small>This plan can be saved, but cannot activate until this scheduling mode is implemented.</small>}
              </label>
              {step.scheduleType === "exact_time" && (
                <label className="field">
                  <span>Exact time (UTC)</span>
                  <input
                    type="datetime-local"
                    required
                    step="0.001"
                    value={step.scheduledAt}
                    onChange={(e) =>
                      updateStep(index, { scheduledAt: e.target.value })
                    }
                  />
                </label>
              )}
              {step.scheduleType === "preferred_window" && (["preferredWindowStart", "preferredWindowEnd"] as const).map((field) => (
                <label className="field" key={field}>
                  <span>{field === "preferredWindowStart" ? "Window start (UTC)" : "Window end (UTC)"}</span>
                  <input type="datetime-local" step="0.001" required value={step[field]} onChange={(event) => updateStep(index, { [field]: event.target.value })} />
                </label>
              ))}
              {step.scheduleType === "preferred_window" && <p className="field-wide">The request-start range includes its start and excludes its end. Supported only for text-only Discord, Slack, or Mastodon with official API execution and no fallback. Dependencies and approvals still apply; missing the window requires cancellation and a newly reviewed plan. Provider completion time is not guaranteed. Recurrence, collision resolution, and pacing are not implemented.</p>}
              <label className="field field-wide">
                <span>Schedule condition (JSON; saved plan)</span>
                <textarea value={step.condition} onChange={(event) => updateStep(index, { condition: event.target.value })} />
                <small>Advanced conditions are preserved. They do not enable unsupported schedule execution.</small>
              </label>
              <fieldset className="field field-wide">
                <legend>Allowed execution methods</legend>
                {EXECUTION_METHODS.map((method) => <label className="checkbox-row" key={method}>
                  <input type="checkbox" checked={step.executionMethods.includes(method)} onChange={(event) => updateStep(index, {
                    executionMethods: event.target.checked ? [...step.executionMethods, method] : step.executionMethods.filter((value) => value !== method),
                  })} />
                  {method.replaceAll("_", " ")}
                </label>)}
              </fieldset>
              <label className="field">
                <span>Maximum attempts</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={step.maxAttempts}
                  onChange={(e) =>
                    updateStep(index, { maxAttempts: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Timeout seconds</span>
                <input
                  type="number"
                  min={1}
                  value={step.timeoutSeconds}
                  onChange={(e) =>
                    updateStep(index, {
                      timeoutSeconds: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={step.approvalRequired}
                  onChange={(e) =>
                    updateStep(index, { approvalRequired: e.target.checked })
                  }
                />
                Approval required
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={step.optional} onChange={(event) => updateStep(index, { optional: event.target.checked })} />
                Optional step (may be skipped after rejection)
              </label>
              {step.operationType === "publish_content" && (
                <CampaignPreviewPicker
                  options={previewOptions}
                  destinationId={values.destinationId}
                  inputJson={step.inputs}
                  onInputJsonChange={(inputs) => updateStep(index, { inputs })}
                />
              )}
              <label className="field field-wide">
                <span>Advanced inputs (JSON)</span>
                <textarea
                  value={step.inputs}
                  onChange={(e) =>
                    updateStep(index, { inputs: e.target.value })
                  }
                />
                <small>
                  Exact previews cannot be combined with Destination append,
                  tracked-link substitution, or a different Channel Connection.
                </small>
              </label>
              <label className="field field-wide">
                <span>Output contract (JSON)</span>
                <textarea
                  value={step.outputs}
                  onChange={(e) =>
                    updateStep(index, { outputs: e.target.value })
                  }
                />
              </label>
              {values.steps.length > 1 && (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() =>
                    set(
                      "steps",
                      values.steps.filter((_, position) => position !== index),
                    )
                  }
                >
                  Remove step
                </button>
              )}
            </div>
          ))}
          <button
            className="button-secondary"
            type="button"
            onClick={() =>
              set("steps", [...values.steps, newStep(crypto.randomUUID())])
            }
          >
            Add workflow step
          </button>
        </div>
      </section>
      <div className="form-actions">
        <button className="button-secondary" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </button>
        {campaign && (
          <button
            className="button-secondary"
            type="button"
            disabled={pending}
            onClick={() => action("publish")}
          >
            Publish version
          </button>
        )}
        {campaign?.currentVersion && (
          <button
            className="button-primary"
            type="button"
            disabled={pending}
            onClick={() => action("activate")}
          >
            Activate campaign
          </button>
        )}
        {message && <p className="form-success">{message}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
