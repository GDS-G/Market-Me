import type { SourcePreparationCommandSummary, StoredSourcePreparationBinding } from "@market-me/database";
import type { SourcePreparationBindingView, SourcePreparationCommandView } from "@/components/source-preparation-binding-request";

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
