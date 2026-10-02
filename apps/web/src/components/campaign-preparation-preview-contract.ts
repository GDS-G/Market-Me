import { z } from "zod";
import { presetSettingsSchema } from "./preparation-preset-contract";
import { preparationUuid, type PreparationFormInput } from "./campaign-preparation-request";
import { packageReviewFingerprint } from "./content-package-review-request";

export const PREPARATION_PREVIEW_BROWSER_LIMITS = Object.freeze({ requestBytes: 32_768, responseBytes: 1_048_576, timeoutMs: 20_000 });
const text = z.string().max(1_048_576), short = z.string().max(5_000), version = z.number().int().min(1).max(2_147_483_647);
const claim = z.strictObject({ kind: z.enum(["fact", "call_to_action"]), text, evidenceItemIds: z.array(preparationUuid).max(10_000) });
const audience = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("general"), name: z.literal("General") }),
  z.strictObject({ kind: z.literal("audience"), versionId: preparationUuid, name: short, versionNumber: version })]);
const previewSchema = z.strictObject({
  schemaVersion: z.literal(1), workspaceId: preparationUuid,
  configuration: presetSettingsSchema.extend({ workspaceId: preparationUuid, contentPackageId: preparationUuid, expectedPackageVersion: version }),
  contentPackage: z.strictObject({ id: preparationUuid, title: short, version, approvalId: preparationUuid, reviewFingerprint: packageReviewFingerprint }),
  brand: z.strictObject({ versionId: preparationUuid, name: short, versionNumber: version }).optional(),
  destination: z.strictObject({ id: preparationUuid, title: short }).optional(),
  campaign: z.strictObject({ objective: z.literal("awareness"), autonomyMode: z.literal("draft_only"), steps: z.array(z.strictObject({
    id: z.literal("review_preparation"), name: short, operationType: z.literal("request_approval"), executionMethods: z.tuple([z.literal("manual_handoff")]),
    approvalRequired: z.literal(true), scheduleType: z.literal("immediate"),
  })).length(1) }),
  generator: z.strictObject({ provider: z.literal("market-me"), model: z.literal("grounded-template"), version: z.string().min(1).max(100), promptVersion: z.string().min(1).max(100) }),
  variants: z.array(z.strictObject({ position: z.number().int().min(0).max(19), audience,
    draft: z.strictObject({ headline: text, body: text, callToAction: text.optional(), hashtags: z.array(short).max(100), altText: text.optional(), rationale: text, claims: z.array(claim).max(10_000) }),
  })).min(1).max(20),
  evidence: z.array(z.strictObject({ id: preparationUuid, claim: text, provenance: z.enum(["observed", "authoritative_context", "inferred"]), sourceReferences: z.array(text).max(10_000) })).min(1).max(10_000),
  effects: z.strictObject({ persisted: z.literal(false), providerRequest: z.literal(false), budgetReservation: z.literal(false), approved: z.literal(false), activated: z.literal(false) }),
});
export type PreparationPreview = z.infer<typeof previewSchema>;
export function preparationPreviewBody(input: PreparationFormInput, expectedReviewFingerprint: string) {
  packageReviewFingerprint.parse(expectedReviewFingerprint);
  const body = JSON.stringify({ input, expectedReviewFingerprint });
  if (new TextEncoder().encode(body).byteLength > PREPARATION_PREVIEW_BROWSER_LIMITS.requestBytes) throw new Error("Preview request exceeds its limit.");
  return body;
}
export async function preparationPreviewDigest(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function parsePreparationPreview(value: unknown, input: PreparationFormInput, fingerprint: string, digest: string): PreparationPreview {
  const response = z.strictObject({ data: previewSchema, meta: z.strictObject({ requestDigest: z.string().regex(/^[0-9a-f]{64}$/) }) }).parse(value), data = response.data;
  if (response.meta.requestDigest !== digest || data.workspaceId !== input.workspaceId.trim().toLowerCase() || data.configuration.workspaceId !== data.workspaceId
    || data.contentPackage.id !== input.contentPackageId.trim().toLowerCase() || data.configuration.contentPackageId !== data.contentPackage.id
    || data.contentPackage.version !== input.expectedPackageVersion || data.configuration.expectedPackageVersion !== data.contentPackage.version
    || data.contentPackage.reviewFingerprint !== fingerprint) throw new Error("Preview identity mismatch.");
  // These are display-coherence checks, never a substitute for the server compiler.
  const normalizedText = (value: string) => value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  const brandId = input.brandProfileVersionId?.trim().toLowerCase(), destinationId = input.destinationId?.trim().toLowerCase();
  if (data.configuration.name !== normalizedText(input.name).replace(/\s+/gu, " ") || data.configuration.description !== normalizedText(input.description)
    || data.configuration.timezone !== input.timezone.trim() || data.configuration.informationDepth !== input.informationDepth
    || data.configuration.promotionalStrength !== input.promotionalStrength || data.configuration.brandProfileVersionId !== brandId
    || data.brand?.versionId !== brandId || data.configuration.destinationId !== destinationId || data.destination?.id !== destinationId)
    throw new Error("Preview settings mismatch.");
  const ids = input.audienceProfileVersionIds.map(id => id.trim().toLowerCase());
  if (data.variants.length !== (ids.length || 1) || JSON.stringify(data.configuration.audienceProfileVersionIds) !== JSON.stringify(ids)
    || data.variants.some((item, index) => item.position !== index || (ids.length ? item.audience.kind !== "audience" || item.audience.versionId !== ids[index] : item.audience.kind !== "general")))
    throw new Error("Preview audience mismatch.");
  const facts = new Map(data.evidence.map(item => [item.id, item]));
  if (facts.size !== data.evidence.length || data.variants.some(item => item.draft.claims.some(c => c.kind === "fact"
    ? c.evidenceItemIds.length !== 1 || facts.get(c.evidenceItemIds[0]!)?.claim !== c.text : c.evidenceItemIds.length !== 0))) throw new Error("Preview evidence mismatch.");
  return data;
}
export async function readPreparationPreviewResponse(response: Response): Promise<unknown> {
  const maximum = PREPARATION_PREVIEW_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("Invalid preview response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("Preview response too large."); } chunks.push(chunk.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}

export async function requestPreparationPreview(input: PreparationFormInput, fingerprint: string, controller: AbortController): Promise<PreparationPreview> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Preview timed out.")); }, PREPARATION_PREVIEW_BROWSER_LIMITS.timeoutMs); });
    return await Promise.race([timeout, (async () => {
      const body = preparationPreviewBody(input, fingerprint), digest = await preparationPreviewDigest(body);
      if (controller.signal.aborted) throw new Error("Preview canceled.");
      const response = await fetch("/api/v1/campaign-preparations/preview", { method: "POST", headers: { "content-type": "application/json" }, body,
        cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
      const value = await readPreparationPreviewResponse(response);
      if (!response.ok) throw new Error("Preview is unavailable; reload the approved package and review current profile settings.");
      return parsePreparationPreview(value, input, fingerprint, digest);
    })()]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
