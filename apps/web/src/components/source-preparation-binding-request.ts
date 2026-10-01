import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS, type InformationDepth, type PromotionalStrength } from "@market-me/domain";

export interface SourcePreparationBindingValues {
  workspaceId: string;
  expectedRevision?: number;
  enabled: boolean;
  templateKey: "general_announcement";
  templateVersion: 1;
  name: string;
  description: string;
  brandProfileVersionId?: string;
  audienceProfileVersionIds: readonly string[];
  destinationId?: string;
  informationDepth: InformationDepth;
  promotionalStrength: PromotionalStrength;
  timezone: string;
}

export interface SourcePreparationBindingView extends SourcePreparationBindingValues {
  id: string;
  smartSourceId: string;
  revision: number;
  updatedAt: string;
}

export interface SourcePreparationPlanPreviewRequest extends SourcePreparationBindingValues {
  expectedSourceVersion: number;
}

export type SourcePreparationPlanPreviewReferenceValidation = "current" | "retained_for_disabled_safe_stop";

export type SourcePreparationPlanPreviewDraftVariant =
  | { kind: "general"; label: string }
  | { kind: "audience"; label: string; versionNumber: number; current: boolean };

/**
 * Browser-safe projection of a server-normalized plan. Resource and authority
 * identifiers are deliberately absent; workspace/source scope exists only so
 * the caller can reject a response for another page.
 */
export interface SourcePreparationPlanPreviewView extends SourcePreparationBindingScope {
  source: { name: string; version: number; enabled: boolean };
  enabled: boolean;
  referenceValidation: SourcePreparationPlanPreviewReferenceValidation;
  template: { key: "general_announcement"; version: 1; name: string; description: string };
  brandProfile?: { name: string; versionNumber: number; current: boolean };
  draftVariants: readonly SourcePreparationPlanPreviewDraftVariant[];
  destination?: { title: string; current: boolean };
  settings: {
    informationDepth: InformationDepth;
    promotionalStrength: PromotionalStrength;
    timezone: string;
  };
  campaign: {
    objective: "awareness";
    autonomyMode: "draft_only";
    steps: readonly {
      id: "review_preparation";
      name: string;
      operationType: "request_approval";
      executionMethods: readonly ["manual_handoff"];
      approvalRequired: true;
      scheduleType: "immediate";
    }[];
  };
}

export type SourcePreparationCommandStatus = "pending" | "processing" | "failed" | "completed" | "dead_letter";

/** Deliberately excludes authority IDs, fingerprints, attempt keys, leases, and configuration snapshots. */
export interface SourcePreparationCommandView {
  status: SourcePreparationCommandStatus;
  bindingRevision: number;
  contentPackageId: string;
  contentPackageVersion: number;
  attemptCount: number;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  safeError?: string;
  preparationId?: string;
  createdAt: string;
}

