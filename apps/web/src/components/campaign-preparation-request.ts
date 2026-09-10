import { z } from "zod";
import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import type { CampaignPreparationTemplateInput } from "@market-me/database";

export const preparationUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

// Browser-storage allowlist only; the server compiler and repository remain authoritative.
const storedInput = z.object({
  workspaceId: preparationUuid, contentPackageId: preparationUuid,
  expectedPackageVersion: z.number().int().min(1).max(2_147_483_647),
  templateKey: z.literal("general_announcement"), templateVersion: z.literal(1),
  name: z.string().min(1).max(200), description: z.string().max(5_000),
  brandProfileVersionId: preparationUuid.optional(), audienceProfileVersionIds: z.array(preparationUuid).max(20),
  destinationId: preparationUuid.optional(), informationDepth: z.enum(INFORMATION_DEPTHS),
  promotionalStrength: z.enum(PROMOTIONAL_STRENGTHS), timezone: z.string().min(1).max(100),
}).strict();
const storedAttempt = z.object({ version: z.literal(1), userId: preparationUuid,
  idempotencyKey: preparationUuid, input: storedInput }).strict();

export type PreparationFormInput = z.infer<typeof storedInput>;
export type PreparationAttempt = z.infer<typeof storedAttempt>;
export interface PreparationScope { userId: string; workspaceId: string }

export function preparationStorageKey(scope: PreparationScope): string {
  return `market-me:campaign-preparation:v1:${scope.userId}:${scope.workspaceId}`;
}

export function createPreparationAttempt(scope: PreparationScope, input: CampaignPreparationTemplateInput, idempotencyKey: string): PreparationAttempt {
  const attempt = storedAttempt.parse({ version: 1, userId: scope.userId, input, idempotencyKey });
  if (attempt.input.workspaceId !== scope.workspaceId) throw new Error("Preparation belongs to a different workspace.");
  return attempt;
}

export function restorePreparationAttempt(serialized: string | null, scope: PreparationScope): PreparationAttempt | undefined {
  if (serialized === null) return undefined;
  const attempt = storedAttempt.parse(JSON.parse(serialized));
  if (attempt.userId !== scope.userId || attempt.input.workspaceId !== scope.workspaceId) {
    throw new Error("Saved preparation belongs to another user or workspace.");
  }
  return attempt;
}

/** Keep this exact body and key for every retry, including after a page reload. */
export function preparationRequest(attempt: PreparationAttempt): string {
  return JSON.stringify({ input: attempt.input, idempotencyKey: attempt.idempotencyKey });
}

export function preparationResultPath(id: string, workspaceId: string): string {
  return `/campaigns/preparations/${preparationUuid.parse(id)}?workspaceId=${encodeURIComponent(preparationUuid.parse(workspaceId))}`;
}

export function canPrepareCampaign(role: string, packageStatus = "approved"): boolean {
  return ["owner", "admin", "editor"].includes(role) && packageStatus === "approved";
}
