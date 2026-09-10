import { parseScheduleInstant, validateCampaignExecution, validateCampaignGraph, type CampaignStep } from "@market-me/domain";
import type { StoredCampaignPreparation } from "./campaign-preparation-repository";
import type { CampaignDraftWrite } from "./models";
import type { ChannelProvider } from "./publishing-repository";

export const CAMPAIGN_FINALIZATION_COMPILER = "market-me:campaign-finalization";
export const CAMPAIGN_FINALIZATION_TEMPLATE_VERSION = 1;

/** Explicit absolute instants, normalized to UTC milliseconds; expiry is a later DB-clock check. */
export type CampaignFinalizationTiming =
  | { readonly type: "immediate" }
  | { readonly type: "exact_time"; readonly scheduledAt: string }
  | { readonly type: "preferred_window"; readonly start: string; readonly end: string };

export interface CampaignFinalizationTemplateInput {
  workspaceId: string;
  preparationId: string;
  expectedPlanningVersionId: string;
  draftId: string;
  expectedDraftVersionId: string;
  previewId: string;
  expectedPreviewFingerprint: string;
  timing: CampaignFinalizationTiming;
  templateVersion?: typeof CAMPAIGN_FINALIZATION_TEMPLATE_VERSION;
}

export interface NormalizedCampaignFinalizationInput {
  readonly templateVersion: typeof CAMPAIGN_FINALIZATION_TEMPLATE_VERSION;
  readonly workspaceId: string;
  readonly preparationId: string;
  readonly expectedPlanningVersionId: string;
  readonly draftId: string;
  readonly expectedDraftVersionId: string;
  readonly previewId: string;
  readonly expectedPreviewFingerprint: string;
  readonly timing: CampaignFinalizationTiming;
}

/**
 * Server-owned projection only, never accepted from the request. The caller must
 * authorize, lock, re-render, and verify current approval/route/fingerprint state
 * before supplying it. Matching these fields is a consistency check, not authority.
 */
export interface CampaignFinalizationTrustedPreview {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly sourceCampaignVersionId: string;
  readonly generationId: string;
  readonly previewId: string;
  readonly draftId: string;
  readonly draftVersionId: string;
  readonly channelConnectionId: string;
  readonly destinationId?: string | null;
  readonly fingerprint: string;
  readonly provider: ChannelProvider;
  readonly attachmentCount: number;
}

export interface CampaignFinalizationTrustedContext {
  readonly preparation: Pick<StoredCampaignPreparation,
    "id" | "workspaceId" | "campaignId" | "planningVersionId" | "generationId"
    | "contentPackageId" | "contentPackageVersion" | "configurationSnapshot" | "preparedDrafts">;
  readonly preview: CampaignFinalizationTrustedPreview;
}

export interface NormalizedCampaignFinalizationIntent {
  readonly normalizedInput: NormalizedCampaignFinalizationInput;
  /** Fixed-key server intent, domain separated from preparation and preview-snapshot hashes. */
  readonly canonicalPayload: string;
}

export interface CompiledCampaignFinalization extends NormalizedCampaignFinalizationIntent {
  readonly campaignId: string;
  readonly expectedPlanningVersionId: string;
  /** Ordinary executable draft definition; compilation does not publish or activate it. */
  readonly campaign: Readonly<CampaignDraftWrite>;
}

export interface CampaignFinalizationTemplateIssue {
  readonly field: string;
  readonly code: "invalid_input" | "unsupported_field" | "unsupported_template" | "invalid_reference"
    | "invalid_fingerprint" | "invalid_timing" | "lineage_mismatch" | "unsupported_preview" | "invalid_definition";
  readonly message: string;
}

