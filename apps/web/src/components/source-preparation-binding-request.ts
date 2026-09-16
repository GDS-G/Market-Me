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
