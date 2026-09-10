import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export interface OidcRuntimeConfiguration {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported?: readonly string[];
}

interface OidcTokenResponse {
  id_token: string;
}

export interface VerifiedOidcIdentity {
  issuer: string;
  subject: string;
  email: string;
  displayName: string;
}

export class OidcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

export function hashOidcValue(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function oidcValuesEqual(left: string, right: string): boolean {
  return safeEqual(hashOidcValue(left), hashOidcValue(right));
}

export function createOidcEntropy(): {
  state: string;
  nonce: string;
  codeVerifier: string;
} {
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(64).toString("base64url"),
  };
}

export function safeReturnTo(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return "/smart-sources";
  }
  return value;
}

export function oidcConfigurationFrom(input: {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  appBaseUrl: string;
}): OidcRuntimeConfiguration | undefined {
  if (!input.issuer && !input.clientId && !input.clientSecret) return undefined;
  if (!input.issuer || !input.clientId) {
    throw new OidcError(
      "oidc_configuration_invalid",
      "OIDC_ISSUER and OIDC_CLIENT_ID must be configured together.",
    );
  }
  const issuer = validateIssuer(input.issuer);
  const baseUrl = validateHttpsUrl(input.appBaseUrl, "APP_BASE_URL", true);
  if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
    throw new OidcError("oidc_configuration_invalid", "APP_BASE_URL must be an origin without a path, query, or fragment.");
  }
  return {
    issuer,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: new URL("/api/auth/oidc/callback", baseUrl).toString(),
  };
}

export async function createOidcAuthorizationUrl(
  configuration: OidcRuntimeConfiguration,
  input: { state: string; nonce: string; codeVerifier: string },
): Promise<string> {
  const discovery = await discover(configuration);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", hashOidcValue(input.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeAndVerifyOidcCode(
  configuration: OidcRuntimeConfiguration,
  input: { code: string; codeVerifier: string; expectedNonceHash: string },
): Promise<VerifiedOidcIdentity> {
  if (!input.code || input.code.length > 8192) {
    throw new OidcError("oidc_callback_invalid", "The authorization code is invalid.");
  }
  const discovery = await discover(configuration);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: configuration.redirectUri,
    client_id: configuration.clientId,
    code_verifier: input.codeVerifier,
  });
  if (configuration.clientSecret) form.set("client_secret", configuration.clientSecret);
  const response = await boundedFetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
  });
  if (!response.ok) {
    throw new OidcError("oidc_exchange_failed", "The identity provider rejected the authorization code.");
  }
  const token = await readJson<OidcTokenResponse>(response, "OIDC token response");
  if (typeof token.id_token !== "string" || token.id_token.length > 64 * 1024) {
    throw new OidcError("oidc_token_invalid", "The identity provider did not return a valid ID token.");
  }
  return verifyIdToken(configuration, discovery, token.id_token, input.expectedNonceHash);
}

