import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStorageConnector } from "./factory";
import { createOAuthEntropy, decryptToken, encryptToken, sha256 } from "./oauth";

const environment = {
  appBaseUrl: "http://localhost:3000",
  googleClientId: "google-client",
  googleClientSecret: "google-secret",
  microsoftClientId: "microsoft-client",
  microsoftClientSecret: "microsoft-secret",
  microsoftTenantId: "common",
};

describe("connector OAuth", () => {
  it("creates independent high-entropy state and PKCE values", () => {
    const first = createOAuthEntropy();
    const second = createOAuthEntropy();
    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier.length).toBeGreaterThan(64);
    expect(sha256(first.codeVerifier)).toHaveLength(43);
  });

  it("builds a Google Drive authorization request with PKCE", () => {
    const connector = createStorageConnector("google_drive", environment);
    const request = connector.createAuthorizationRequest({ state: "state", codeVerifier: "verifier" });
    const url = new URL(request.authorizationUrl);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
  });

  it("builds a Microsoft authorization request with offline file access", () => {
    const connector = createStorageConnector("onedrive", environment);
    const request = connector.createAuthorizationRequest({ state: "state", codeVerifier: "verifier" });
    const url = new URL(request.authorizationUrl);
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Files.Read");
    expect(url.searchParams.get("scope")).not.toContain("Files.Read.All");
  });

  it("round trips encrypted connector tokens", () => {
    const key = randomBytes(32).toString("base64");
    const envelope = encryptToken("sensitive-token", key);
    expect(envelope).not.toContain("sensitive-token");
    expect(decryptToken(envelope, key)).toBe("sensitive-token");
  });
});