export class CampaignFinalizationTemplateValidationError extends Error {
  readonly issues: readonly CampaignFinalizationTemplateIssue[];
  constructor(issue: CampaignFinalizationTemplateIssue) {
    super(issue.message);
    this.name = "CampaignFinalizationTemplateValidationError";
    this.issues = Object.freeze([Object.freeze(issue)]);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FINGERPRINT = /^mm-preview-v1:sha256:[0-9a-f]{64}$/u;
const INPUT_FIELDS = new Set(["workspaceId", "preparationId", "expectedPlanningVersionId", "draftId",
  "expectedDraftVersionId", "previewId", "expectedPreviewFingerprint", "timing", "templateVersion"]);
const TIMING_FIELDS = new Set(["type", "scheduledAt", "start", "end"]);
const MIN_INSTANT = Date.parse("0001-01-01T00:00:00.000Z");
const MAX_INSTANT = Date.parse("9999-12-31T23:59:59.999Z");

function invalid(field: string, code: CampaignFinalizationTemplateIssue["code"], message: string): never {
  throw new CampaignFinalizationTemplateValidationError({ field, code, message });
}

function record(value: unknown, field: string, fields: ReadonlySet<string>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(field, "invalid_input", "Provide an ordinary JSON object containing finalization settings.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.has(key)) {
      invalid(field, "unsupported_field", "The finalization contains an unsupported field.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) {
      invalid(field, "invalid_input", "Finalization settings must be ordinary JSON values.");
    }
  }
  return value as Record<string, unknown>;
}

function reference(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim().toLowerCase())) {
    invalid(field, "invalid_reference", "Choose a valid resource ID.");
  }
  return value.trim().toLowerCase();
}

function fingerprint(value: unknown): string {
  // No alias, case, or whitespace normalization: unknown contracts fail closed.
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    invalid("expectedPreviewFingerprint", "invalid_fingerprint", "Select an exact preview with a supported v1 fingerprint.");
  }
  return value;
}

function instant(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "invalid_timing", "Use an absolute ISO time with an explicit timezone.");
  try {
    const milliseconds = parseScheduleInstant(value.trim());
    if (milliseconds < MIN_INSTANT || milliseconds > MAX_INSTANT) throw new RangeError("Unsupported year");
    return new Date(milliseconds).toISOString();
  } catch {
    invalid(field, "invalid_timing", "Use a valid absolute ISO time in years 0001–9999, with at most millisecond precision.");
  }
}

function timing(value: unknown): CampaignFinalizationTiming {
  const raw = record(value, "timing", TIMING_FIELDS);
  if (raw.type === "immediate") {
    if (Reflect.ownKeys(raw).length !== 1) invalid("timing", "invalid_timing", "Immediate timing cannot include bounds.");
    return Object.freeze({ type: "immediate" });
  }
  if (raw.type === "exact_time") {
    if (Reflect.ownKeys(raw).some((key) => key !== "type" && key !== "scheduledAt")) {
      invalid("timing", "invalid_timing", "Exact-time timing accepts only its scheduled time.");
    }
    return Object.freeze({ type: "exact_time", scheduledAt: instant(raw.scheduledAt, "timing.scheduledAt") });
  }
  if (raw.type === "preferred_window") {
    if (Reflect.ownKeys(raw).some((key) => key !== "type" && key !== "start" && key !== "end")) {
      invalid("timing", "invalid_timing", "Preferred-window timing accepts only its start and end.");
    }
    const start = instant(raw.start, "timing.start"), end = instant(raw.end, "timing.end");
    if (parseScheduleInstant(start) >= parseScheduleInstant(end)) {
      invalid("timing.end", "invalid_timing", "A preferred request-start window requires its start before its exclusive end.");
    }
    return Object.freeze({ type: "preferred_window", start, end });
  }
  invalid("timing.type", "invalid_timing", "Choose immediate, exact-time, or preferred-window timing.");
}

/** Pure request validation can run before any database or credential lookup. */
export function normalizeCampaignFinalizationInput(input: unknown): NormalizedCampaignFinalizationIntent {
  const raw = record(input, "input", INPUT_FIELDS);
  if (raw.templateVersion !== undefined && raw.templateVersion !== CAMPAIGN_FINALIZATION_TEMPLATE_VERSION) {
    invalid("templateVersion", "unsupported_template", "This finalization template version is not supported.");
  }
  const normalizedInput: NormalizedCampaignFinalizationInput = Object.freeze({
    templateVersion: CAMPAIGN_FINALIZATION_TEMPLATE_VERSION,
    workspaceId: reference(raw.workspaceId, "workspaceId"),
    preparationId: reference(raw.preparationId, "preparationId"),
    expectedPlanningVersionId: reference(raw.expectedPlanningVersionId, "expectedPlanningVersionId"),
    draftId: reference(raw.draftId, "draftId"),
    expectedDraftVersionId: reference(raw.expectedDraftVersionId, "expectedDraftVersionId"),
    previewId: reference(raw.previewId, "previewId"),
    expectedPreviewFingerprint: fingerprint(raw.expectedPreviewFingerprint),
    timing: timing(raw.timing),
  });
  return Object.freeze({ normalizedInput,
    canonicalPayload: JSON.stringify({ compiler: CAMPAIGN_FINALIZATION_COMPILER, input: normalizedInput }) });
}

