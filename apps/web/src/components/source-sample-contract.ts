import { z } from "zod";

export const SOURCE_SAMPLE_RESPONSE_LIMIT = 2_097_152;
const integer = z.number().int().min(0).max(200);
export const sourceSampleRequestSchema = z.strictObject({ workspaceId: z.uuid(), expectedSourceVersion: z.number().int().min(1).max(2_147_483_647),
  locationIndex: z.number().int().min(0).max(19) });
export const sourceSampleViewSchema = z.strictObject({
  workspaceId: z.uuid(), smartSourceId: z.uuid(), locationIndex: z.number().int().min(0).max(19),
  source: z.strictObject({ name: z.string().max(200), version: z.number().int().positive(), enabled: z.boolean(), recursive: z.boolean() }),
  location: z.string().max(2_048),
  coverage: z.strictObject({ kind: z.enum(["cloud_folder_page", "historical_local_index"]), partial: z.boolean(), truncated: z.boolean() }),
  context: z.strictObject({ packs: z.array(z.strictObject({ name: z.string().max(200), versionNumber: z.number().int().positive() })).max(100),
    facts: z.array(z.strictObject({ factKey: z.string().max(200), status: z.enum(["resolved", "conflicted", "unresolved"]), reason: z.string().max(1_000) })).max(1_000),
    unresolvedRecordedFacts: z.number().int().min(0).max(1_000) }),
  preparation: z.strictObject({ enabled: z.boolean(), revision: z.number().int().positive() }).nullable(),
  simulation: z.strictObject({ evaluatedAt: z.iso.datetime(), partial: z.boolean(), aiRequests: z.literal(0), futureProcessingCost: z.null(),
    counts: z.strictObject({ inspected: integer, folders: integer, ignored: integer, eligibleFiles: integer, readyForAnalysis: integer, waiting: integer, unknown: integer, reviewRequired: integer }),
    items: z.array(z.strictObject({ index: integer, name: z.string().max(512), displayPath: z.string().max(4_096), mimeType: z.string().max(200),
      outcome: z.enum(["folder", "ignored", "ready_for_analysis", "waiting", "unknown", "review_required"]), reason: z.string().max(1_000),
      filter: z.strictObject({ eligible: z.boolean(), kind: z.enum(["folder", "file"]), exclusions: z.array(z.enum(["mime_type", "ignored_path"])).max(2) }),
      stableForSeconds: z.number().int().nonnegative().optional(), relatedItemIndexes: z.array(integer).max(200),
      missingRequirements: z.array(z.string().max(100)).max(10) })).max(200),
  }),
}).superRefine((value, context) => {
  const { items, counts } = value.simulation;
  const byOutcome = (outcome: string) => items.filter((item) => item.outcome === outcome).length;
  if (value.coverage.partial !== value.simulation.partial || counts.inspected !== items.length
    || counts.folders !== byOutcome("folder") || counts.ignored !== byOutcome("ignored")
    || counts.eligibleFiles !== items.length - counts.folders - counts.ignored
    || counts.readyForAnalysis !== byOutcome("ready_for_analysis") || counts.waiting !== byOutcome("waiting")
    || counts.unknown !== byOutcome("unknown") || counts.reviewRequired !== byOutcome("review_required")
    || items.some((item, index) => item.index !== index || item.relatedItemIndexes.some((related) => related >= items.length)
      || new Set(item.relatedItemIndexes).size !== item.relatedItemIndexes.length)) {
    context.addIssue({ code: "custom", message: "Invalid dry-test counts or item relationships." });
  }
});
export type SourceSampleView = z.infer<typeof sourceSampleViewSchema>;
export interface SourceSampleScope { workspaceId: string; smartSourceId: string; sourceVersion: number; locationIndex: number }
export function parseScopedSourceSample(value: unknown, scope: SourceSampleScope): SourceSampleView {
  const parsed = sourceSampleViewSchema.parse(value);
  if (parsed.workspaceId !== scope.workspaceId || parsed.smartSourceId !== scope.smartSourceId || parsed.source.version !== scope.sourceVersion
    || parsed.locationIndex !== scope.locationIndex) throw new Error("The dry-test response belongs to different saved settings.");
  return parsed;
}

/** Streaming limit applies before JSON parsing; no session/local storage of file metadata. */
export async function readSourceSampleResponse(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > SOURCE_SAMPLE_RESPONSE_LIMIT) throw new Error("Invalid dry-test response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > SOURCE_SAMPLE_RESPONSE_LIMIT) { await reader.cancel(); throw new Error("Dry-test response too large."); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