export interface SourcePreparationBindingScope {
  workspaceId: string;
  smartSourceId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sourcePreparationBindingRequestPath(scope: SourcePreparationBindingScope): string {
  if (!UUID.test(scope.workspaceId) || !UUID.test(scope.smartSourceId)) throw new Error("Invalid source preparation scope.");
  return `/api/v1/smart-sources/${scope.smartSourceId.toLowerCase()}/preparation-binding?workspaceId=${encodeURIComponent(scope.workspaceId.toLowerCase())}`;
}

export function sourcePreparationPlanPreviewRequestPath(scope: SourcePreparationBindingScope): string {
  if (!UUID.test(scope.workspaceId) || !UUID.test(scope.smartSourceId)) throw new Error("Invalid source preparation scope.");
  return `/api/v1/smart-sources/${scope.smartSourceId.toLowerCase()}/preparation-binding/preview?workspaceId=${encodeURIComponent(scope.workspaceId.toLowerCase())}`;
}

export function initialSourcePreparationBindingValues(workspaceId: string, binding?: SourcePreparationBindingView): SourcePreparationBindingValues {
  return binding ? {
    workspaceId,
    expectedRevision: binding.revision,
    enabled: binding.enabled,
    templateKey: "general_announcement",
    templateVersion: 1,
    name: binding.name,
    description: binding.description,
    ...(binding.brandProfileVersionId ? { brandProfileVersionId: binding.brandProfileVersionId } : {}),
    audienceProfileVersionIds: [...binding.audienceProfileVersionIds],
    ...(binding.destinationId ? { destinationId: binding.destinationId } : {}),
    informationDepth: binding.informationDepth,
    promotionalStrength: binding.promotionalStrength,
    timezone: binding.timezone,
  } : {
    workspaceId,
    enabled: false,
    templateKey: "general_announcement",
    templateVersion: 1,
    name: "General announcement",
    description: "",
    audienceProfileVersionIds: [],
    informationDepth: "contextual",
    promotionalStrength: "informational",
    timezone: "UTC",
  };
}

export function sourcePreparationBindingRequest(values: SourcePreparationBindingValues): string {
  return JSON.stringify(values);
}

export function sourcePreparationPlanPreviewRequest(
  values: SourcePreparationBindingValues,
  expectedSourceVersion: number,
): string {
  if (!Number.isInteger(expectedSourceVersion) || expectedSourceVersion < 1 || expectedSourceVersion > 2_147_483_647) {
    throw new Error("Invalid Smart Source version.");
  }
  return JSON.stringify({ ...values, expectedSourceVersion } satisfies SourcePreparationPlanPreviewRequest);
}

export function addSourcePreparationAudience(ids: readonly string[], id: string): string[] {
  return ids.includes(id) || ids.length >= 20 ? [...ids] : [...ids, id];
}

export function removeSourcePreparationAudience(ids: readonly string[], id: string): string[] {
  return ids.filter((candidate) => candidate !== id);
}

export function moveSourcePreparationAudience(ids: readonly string[], id: string, offset: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}

export function canConfigureSourcePreparation(role: string): boolean {
  return ["owner", "admin", "editor"].includes(role);
}

export function isScopedSourcePreparationBinding(value: unknown, scope: SourcePreparationBindingScope): value is SourcePreparationBindingView {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<SourcePreparationBindingView>;
  return binding.workspaceId === scope.workspaceId && binding.smartSourceId === scope.smartSourceId
    && typeof binding.id === "string" && UUID.test(binding.id)
    && typeof binding.revision === "number" && Number.isInteger(binding.revision) && binding.revision > 0
    && typeof binding.updatedAt === "string" && typeof binding.enabled === "boolean"
    && binding.templateKey === "general_announcement" && binding.templateVersion === 1
    && typeof binding.name === "string" && binding.name.length > 0 && binding.name.length <= 200
    && typeof binding.description === "string" && binding.description.length <= 5_000
    && (binding.brandProfileVersionId === undefined || typeof binding.brandProfileVersionId === "string" && UUID.test(binding.brandProfileVersionId))
    && (binding.destinationId === undefined || typeof binding.destinationId === "string" && UUID.test(binding.destinationId))
    && Array.isArray(binding.audienceProfileVersionIds)
    && binding.audienceProfileVersionIds.length <= 20
    && binding.audienceProfileVersionIds.every((id) => typeof id === "string" && UUID.test(id))
    && new Set(binding.audienceProfileVersionIds).size === binding.audienceProfileVersionIds.length
    && INFORMATION_DEPTHS.includes(binding.informationDepth as InformationDepth)
    && PROMOTIONAL_STRENGTHS.includes(binding.promotionalStrength as PromotionalStrength)
    && typeof binding.timezone === "string" && binding.timezone.length > 0 && binding.timezone.length <= 100;
}


export function isScopedSourcePreparationPlanPreview(
  value: unknown,
  scope: SourcePreparationBindingScope,
): value is SourcePreparationPlanPreviewView {
  if (!exactRecord(value, ["workspaceId", "smartSourceId", "source", "enabled", "referenceValidation", "template",
    "brandProfile", "draftVariants", "destination", "settings", "campaign"], ["brandProfile", "destination"])) return false;
  const preview = value as unknown as SourcePreparationPlanPreviewView;
  if (preview.workspaceId !== scope.workspaceId || preview.smartSourceId !== scope.smartSourceId
    || !exactRecord(preview.source, ["name", "version", "enabled"])
    || !boundedText(preview.source.name, 200, true) || !positiveVersion(preview.source.version)
    || typeof preview.source.enabled !== "boolean" || typeof preview.enabled !== "boolean"
    || !["current", "retained_for_disabled_safe_stop"].includes(preview.referenceValidation)
    || !exactRecord(preview.template, ["key", "version", "name", "description"])
    || preview.template.key !== "general_announcement" || preview.template.version !== 1
    || !boundedText(preview.template.name, 200, true) || !boundedText(preview.template.description, 5_000)
    || !Array.isArray(preview.draftVariants) || preview.draftVariants.length < 1 || preview.draftVariants.length > 20
    || !preview.draftVariants.every(validDraftVariant)
    || !exactRecord(preview.settings, ["informationDepth", "promotionalStrength", "timezone"])
    || !INFORMATION_DEPTHS.includes(preview.settings.informationDepth as InformationDepth)
    || !PROMOTIONAL_STRENGTHS.includes(preview.settings.promotionalStrength as PromotionalStrength)
    || !boundedText(preview.settings.timezone, 100, true)
    || !exactRecord(preview.campaign, ["objective", "autonomyMode", "steps"])
    || preview.campaign.objective !== "awareness" || preview.campaign.autonomyMode !== "draft_only"
    || !Array.isArray(preview.campaign.steps) || preview.campaign.steps.length !== 1
    || !validPreviewStep(preview.campaign.steps[0])) return false;
  if (preview.brandProfile !== undefined && (!exactRecord(preview.brandProfile, ["name", "versionNumber", "current"])
    || !boundedText(preview.brandProfile.name, 200, true) || !positiveVersion(preview.brandProfile.versionNumber)
    || typeof preview.brandProfile.current !== "boolean")) return false;
  if (preview.destination !== undefined && (!exactRecord(preview.destination, ["title", "current"])
    || !boundedText(preview.destination.title, 200, true) || typeof preview.destination.current !== "boolean")) return false;
  const general = preview.draftVariants.filter((variant) => variant.kind === "general");
  if (general.length && (preview.draftVariants.length !== 1 || general[0]?.label !== "General")) return false;
  const referencesCurrent = (!preview.brandProfile || preview.brandProfile.current)
    && preview.draftVariants.every((variant) => variant.kind === "general" || variant.current)
    && (!preview.destination || preview.destination.current);
  if (preview.referenceValidation === "current" ? !referencesCurrent : preview.enabled || referencesCurrent) return false;
  return true;
}

function validDraftVariant(value: unknown): value is SourcePreparationPlanPreviewDraftVariant {
  if (!value || typeof value !== "object") return false;
  const variant = value as Partial<SourcePreparationPlanPreviewDraftVariant>;
  if (variant.kind === "general") return exactRecord(value, ["kind", "label"]) && boundedText(variant.label, 200, true);
  return variant.kind === "audience" && exactRecord(value, ["kind", "label", "versionNumber", "current"])
    && boundedText(variant.label, 200, true) && positiveVersion(variant.versionNumber)
    && typeof variant.current === "boolean";
}

function validPreviewStep(value: unknown): boolean {
  if (!exactRecord(value, ["id", "name", "operationType", "executionMethods", "approvalRequired", "scheduleType"])) return false;
  const step = value as SourcePreparationPlanPreviewView["campaign"]["steps"][number];
  return step.id === "review_preparation" && boundedText(step.name, 200, true)
    && step.operationType === "request_approval" && Array.isArray(step.executionMethods)
    && step.executionMethods.length === 1 && step.executionMethods[0] === "manual_handoff"
    && step.approvalRequired === true && step.scheduleType === "immediate";
}

function exactRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  const required = new Set(keys.filter((key) => !optional.includes(key)));
  return actual.every((key) => allowed.has(key)) && [...required].every((key) => Object.hasOwn(value, key));
}

function boundedText(value: unknown, maximum: number, nonempty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (!nonempty || value.length > 0);
}

function positiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
