import type { MarketMeRepository, StoredSmartSource } from "@market-me/database";
import type { MediaProcessor, ProcessedMediaAsset } from "@market-me/media";
import { describe, expect, it, vi } from "vitest";
import { ContentPackageService } from "./content-package-service";
import type { StorageIngestionService } from "./service";

type PackageInput = Parameters<MarketMeRepository["saveContentPackage"]>[0];
const source: StoredSmartSource = {
  id: "source-integrity", workspaceId: "workspace-integrity", name: "Synthetic source", provider: "local",
  locations: [{ providerLocationId: "synthetic", displayPath: "/synthetic" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 0,
  allowedMimeTypes: [], ignorePatterns: [], contextPackIds: [], autonomyMode: "approval_required", enabled: true,
  version: 1, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
};
async function ingest(text: string, processed?: Partial<ProcessedMediaAsset>) {
  const saveContentPackage = vi.fn(async (input: PackageInput) => input);
  const repository = {
    claimIngestionEvents: vi.fn(async () => [{ id: "event", workspaceId: source.workspaceId, smartSourceId: source.id,
      providerItemId: "file", eventKind: "discovered", attemptCount: 1 }]),
    getSmartSource: vi.fn(async () => source),
    getSourceItemByProviderId: vi.fn(async () => ({ id: "item", workspaceId: source.workspaceId,
      smartSourceId: source.id, providerItemId: "file", name: "synthetic.txt", displayPath: "/synthetic/synthetic.txt",
      mimeType: "text/plain", isFolder: false, objectKey: "synthetic/source", modifiedAt: "2026-08-01T00:00:00Z",
      firstSeenAt: "2026-08-01T00:00:00Z", lastSeenAt: "2026-08-01T00:00:00Z" })),
    listSourceItems: vi.fn(async () => []), listContextPacks: vi.fn(async () => []), saveContentPackage,
    finishIngestionEvent: vi.fn(async () => undefined),
  } as unknown as MarketMeRepository;
  const mediaProcessor = processed ? { process: vi.fn(async () => [{
    clientKey: "original", role: "original", fileName: "synthetic.txt", mimeType: "text/plain",
    contentHash: `sha256:${"a".repeat(64)}`, objectKey: "synthetic/source", byteSize: 100,
    processingVersion: "synthetic-v1", recipe: {}, mediaStatus: "processed", scanStatus: "clean",
    scanEngine: "synthetic", scanScannedAt: "2026-08-01T00:00:00Z", scanRevision: 1,
    altTextStatus: "not_applicable", extractedText: text, extractionStatus: "completed", metadata: {}, ...processed,
  }]) } as unknown as MediaProcessor : undefined;
  const ingestion = { getConnectionAccessToken: vi.fn() } as unknown as StorageIngestionService;
  const service = new ContentPackageService({ repository, ingestion, mediaProcessor,
    objectStore: { read: vi.fn(async () => new TextEncoder().encode(text)), putImmutable: vi.fn() },
    now: () => new Date("2026-08-06T00:00:00Z") });
  expect(await service.processReadyEvents()).toEqual({ processed: 1, deferred: 0, ignored: 0, failed: 0 });
  expect(ingestion.getConnectionAccessToken).not.toHaveBeenCalled();
  expect(saveContentPackage).toHaveBeenCalledOnce();
  return saveContentPackage.mock.calls[0]![0];
}

describe("source evidence integrity", () => {
  it("does not cut off a qualifying suffix and promote the prefix", async () => {
    const text = `${"Background details. ".repeat(26)}Admission is free only for registered members.`;
    const saved = await ingest(text);
    expect(saved.assets[0]!.extractedText).toBe(text);
    expect(saved.status).toBe("needs_review");
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0]).toMatchObject({ provenance: "unresolved" });
    expect(saved.evidence[0]!.claim).not.toBe(text.slice(0, 500));
    expect(saved.evidence[0]!.confidence).toBeUndefined();
  });

  it("does not promote a resource-truncated extraction as complete evidence", async () => {
    const saved = await ingest("Admission is free", { metadata: { documentExtraction: { state: "truncated" } } });
    expect(saved.status).toBe("needs_review");
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0]).toMatchObject({ provenance: "unresolved" });
    expect(saved.assets[0]!.extractedText).toBe("Admission is free");
  });

  it("uses whole short text without turning the transport path into a claim", async () => {
    const saved = await ingest("Attendance is not guaranteed!");
    expect(saved.status).toBe("ready");
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0]).toMatchObject({ claim: "Attendance is not guaranteed!", provenance: "observed",
      sourceReferences: ["source-item:item", expect.stringMatching(/^content-hash:sha256:/)] });
  });

  it("requires source review when there is no readable content", async () => {
    const saved = await ingest("  \n  ");
    expect(saved.status).toBe("needs_review");
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0]).toMatchObject({ provenance: "unresolved" });
  });

  it("retains every code unit at the exact bound", async () => {
    const text = `${"x".repeat(498)}!?`;
    const saved = await ingest(text);
    expect(saved.evidence.filter((item) => item.claim === text)).toHaveLength(1);
    expect(saved.status).toBe("ready");
  });

  it("never cuts a surrogate pair at the automatic-evidence boundary", async () => {
    const text = `${"x".repeat(499)}😀 only after confirmation.`;
    const saved = await ingest(text);
    expect(saved.evidence.every((item) => item.provenance === "unresolved")).toBe(true);
    expect(saved.assets[0]!.extractedText).toBe(text);
  });

  it.each(["truncated", "requires_ocr", "failed", "pending", "unknown"])("withholds source evidence for %s document extraction", async (state) => {
    const saved = await ingest("Partial source", { metadata: { documentExtraction: { state } } });
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0]).toMatchObject({ factKey: "source.text_review", provenance: "unresolved" });
    expect(saved.assets[0]!.metadata).toMatchObject({ documentExtraction: { state }, sourceEvidence: {
      version: "source-evidence-v1", state: "review_required", characterCount: 14,
      characterCountUnit: "utf16_code_units", automaticCharacterLimit: 500, reasons: ["document_incomplete"],
    } });
  });

  it("keeps the full asset text and existing metadata while trimming only the evidence exterior", async () => {
    const saved = await ingest("  Is registration required?\n", { metadata: { documentExtraction: { state: "completed" }, extra: ["preserved"] } });
    expect(saved.evidence).toHaveLength(1);
    expect(saved.evidence[0]!.claim).toBe("Is registration required?");
    expect(saved.assets[0]!.extractedText).toBe("  Is registration required?\n");
    expect(saved.assets[0]!.metadata).toMatchObject({ documentExtraction: { state: "completed" }, extra: ["preserved"],
      displayPath: "/synthetic/synthetic.txt", providerItemId: "file", sourceEvidence: { state: "whole_text", reasons: [] } });
  });

  it("does not promote partial text left by a failed extractor", async () => {
    const saved = await ingest("Partial", { extractionStatus: "failed", extractionError: "Synthetic failure" });
    expect(saved.evidence[0]!.provenance).toBe("unresolved");
    expect(saved.assets[0]).toMatchObject({ extractedText: "Partial", extractionStatus: "failed", extractionError: "Synthetic failure" });
  });

  it("withholds partial text when the plain-text extractor reports truncation", async () => {
    const saved = await ingest("Partial", { metadata: { textExtraction: { state: "truncated", maxTextCharacters: 7 } } });
    expect(saved.status).toBe("needs_review");
    expect(saved.evidence[0]!.provenance).toBe("unresolved");
    expect(saved.assets[0]!.metadata).toMatchObject({ textExtraction: { state: "truncated", maxTextCharacters: 7 },
      sourceEvidence: { reasons: ["text_incomplete"] } });
  });

  it.each(["skipped", "failed"] as const)("requires source review when extraction is %s and no text exists", async (extractionStatus) => {
    const saved = await ingest("", { extractedText: undefined, extractionStatus });
    expect(saved.status).toBe("needs_review");
    expect(saved.evidence).toHaveLength(1); expect(saved.evidence[0]!.provenance).toBe("unresolved");
    expect(saved.assets[0]!.metadata).toMatchObject({ sourceEvidence: { reasons: ["extraction_not_completed", "empty_text"] } });
  });
});
