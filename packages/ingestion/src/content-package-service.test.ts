import type { MarketMeRepository, StoredContextPack, StoredSmartSource } from "@market-me/database";
import type { StorageConnector } from "@market-me/connectors";
import { describe, expect, it, vi } from "vitest";
import type { StorageIngestionService } from "./service";
import type { MediaProcessor } from "@market-me/media";
import { ContentPackageService } from "./content-package-service";

const source: StoredSmartSource = {
  id: "source-1",
  workspaceId: "workspace-1",
  storageConnectionId: "connection-1",
  name: "Launch source",
  provider: "google_drive",
  locations: [{ providerLocationId: "folder-1", displayPath: "/Launch" }],
  recursive: true,
  readinessMode: "immediate",
  stabilizationWindowSeconds: 0,
  allowedMimeTypes: ["text/plain"],
  ignorePatterns: [],
  contextPackIds: ["pack-1", "pack-2"],
  autonomyMode: "approval_required",
  enabled: true,
  version: 1,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function contextPack(id: string, factId: string, value: string): StoredContextPack {
  return {
    id,
    workspaceId: "workspace-1",
    name: id,
    description: "",
    status: "published",
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    currentVersion: {
      id: `${id}-version`, contextPackId: id, versionNumber: 1, status: "published",
      instructions: "", authorityRules: [],
      sources: [{ id: `${id}-source`, kind: "manual_text", label: id, sourceReference: `manual:${id}`, selectedSections: [], authorityRank: 50 }],
      facts: [{ id: factId, factKey: "launch.date", value, sourceId: `${id}-source`, status: "accepted" }],
      createdAt: "2026-08-01T00:00:00Z", publishedAt: "2026-08-01T00:00:00Z",
    },
  };
}

describe("ContentPackageService", () => {
  it("downloads bounded text and sends conflicting context to review", async () => {
    const saveContentPackage = vi.fn(async (input: unknown) => input);
    const finishIngestionEvent = vi.fn(async () => undefined);
    const repository = {
      claimIngestionEvents: vi.fn(async () => [{
        id: "event-1", workspaceId: "workspace-1", smartSourceId: "source-1",
        storageConnectionId: "connection-1", providerItemId: "file-1", eventKind: "discovered", attemptCount: 1,
      }]),
      getSmartSource: vi.fn(async () => source),
      getSourceItemByProviderId: vi.fn(async () => ({
        id: "item-1", workspaceId: "workspace-1", smartSourceId: "source-1",
        providerItemId: "file-1", providerParentId: "folder-1", name: "launch.txt",
        displayPath: "/Launch/launch.txt", mimeType: "text/plain", isFolder: false,
        modifiedAt: "2026-08-01T00:00:00Z", firstSeenAt: "2026-08-01T00:00:00Z", lastSeenAt: "2026-08-01T00:00:00Z",
      })),
      listSourceItems: vi.fn(async () => []),
      listContextPacks: vi.fn(async () => [contextPack("pack-1", "fact-1", "2026-09-01"), contextPack("pack-2", "fact-2", "2026-09-03")]),
      saveContentPackage,
      finishIngestionEvent,
    } as unknown as MarketMeRepository;
    const connector = {
      downloadContent: vi.fn(async () => ({ bytes: new TextEncoder().encode("Approved launch details"), mimeType: "text/plain" })),
    } as unknown as StorageConnector;
    const ingestion = {
      getConnectionAccessToken: vi.fn(async () => ({ connector, accessToken: "access", connection: {} })),
    } as unknown as StorageIngestionService;
    const service = new ContentPackageService({ repository, ingestion, now: () => new Date("2026-08-06T00:00:00Z") });
    expect(await service.processReadyEvents()).toEqual({ processed: 1, deferred: 0, ignored: 0, failed: 0 });
    const saved = saveContentPackage.mock.calls[0][0] as { status: string; assets: { extractedText?: string }[]; conflicts: unknown[] };
    expect(saved.status).toBe("needs_review");
    expect(saved.assets[0].extractedText).toBe("Approved launch details");
    expect(saved.conflicts).toHaveLength(1);
    expect(finishIngestionEvent).toHaveBeenCalledWith({ eventId: "event-1", status: "processed" });
  });

  it("defers stable-window work without consuming a retry attempt", async () => {
    const deferIngestionEvent = vi.fn(async () => undefined);
    const repository = {
      claimIngestionEvents: vi.fn(async () => [{ id: "event-2", workspaceId: "workspace-1", smartSourceId: "source-1", providerItemId: "file-2", eventKind: "changed", attemptCount: 1 }]),
      getSmartSource: vi.fn(async () => ({ ...source, stabilizationWindowSeconds: 120 })),
      getSourceItemByProviderId: vi.fn(async () => ({
        id: "item-2", workspaceId: "workspace-1", smartSourceId: "source-1", providerItemId: "file-2",
        name: "new.txt", displayPath: "/new.txt", mimeType: "text/plain", isFolder: false,
        modifiedAt: "2026-08-06T00:00:00Z", firstSeenAt: "2026-08-06T00:00:00Z", lastSeenAt: "2026-08-06T00:00:00Z",
      })),
      listSourceItems: vi.fn(async () => []),
      deferIngestionEvent,
    } as unknown as MarketMeRepository;
    const service = new ContentPackageService({ repository, ingestion: {} as StorageIngestionService, now: () => new Date("2026-08-06T00:00:30Z") });
    expect(await service.processReadyEvents()).toEqual({ processed: 0, deferred: 1, ignored: 0, failed: 0 });
    expect(deferIngestionEvent).toHaveBeenCalledWith("event-2", new Date("2026-08-06T00:02:00Z"), expect.stringContaining("Waiting"));
  });

  it("reads an approved local source through the object-store boundary", async () => {
    const saveContentPackage = vi.fn(async (input: unknown) => input);
    const finishIngestionEvent = vi.fn(async () => undefined);
    const localSource = { ...source, provider: "local" as const, storageConnectionId: undefined, contextPackIds: [] };
    const repository = {
      claimIngestionEvents: vi.fn(async () => [{ id: "event-local", workspaceId: "workspace-1", smartSourceId: "source-1", providerItemId: "local:file", eventKind: "discovered", attemptCount: 1 }]),
      getSmartSource: vi.fn(async () => localSource),
      getSourceItemByProviderId: vi.fn(async () => ({
        id: "item-local", workspaceId: "workspace-1", smartSourceId: "source-1", providerItemId: "local:file",
        name: "local.txt", displayPath: "local.txt", mimeType: "text/plain", isFolder: false,
        objectKey: `originals/${"a".repeat(64)}/source`, modifiedAt: "2026-08-01T00:00:00Z",
        firstSeenAt: "2026-08-01T00:00:00Z", lastSeenAt: "2026-08-01T00:00:00Z",
      })),
      listSourceItems: vi.fn(async () => []), listContextPacks: vi.fn(async () => []), saveContentPackage, finishIngestionEvent,
    } as unknown as MarketMeRepository;
    const bytes = new TextEncoder().encode("Local approved copy");
    const objectStore = { read: vi.fn(async () => bytes), putImmutable: vi.fn(async () => undefined) };
    const ingestion = { getConnectionAccessToken: vi.fn() } as unknown as StorageIngestionService;
    const service = new ContentPackageService({ repository, ingestion, objectStore, now: () => new Date("2026-08-06T00:00:00Z") });
    expect(await service.processReadyEvents()).toEqual({ processed: 1, deferred: 0, ignored: 0, failed: 0 });
    expect(ingestion.getConnectionAccessToken).not.toHaveBeenCalled();
    const saved = saveContentPackage.mock.calls[0][0] as { assets: { extractedText?: string }[] };
    expect(saved.assets[0].extractedText).toBe("Local approved copy");
  });

  it("keeps a resource-truncated document in explicit review", async () => {
    const saveContentPackage = vi.fn(async (input: unknown) => input);
    const repository = {
      claimIngestionEvents: vi.fn(async () => [{ id: "event-doc", workspaceId: "workspace-1", smartSourceId: "source-1", providerItemId: "file-doc", eventKind: "discovered", attemptCount: 1 }]),
      getSmartSource: vi.fn(async () => ({ ...source, contextPackIds: [], allowedMimeTypes: ["application/pdf"] })),
      getSourceItemByProviderId: vi.fn(async () => ({
        id: "item-doc", workspaceId: "workspace-1", smartSourceId: "source-1", providerItemId: "file-doc",
        name: "brief.pdf", displayPath: "/brief.pdf", mimeType: "application/pdf", isFolder: false,
        modifiedAt: "2026-08-01T00:00:00Z", firstSeenAt: "2026-08-01T00:00:00Z", lastSeenAt: "2026-08-01T00:00:00Z",
      })),
      listSourceItems: vi.fn(async () => []), listContextPacks: vi.fn(async () => []), saveContentPackage,
      finishIngestionEvent: vi.fn(async () => undefined),
    } as unknown as MarketMeRepository;
    const connector = { downloadContent: vi.fn(async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" })) } as unknown as StorageConnector;
    const mediaProcessor = {
      process: vi.fn(async () => [{
        clientKey: "original", role: "original", fileName: "brief.pdf", mimeType: "application/pdf",
        contentHash: `sha256:${"a".repeat(64)}`, objectKey: `originals/${"a".repeat(64)}/source`, byteSize: 4,
        processingVersion: "document-v1", recipe: {}, mediaStatus: "processed", scanStatus: "clean", scanEngine: "clamd-test", scanScannedAt: "2026-08-12T00:00:00.000Z", scanRevision: 1,
        altTextStatus: "not_applicable", extractedText: "partial", extractionStatus: "completed",
        metadata: { documentExtraction: { state: "truncated" } },
      }]),
    } as unknown as MediaProcessor;
    const ingestion = { getConnectionAccessToken: vi.fn(async () => ({ connector, accessToken: "access", connection: {} })) } as unknown as StorageIngestionService;
    const service = new ContentPackageService({ repository, ingestion, mediaProcessor, now: () => new Date("2026-08-06T00:00:00Z") });
    expect(await service.processReadyEvents()).toMatchObject({ processed: 1, failed: 0 });
    expect(saveContentPackage.mock.calls[0][0]).toMatchObject({ status: "needs_review" });
  });
});
