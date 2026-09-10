import { z } from "zod";
import { parseScheduleInstant } from "@market-me/domain";
import type { CampaignFinalizationTiming, ExactTextPreviewSelection, StoredCampaignPreviewOption } from "@market-me/database";
import { preparationUuid } from "./campaign-preparation-request";

const fingerprint = z.string().regex(/^mm-preview-v1:sha256:[0-9a-f]{64}$/);
const instant = z.string().refine((value) => { try { const date = new Date(parseScheduleInstant(value)); return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999; } catch { return false; } }, "Use an absolute time with millisecond precision.");
const timing = z.discriminatedUnion("type", [z.object({ type: z.literal("immediate") }).strict(),
  z.object({ type: z.literal("exact_time"), scheduledAt: instant }).strict(),
  z.object({ type: z.literal("preferred_window"), start: instant, end: instant }).strict()
    .refine((value) => parseScheduleInstant(value.start) < parseScheduleInstant(value.end), "Window end must be after its start.")]);
const inputSchema = z.object({ workspaceId: preparationUuid, preparationId: preparationUuid, expectedPlanningVersionId: preparationUuid,
  draftId: preparationUuid, expectedDraftVersionId: preparationUuid, previewId: preparationUuid,
  expectedPreviewFingerprint: fingerprint, timing, templateVersion: z.literal(1) }).strict();
const attemptSchema = z.object({ version: z.literal(1), userId: preparationUuid, idempotencyKey: preparationUuid, input: inputSchema }).strict();
export type FinalizationAttempt = z.infer<typeof attemptSchema>;
export type FinalizationFormInput = z.infer<typeof inputSchema>;
export interface FinalizationScope { userId: string; workspaceId: string; preparationId: string }
export interface FinalizationPreviewChoice { id: string; draftId: string; label: string }

export function finalizationStorageKey(scope: FinalizationScope): string {
  return `market-me:campaign-finalization:v1:${scope.userId}:${scope.workspaceId}:${scope.preparationId}`;
}
export function createFinalizationAttempt(scope: FinalizationScope, input: FinalizationFormInput, idempotencyKey: string): FinalizationAttempt {
  const attempt = attemptSchema.parse({ version: 1, userId: scope.userId, idempotencyKey, input });
  assertScope(attempt, scope); return attempt;
}
function assertScope(attempt: FinalizationAttempt, scope: FinalizationScope) {
  if (attempt.userId !== scope.userId || attempt.input.workspaceId !== scope.workspaceId || attempt.input.preparationId !== scope.preparationId) throw new Error("Saved finalization belongs to another user, workspace, or preparation.");
}
export function restoreFinalizationAttempt(raw: string | null, scope: FinalizationScope): FinalizationAttempt | undefined {
  if (raw === null) return undefined;
  const attempt = attemptSchema.parse(JSON.parse(raw)); assertScope(attempt, scope); return attempt;
}
export function finalizationRequest(attempt: FinalizationAttempt): string {
  return JSON.stringify({ input: attempt.input, idempotencyKey: attempt.idempotencyKey });
}
/** Always persist before POST, including retries; a storage failure produces zero requests. */
export async function sendFinalizationAttempt(attempt: FinalizationAttempt, scope: FinalizationScope,
  storage: Pick<Storage, "setItem">, send: typeof fetch = fetch): Promise<Response> {
  assertScope(attempt, scope);
  storage.setItem(finalizationStorageKey(scope), JSON.stringify(attempt));
  return send("/api/v1/campaign-finalizations", { method: "POST", headers: { "content-type": "application/json" }, body: finalizationRequest(attempt) });
}
export function finalizationResultPath(id: string, workspaceId: string): string {
  return `/campaigns/finalizations/${preparationUuid.parse(id)}?workspaceId=${encodeURIComponent(preparationUuid.parse(workspaceId))}`;
}
export function finalizationFormPath(preparationId: string, workspaceId: string): string {
  return `/campaigns/preparations/${preparationUuid.parse(preparationId)}/finalize?workspaceId=${encodeURIComponent(preparationUuid.parse(workspaceId))}`;
}
export function finalizationPreviewChoices(options: readonly StoredCampaignPreviewOption[], planningVersionId: string, draftIds: readonly string[]): FinalizationPreviewChoice[] {
  return options.filter((option) => draftIds.includes(option.contentDraftId) && option.sourceCampaignVersionId === planningVersionId
    && option.isCurrentApprovedVersion && option.status === "ready" && !option.isStale && option.assets.length === 0
    && ["discord_webhook", "slack_webhook", "mastodon_account"].includes(option.provider))
    .map((option) => ({ id: option.id, draftId: option.contentDraftId,
      label: `${option.audienceName ?? "General audience"} · ${option.channelConnectionName} · ${option.provider.replaceAll("_", " ")}` }));
}
/** This consistency check is not authority: only the server loader validates the proof. */
export function selectedFinalizationInput(scope: FinalizationScope, planningVersionId: string, generationId: string,
  choice: FinalizationPreviewChoice, selected: ExactTextPreviewSelection, selectedTiming: CampaignFinalizationTiming): FinalizationFormInput {
  const lineage = selected.snapshot.lineage;
  if (lineage.workspaceId !== scope.workspaceId || lineage.previewId !== choice.id || lineage.contentDraftId !== choice.draftId
    || lineage.sourceCampaignVersionId !== planningVersionId || lineage.generationId !== generationId) throw new Error("The selected response belongs to a different preparation.");
  return inputSchema.parse({ workspaceId: scope.workspaceId, preparationId: scope.preparationId, expectedPlanningVersionId: planningVersionId,
    draftId: lineage.contentDraftId, expectedDraftVersionId: lineage.contentDraftVersionId, previewId: lineage.previewId,
    expectedPreviewFingerprint: selected.token, timing: selectedTiming, templateVersion: 1 });
}
export function utcFormInstant(value: string): string {
  const absolute = `${value.length === 16 ? `${value}:00` : value}Z`;
  return new Date(parseScheduleInstant(absolute)).toISOString();
}
