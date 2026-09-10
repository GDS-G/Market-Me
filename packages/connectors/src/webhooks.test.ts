import { describe, expect, it, vi } from "vitest";
import { GoogleDriveConnector, MicrosoftStorageConnector } from "./oauth";

describe("provider webhook subscriptions", () => {
  it("creates and stops a Google Drive changes channel", async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("startPageToken")) return Response.json({ startPageToken: "page-1" });
      if (url.includes("changes/watch")) {
        const body = JSON.parse(String(init?.body)) as { id: string; token: string; address: string };
        expect(body).toEqual(expect.objectContaining({ token: "state", address: "https://market.example/api/webhooks/google-drive" }));
        expect(url).toContain("pageToken=page-1");
        return Response.json({ id: body.id, resourceId: "resource-1", expiration: String(Date.now() + 60_000) });
      }
      expect(url).toContain("channels/stop");
      expect(JSON.parse(String(init?.body))).toEqual({ id: expect.any(String), resourceId: "resource-1" });
      return new Response(null, { status: 204 });
    });
    const connector = new GoogleDriveConnector({
      provider: "google_drive",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://market.example/callback",
    }, request);
    const created = await connector.createWebhookSubscription({
      accessToken: "access",
      callbackUrl: "https://market.example/api/webhooks/google-drive",
      clientState: "state",
      resource: "changes",
    });
    expect(created).toEqual(expect.objectContaining({ providerResourceId: "resource-1", resource: "changes" }));
    await connector.deleteWebhookSubscription({
      accessToken: "access",
      providerSubscriptionId: created.providerSubscriptionId,
      providerResourceId: created.providerResourceId,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("creates, renews, and removes a Microsoft root subscription", async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        expect(body).toEqual(expect.objectContaining({
          resource: "me/drive/root",
          clientState: "state",
          notificationUrl: "https://market.example/api/webhooks/microsoft-graph",
        }));
        return Response.json({ id: "subscription-1", expirationDateTime: body.expirationDateTime }, { status: 201 });
      }
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        return Response.json({ id: "subscription-1", expirationDateTime: body.expirationDateTime });
      }
      expect(init?.method).toBe("DELETE");
      expect(url).toContain("subscription-1");
      return new Response(null, { status: 204 });
    });
    const connector = new MicrosoftStorageConnector({
      provider: "onedrive",
      clientId: "client",
      clientSecret: "secret",
      tenantId: "common",
      redirectUri: "https://market.example/callback",
    }, request);
    const created = await connector.createWebhookSubscription({
      accessToken: "access",
      callbackUrl: "https://market.example/api/webhooks/microsoft-graph",
      clientState: "state",
      resource: "me/drive/root",
    });
    expect(created.providerSubscriptionId).toBe("subscription-1");
    expect((await connector.renewWebhookSubscription({
      accessToken: "access",
      providerSubscriptionId: created.providerSubscriptionId,
    })).expiresAt).toBeInstanceOf(Date);
    await connector.deleteWebhookSubscription({
      accessToken: "access",
      providerSubscriptionId: created.providerSubscriptionId,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects arbitrary Microsoft subscription resources", async () => {
    const connector = new MicrosoftStorageConnector({
      provider: "sharepoint",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://market.example/callback",
    }, vi.fn());
    await expect(connector.createWebhookSubscription({
      accessToken: "access",
      callbackUrl: "https://market.example/api/webhooks/microsoft-graph",
      clientState: "state",
      resource: "users/victim/messages",
    })).rejects.toThrow("Unsupported Microsoft drive webhook resource");
  });
});
