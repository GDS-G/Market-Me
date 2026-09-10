import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createOidcAuthorizationUrl,
  exchangeAndVerifyOidcCode,
  hashOidcValue,
  oidcConfigurationFrom,
  safeReturnTo,
  type OidcRuntimeConfiguration,
} from "./oidc";

const issuer = "https://identity.example.test/tenant";
const clientId = "market-me-client";
const nonce = "test-nonce-with-enough-entropy";
const configuration: OidcRuntimeConfiguration = {
  issuer,
  clientId,
  clientSecret: "server-only-secret",
  redirectUri: "https://market-me.example.test/api/auth/oidc/callback",
};
const discovery = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/keys`,
  id_token_signing_alg_values_supported: ["RS256"],
};

let privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
let publicJwk: Record<string, unknown>;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "key-1", use: "sig", alg: "RS256" };
});

afterEach(() => vi.unstubAllGlobals());

describe("OIDC authentication", () => {
  it("builds an authorization-code request with PKCE, state, and nonce", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(discovery)));
    const url = new URL(await createOidcAuthorizationUrl(configuration, {
      state: "browser-state",
      nonce,
      codeVerifier: "v".repeat(64),
    }));
    expect(url.origin + url.pathname).toBe(discovery.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: clientId,
      redirect_uri: configuration.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: "browser-state",
      nonce,
      code_challenge_method: "S256",
      code_challenge: hashOidcValue("v".repeat(64)),
    });
  });

  it("exchanges a code and verifies issuer, signature, audience, nonce, and email", async () => {
    const idToken = signedToken();
    const fetchMock = providerFetch(idToken);
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeAndVerifyOidcCode(configuration, {
      code: "one-time-code",
      codeVerifier: "v".repeat(64),
      expectedNonceHash: hashOidcValue(nonce),
    })).resolves.toEqual({
      issuer,
      subject: "subject-123",
      email: "owner@example.test",
      displayName: "Market Owner",
    });
    const tokenRequest = fetchMock.mock.calls.find(([url]) => url === discovery.token_endpoint);
    const body = new URLSearchParams(String(tokenRequest?.[1]?.body));
    expect(body.get("client_secret")).toBe("server-only-secret");
    expect(body.get("code_verifier")).toBe("v".repeat(64));
  });

  it("rejects a validly signed token with the wrong nonce", async () => {
    vi.stubGlobal("fetch", providerFetch(signedToken({ nonce: "attacker-nonce" })));
    await expect(exchangeAndVerifyOidcCode(configuration, {
      code: "code",
      codeVerifier: "v".repeat(64),
      expectedNonceHash: hashOidcValue(nonce),
    })).rejects.toMatchObject({ code: "oidc_nonce_invalid" });
  });

  it("requires the provider to assert a verified email", async () => {
    vi.stubGlobal("fetch", providerFetch(signedToken({ email_verified: false })));
    await expect(exchangeAndVerifyOidcCode(configuration, {
      code: "code",
      codeVerifier: "v".repeat(64),
      expectedNonceHash: hashOidcValue(nonce),
    })).rejects.toMatchObject({ code: "oidc_email_unverified" });
  });

  it("rejects a token minted for another client", async () => {
    vi.stubGlobal("fetch", providerFetch(signedToken({ aud: "another-client" })));
    await expect(exchangeAndVerifyOidcCode(configuration, {
      code: "code",
      codeVerifier: "v".repeat(64),
      expectedNonceHash: hashOidcValue(nonce),
    })).rejects.toMatchObject({ code: "oidc_token_invalid" });
  });

  it("rejects issuer metadata substitution", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...discovery, issuer: "https://attacker.example" })));
    await expect(createOidcAuthorizationUrl(configuration, {
      state: "state",
      nonce,
      codeVerifier: "v".repeat(64),
    })).rejects.toMatchObject({ code: "oidc_discovery_invalid" });
  });

  it("accepts only local return paths and secure issuer configuration", () => {
    expect(safeReturnTo("/campaigns?view=ready")).toBe("/campaigns?view=ready");
    expect(safeReturnTo("https://attacker.example")).toBe("/smart-sources");
    expect(safeReturnTo("//attacker.example")).toBe("/smart-sources");
    expect(safeReturnTo("/safe\\..\\escape")).toBe("/smart-sources");
    expect(() => oidcConfigurationFrom({
      issuer: "http://identity.example.test",
      clientId,
      appBaseUrl: "https://market-me.example.test",
    })).toThrow("OIDC_ISSUER must use HTTPS");
  });
});

function providerFetch(idToken: string) {
  return vi.fn(async (...args: [url: string | URL | Request, init?: RequestInit]) => {
    const [url] = args;
    const value = String(url);
    if (value.endsWith("/.well-known/openid-configuration")) return jsonResponse(discovery);
    if (value === discovery.token_endpoint) return jsonResponse({ id_token: idToken });
    if (value === discovery.jwks_uri) return jsonResponse({ keys: [publicJwk] });
    return new Response("not found", { status: 404 });
  });
}

function signedToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "RS256", kid: "key-1", typ: "JWT" });
  const claims = base64url({
    iss: issuer,
    sub: "subject-123",
    aud: clientId,
    exp: now + 300,
    iat: now,
    nonce,
    email: "owner@example.test",
    email_verified: true,
    name: "Market Owner",
    ...overrides,
  });
  const input = `${header}.${claims}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
