import { describe, expect, it, vi } from "vitest";
import { GoogleDriveConnector, MicrosoftStorageConnector } from "./oauth";

const googleConfig = {
  provider: "google_drive" as const,
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "http://localhost/callback",
};

const microsoftConfig = {
  provider: "onedrive" as const,
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "http://localhost/callback",
  tenantId: "common",
};

describe("storage discovery", () => {
  it("normalizes a Google Drive folder page", async () => {
    const request = vi.fn(async (_input: string | URL | Request) => Response.json({
      files: [{
        id: "file-1",
        name: "Brief.pdf",
        mimeType: "application/pdf",
        size: "42",
        modifiedTime: "2026-08-05T20:00:00Z",
        md5Checksum: "abc",
        parents: ["folder-1"],
      }],
      nextPageToken: "page-2",
    }));
    const connector = new GoogleDriveConnector(googleConfig, request);
    const page = await connector.listFolderPage({ accessToken: "token", providerLocationId: "folder-1" });
    expect(page.entries[0]).toEqual(expect.objectContaining({
      provider: "google_drive",
      providerItemId: "file-1",
      providerParentId: "folder-1",
      sizeBytes: 42,
      contentHash: "md5:abc",
    }));
    expect(page.nextPageToken).toBe("page-2");
    expect(String(request.mock.calls[0][0])).toContain("supportsAllDrives=true");
  });

  it("normalizes Microsoft delta pages and deleted facets", async () => {
    const request = vi.fn(async (_input: string | URL | Request) => Response.json({
      value: [
        { id: "item-1", name: "Photo.jpg", size: 84, file: { mimeType: "image/jpeg", hashes: { quickXorHash: "xor" } }, parentReference: { id: "folder-1" } },
        { id: "item-2", deleted: {} },
      ],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=next",
    }));
    const connector = new MicrosoftStorageConnector(microsoftConfig, request);
    const page = await connector.listChangePage({ accessToken: "token", providerLocationId: "folder-1" });
    expect(page.entries[0]).toEqual(expect.objectContaining({ providerItemId: "item-1", contentHash: "graph:xor" }));
    expect(page.deletedProviderItemIds).toEqual(["item-2"]);
    expect(page.newCursor).toContain("graph.microsoft.com");
  });

  it("rejects untrusted Microsoft continuation URLs", async () => {
    const connector = new MicrosoftStorageConnector(microsoftConfig, vi.fn());
    await expect(connector.listChangePage({ accessToken: "token", cursor: "https://attacker.example/delta" }))
      .rejects.toThrow("untrusted Microsoft Graph");
  });
});