async function verifyIdToken(
  configuration: OidcRuntimeConfiguration,
  discovery: OidcDiscoveryDocument,
  token: string,
  expectedNonceHash: string,
): Promise<VerifiedOidcIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OidcError("oidc_token_invalid", "The ID token is malformed.");
  const header = decodeJson<Record<string, unknown>>(parts[0], "ID token header");
  const claims = decodeJson<Record<string, unknown>>(parts[1], "ID token claims");
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 255) {
    throw new OidcError("oidc_token_invalid", "The ID token signing algorithm is not allowed.");
  }
  if (
    discovery.id_token_signing_alg_values_supported &&
    !discovery.id_token_signing_alg_values_supported.includes("RS256")
  ) {
    throw new OidcError("oidc_token_invalid", "The provider does not advertise RS256 ID tokens.");
  }
  const jwksResponse = await boundedFetch(discovery.jwks_uri, { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new OidcError("oidc_keys_unavailable", "Provider signing keys are unavailable.");
  const jwks = await readJson<{ keys?: readonly JsonWebKey[] }>(jwksResponse, "OIDC signing keys");
  const jwk = jwks.keys?.find(
    (candidate) =>
      candidate.kid === header.kid &&
      candidate.kty === "RSA" &&
      (!candidate.use || candidate.use === "sig") &&
      (!candidate.alg || candidate.alg === "RS256"),
  );
  if (!jwk) throw new OidcError("oidc_key_not_found", "The ID token signing key was not found.");
  let validSignature = false;
  try {
    validSignature = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    throw new OidcError("oidc_token_invalid", "The ID token signature could not be verified.");
  }
  if (!validSignature) throw new OidcError("oidc_token_invalid", "The ID token signature is invalid.");

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== configuration.issuer) throw new OidcError("oidc_token_invalid", "The ID token issuer is invalid.");
  const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (!Array.isArray(audience) || !audience.every((value) => typeof value === "string") || !audience.includes(configuration.clientId)) {
    throw new OidcError("oidc_token_invalid", "The ID token audience is invalid.");
  }
  if ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== configuration.clientId) {
    throw new OidcError("oidc_token_invalid", "The ID token authorized party is invalid.");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now - 60) {
    throw new OidcError("oidc_token_expired", "The ID token has expired.");
  }
  if (typeof claims.iat !== "number" || claims.iat > now + 60) {
    throw new OidcError("oidc_token_invalid", "The ID token issue time is invalid.");
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + 60)) {
    throw new OidcError("oidc_token_invalid", "The ID token is not active yet.");
  }
  if (typeof claims.nonce !== "string" || !safeEqual(hashOidcValue(claims.nonce), expectedNonceHash)) {
    throw new OidcError("oidc_nonce_invalid", "The ID token nonce is invalid.");
  }
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255) {
    throw new OidcError("oidc_token_invalid", "The ID token subject is invalid.");
  }
  if (claims.email_verified !== true || typeof claims.email !== "string") {
    throw new OidcError("oidc_email_unverified", "A verified email address is required.");
  }
  const email = claims.email.trim();
  if (email.length < 3 || email.length > 320 || !email.includes("@")) {
    throw new OidcError("oidc_token_invalid", "The verified email address is invalid.");
  }
  const displayName = typeof claims.name === "string" && claims.name.trim()
    ? claims.name.trim().slice(0, 255)
    : email;
  return { issuer: configuration.issuer, subject: claims.sub, email, displayName };
}

async function discover(configuration: OidcRuntimeConfiguration): Promise<OidcDiscoveryDocument> {
  const discoveryUrl = `${configuration.issuer}/.well-known/openid-configuration`;
  const response = await boundedFetch(discoveryUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new OidcError("oidc_discovery_failed", "OIDC discovery is unavailable.");
  const document = await readJson<OidcDiscoveryDocument>(response, "OIDC discovery document");
  if (document.issuer !== configuration.issuer) {
    throw new OidcError("oidc_discovery_invalid", "OIDC discovery returned a different issuer.");
  }
  const allowLocalHttp = configuration.issuer.startsWith("http://");
  validateHttpsUrl(document.authorization_endpoint, "authorization endpoint", allowLocalHttp);
  validateHttpsUrl(document.token_endpoint, "token endpoint", allowLocalHttp);
  validateHttpsUrl(document.jwks_uri, "signing key endpoint", allowLocalHttp);
  return document;
}

function validateIssuer(value: string): string {
  const url = validateHttpsUrl(value, "OIDC_ISSUER", process.env.NODE_ENV !== "production");
  if (url.search || url.hash || url.username || url.password) {
    throw new OidcError("oidc_configuration_invalid", "OIDC_ISSUER must not contain credentials, a query, or a fragment.");
  }
  return url.toString().replace(/\/$/u, "");
}

function validateHttpsUrl(value: string, label: string, allowLocalHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcError("oidc_configuration_invalid", `${label} must be an absolute URL.`);
  }
  const localHttp = allowLocalHttp && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new OidcError("oidc_configuration_invalid", `${label} must use HTTPS.`);
  }
  if (url.username || url.password || url.hash) {
    throw new OidcError("oidc_configuration_invalid", `${label} must not contain credentials or a fragment.`);
  }
  return url;
}

async function boundedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OidcError("oidc_provider_unavailable", "The identity provider is unavailable.");
  }
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_DOCUMENT_BYTES) {
    throw new OidcError("oidc_response_invalid", `${label} is too large.`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) {
    throw new OidcError("oidc_response_invalid", `${label} is too large.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OidcError("oidc_response_invalid", `${label} is not valid JSON.`);
  }
}

function decodeJson<T>(value: string, label: string): T {
  if (!value || value.length > 64 * 1024) throw new OidcError("oidc_token_invalid", `${label} is invalid.`);
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new OidcError("oidc_token_invalid", `${label} is invalid.`);
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