/**
 * Compile only from a separately supplied trusted projection. This creates no IDs,
 * current-time samples, database state, approvals, provider calls, or activation commands.
 * The caller must preserve durable proof requirements outside editable step inputs.
 */
export function compileCampaignFinalization(input: unknown, trusted: CampaignFinalizationTrustedContext): CompiledCampaignFinalization {
  const intent = normalizeCampaignFinalizationInput(input);
  const selected = intent.normalizedInput;
  const { preparation, preview } = trusted;
  const configuration = preparation.configurationSnapshot;
  if (selected.workspaceId !== preparation.workspaceId || selected.preparationId !== preparation.id
    || selected.expectedPlanningVersionId !== preparation.planningVersionId
    || preview.workspaceId !== preparation.workspaceId || preview.campaignId !== preparation.campaignId
    || preview.sourceCampaignVersionId !== preparation.planningVersionId || preview.generationId !== preparation.generationId
    || preview.previewId !== selected.previewId || preview.draftId !== selected.draftId
    || preview.draftVersionId !== selected.expectedDraftVersionId || preview.fingerprint !== selected.expectedPreviewFingerprint
    || preparation.preparedDrafts.filter((draft) => draft.draftId === selected.draftId).length !== 1
    || configuration.workspaceId !== preparation.workspaceId || configuration.contentPackageId !== preparation.contentPackageId
    || configuration.expectedPackageVersion !== preparation.contentPackageVersion
    || configuration.templateKey !== "general_announcement" || configuration.templateVersion !== 1
    || (preview.destinationId ?? undefined) !== configuration.destinationId) {
    invalid("previewId", "lineage_mismatch", "The selected preview must match the exact preparation, draft revision, fingerprint, and Destination.");
  }
  if (!UUID.test(preview.channelConnectionId) || preview.attachmentCount !== 0
    || !["discord_webhook", "slack_webhook", "mastodon_account"].includes(preview.provider)) {
    invalid("previewId", "unsupported_preview", "Finalization v1 requires a text-only Discord, Slack, or Mastodon preview on an explicitly selected connection.");
  }
  const schedule = selected.timing;
  const step: CampaignStep = Object.freeze({
    id: "publish_prepared_preview", name: "Publish reviewed preview", operationType: "publish_content",
    desiredCapability: "publish_content", dependsOn: Object.freeze([]), dependencyDelaySeconds: 0,
    inputs: Object.freeze({ draftChannelPreviewId: preview.previewId, draftChannelPreviewFingerprint: preview.fingerprint,
      channelConnectionId: preview.channelConnectionId }),
    outputs: Object.freeze({}), executionMethods: Object.freeze(["official_api"] as const), approvalRequired: true,
    scheduleType: schedule.type,
    ...(schedule.type === "exact_time" ? { scheduledAt: schedule.scheduledAt } : {}),
    ...(schedule.type === "preferred_window" ? { preferredWindowStart: schedule.start, preferredWindowEnd: schedule.end } : {}),
    condition: Object.freeze({}), maxAttempts: 3, timeoutSeconds: 300, optional: false,
  });
  const graph = validateCampaignGraph([step]);
  const executionIssues = validateCampaignExecution("approval_required", [step], { allowBoundedScheduling: true });
  if (!graph.valid || executionIssues.length) {
    invalid("timing", "invalid_definition", "The compiled finalization is not a supported executable campaign graph.");
  }
  const campaign: Readonly<CampaignDraftWrite> = Object.freeze({
    workspaceId: preparation.workspaceId, name: configuration.name, description: configuration.description,
    objective: "awareness", contentPackageIds: Object.freeze([preparation.contentPackageId]),
    ...(configuration.brandProfileVersionId ? { brandProfileVersionId: configuration.brandProfileVersionId } : {}),
    audienceProfileVersionIds: Object.freeze([...configuration.audienceProfileVersionIds]),
    ...(configuration.destinationId ? { destinationId: configuration.destinationId } : {}),
    informationDepth: configuration.informationDepth, promotionalStrength: configuration.promotionalStrength,
    autonomyMode: "approval_required", timezone: configuration.timezone, context: Object.freeze({}),
    successCriteria: Object.freeze([]), successAction: "notify_only", steps: Object.freeze([step]),
  });
  return Object.freeze({ ...intent, campaignId: preparation.campaignId,
    expectedPlanningVersionId: preparation.planningVersionId, campaign });
}
