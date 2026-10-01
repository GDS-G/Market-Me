import type { SourcePreparationCommandSummary, SourcePreparationPlanPreview, StoredSourcePreparationBinding } from "@market-me/database";
import type {
  SourcePreparationBindingView,
  SourcePreparationCommandView,
  SourcePreparationPlanPreviewView,
} from "@/components/source-preparation-binding-request";

/** Build the serializable client model explicitly so authority and audit identities never cross the component boundary. */
export function sourcePreparationBindingView(binding: StoredSourcePreparationBinding): SourcePreparationBindingView {
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    smartSourceId: binding.smartSourceId,
    enabled: binding.enabled,
    revision: binding.revision,
    templateKey: binding.templateKey,
    templateVersion: binding.templateVersion,
    name: binding.name,
    description: binding.description,
    ...(binding.brandProfileVersionId ? { brandProfileVersionId: binding.brandProfileVersionId } : {}),
    audienceProfileVersionIds: [...binding.audienceProfileVersionIds],
    ...(binding.destinationId ? { destinationId: binding.destinationId } : {}),
    informationDepth: binding.informationDepth,
    promotionalStrength: binding.promotionalStrength,
    timezone: binding.timezone,
    updatedAt: binding.updatedAt,
  };
}

/** Omit approval IDs, fingerprints, writer IDs, idempotency keys, leases, and immutable snapshots from browser props. */
export function sourcePreparationCommandView(command: SourcePreparationCommandSummary): SourcePreparationCommandView {
  return {
    status: command.status,
    bindingRevision: command.bindingRevision,
    contentPackageId: command.contentPackageId,
    contentPackageVersion: command.contentPackageVersion,
    attemptCount: command.attemptCount,
    ...(command.nextAttemptAt ? { nextAttemptAt: command.nextAttemptAt } : {}),
    ...(command.lastErrorCode ? { lastErrorCode: command.lastErrorCode } : {}),
    ...(command.safeError ? { safeError: command.safeError } : {}),
    ...(command.preparationId ? { preparationId: command.preparationId } : {}),
    createdAt: command.createdAt,
  };
}

/**
 * Explicitly minimize the planning projection before it crosses the browser
 * boundary. Reference IDs, actor/binding identity, and the compiler's internal
 * placeholder Content Package identity must never be serialized. Only the
 * workspace/source scope remains for the browser's response-scope check.
 */
export function sourcePreparationPlanPreviewView(preview: SourcePreparationPlanPreview): SourcePreparationPlanPreviewView {
  return {
    workspaceId: preview.workspaceId,
    smartSourceId: preview.smartSourceId,
    source: {
      name: preview.source.name,
      version: preview.source.version,
      enabled: preview.source.enabled,
    },
    enabled: preview.enabled,
    referenceValidation: preview.referenceValidation,
    template: {
      key: preview.template.key,
      version: preview.template.version,
      name: preview.template.name,
      description: preview.template.description,
    },
    ...(preview.brandProfile ? { brandProfile: {
      name: preview.brandProfile.name,
      versionNumber: preview.brandProfile.versionNumber,
      current: preview.brandProfile.current,
    } } : {}),
    draftVariants: preview.draftVariants.map((variant) => variant.kind === "general"
      ? { kind: "general" as const, label: variant.label }
      : {
        kind: "audience" as const,
        label: variant.label,
        versionNumber: variant.versionNumber,
        current: variant.current,
      }),
    ...(preview.destination ? { destination: {
      title: preview.destination.title,
      current: preview.destination.current,
    } } : {}),
    settings: {
      informationDepth: preview.settings.informationDepth,
      promotionalStrength: preview.settings.promotionalStrength,
      timezone: preview.settings.timezone,
    },
    campaign: {
      objective: preview.campaign.objective,
      autonomyMode: preview.campaign.autonomyMode,
      steps: preview.campaign.steps.map((step) => ({
        id: step.id,
        name: step.name,
        operationType: step.operationType,
        executionMethods: [...step.executionMethods],
        approvalRequired: step.approvalRequired,
        scheduleType: step.scheduleType,
      })),
    },
  };
}
