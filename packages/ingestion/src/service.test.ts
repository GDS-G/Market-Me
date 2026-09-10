import { randomBytes } from "node:crypto";
import { encryptToken, type StorageConnector } from "@market-me/connectors";
import type { MarketMeRepository, StoredSmartSource } from "@market-me/database";
import { describe, expect, it, vi } from "vitest";
import { StorageIngestionService } from "./service";

const source: StoredSmartSource = {
  id: "source-1",
  workspaceId: "workspace-1",
  storageConnectionId: "connection-1",
  name: "Launches",
  provider: "google_drive",
  locations: [{ providerLocationId: "root", displayPath: "/Launches" }],
  recursive: true,
  readinessMode: "related_files",
  stabilizationWindowSeconds: 120,
  relatedFileMinimum: 2,
  allowedMimeTypes: ["image/*", "application/pdf"],
  ignorePatterns: ["**/drafts/**"],
  contextPackIds: [],
  autonomyMode: "approval_required",
  enabled: true,
  version: 1,
  createdAt: "2026-08-05T00:00:00Z",
  updatedAt: "2026-08-05T00:00:00Z",
};

describe("StorageIngestionService", () => {
  it("recursively discovers eligible Google Drive files and saves a cursor", async () => {
    const key = randomBytes(32).toString("base64");
    const applySourceItemChanges = vi.fn(async (input: { upserts: readonly { isFolder: boolean; name: string }[] }) => ({
      discoveredCount: input.upserts.filter((item) => !item.isFolder).length,
      changedCount: 0,
      deletedCount: 0,
    }));
    const saveConnectorCursor = vi.fn(async () => undefined);
    const repository = {
      getSmartSource: vi.fn(async () => source),
      getStorageConnection: vi.fn(async () => ({
        id: "connection-1",
        workspaceId: "workspace-1",
        provider: "google_drive",
        displayName: "Google Drive",
        status: "active",
        scopes: ["drive.readonly"],
        encryptedAccessToken: encryptToken("access", key),
      })),
      startConnectorSyncRun: vi.fn(async () => "run-1"),
      finishConnectorSyncRun: vi.fn(async () => undefined),
      getConnectorCursor: vi.fn(async () => undefined),
      saveConnectorCursor,
      applySourceItemChanges,
      listSourceItems: vi.fn(async () => []),
    } as unknown as MarketMeRepository;
    const listFolderPage = vi.fn(async ({ providerLocationId }: { providerLocationId: string }) => providerLocationId === "root"
      ? {
          entries: [
            { provider: "google_drive" as const, providerItemId: "folder", providerParentId: "root", name: "Approved", mimeType: "application/vnd.google-apps.folder", isFolder: true },
            { provider: "google_drive" as const, providerItemId: "image", providerParentId: "root", name: "hero.jpg", mimeType: "image/jpeg", isFolder: false },
            { provider: "google_drive" as const, providerItemId: "text", providerParentId: "root", name: "notes.txt", mimeType: "text/plain", isFolder: false },
          ],
        }
      : {
          entries: [{ provider: "google_drive" as const, providerItemId: "pdf", providerParentId: "folder", name: "brief.pdf", mimeType: "application/pdf", isFolder: false }],
        });
    const connector = {
      listFolderPage,
      listChangePage: vi.fn(async () => ({ entries: [], deletedProviderItemIds: [], newCursor: "cursor-1" })),
    } as unknown as StorageConnector;
    const service = new StorageIngestionService(repository, {
      tokenEncryptionKey: key,
      connectorFor: () => connector,
    });

    const result = await service.syncSmartSource("workspace-1", "source-1");
    expect(result).toEqual(expect.objectContaining({ status: "completed", discoveredCount: 2, inspectedCount: 4 }));
    expect(listFolderPage).toHaveBeenCalledTimes(2);
    expect(applySourceItemChanges.mock.calls.flatMap(([input]) => input.upserts).some((item) => item.name === "notes.txt")).toBe(false);
    expect(saveConnectorCursor).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-1" }));
  });

  it("refreshes an expired token before sampling a location", async () => {
    const key = randomBytes(32).toString("base64");
    const updateStorageConnectionTokens = vi.fn(async () => undefined);
    const repository = {
      getStorageConnection: vi.fn(async () => ({
        id: "connection-1",
        workspaceId: "workspace-1",
        provider: "google_drive",
        displayName: "Google Drive",
        status: "active",
        scopes: ["drive.readonly"],
        encryptedAccessToken: encryptToken("expired", key),
        encryptedRefreshToken: encryptToken("refresh", key),
        accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      })),
      updateStorageConnectionTokens,
    } as unknown as MarketMeRepository;
    const connector = {
      refreshAccessToken: vi.fn(async () => ({ accessToken: "fresh", scopes: ["drive.readonly"], tokenType: "Bearer" })),
      listFolderPage: vi.fn(async (input: { accessToken: string }) => {
        expect(input.accessToken).toBe("fresh");
        return { entries: [] };
      }),
    } as unknown as StorageConnector;
    const service = new StorageIngestionService(repository, { tokenEncryptionKey: key, connectorFor: () => connector });
    await service.sampleLocation({ workspaceId: "workspace-1", connectionId: "connection-1", providerLocationId: "root" });
    expect(updateStorageConnectionTokens).toHaveBeenCalledOnce();
  });
});
