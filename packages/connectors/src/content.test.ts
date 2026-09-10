import { describe, expect, it, vi } from "vitest";
import { downloadGoogleContent, downloadMicrosoftContent } from "./content";

describe("bounded provider content downloads", () => {
  it("exports Google Workspace documents as text", async () => {
    const request = vi.fn(async (_input: string | URL | Request) => new Response("Approved launch brief", { headers: { "content-type": "text/plain" } }));
    const result = await downloadGoogleContent(request, {
      accessToken: "access",
      providerItemId: "doc-1",
      mimeType: "application/vnd.google-apps.document",
      maxBytes: 1024,
    });
    expect(new TextDecoder().decode(result.bytes)).toBe("Approved launch brief");
    expect(String(request.mock.calls[0][0])).toContain("/export?mimeType=text%2Fplain");
  });

  it("follows Microsoft preauthenticated redirects without forwarding authorization", async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => request.mock.calls.length === 1
      ? new Response(null, { status: 302, headers: { location: "https://files.example/download" } })
      : new Response("content", { headers: { "content-type": "text/plain", "content-length": "7" } }));
    const result = await downloadMicrosoftContent(request, "sharepoint", {
      accessToken: "access",
      providerItemId: "item-1",
      providerLocationId: "drive-1:folder-1",
      mimeType: "text/plain",
      maxBytes: 100,
    });
    expect(new TextDecoder().decode(result.bytes)).toBe("content");
    expect(String(request.mock.calls[0][0])).toContain("/drives/drive-1/items/item-1/content");
    expect((request.mock.calls[1][1]?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("rejects content larger than the configured limit", async () => {
    await expect(downloadGoogleContent(
      vi.fn(async () => new Response("too large", { headers: { "content-length": "500" } })),
      { accessToken: "access", providerItemId: "file-1", mimeType: "text/plain", maxBytes: 10 },
    )).rejects.toThrow("byte limit");
  });
});
