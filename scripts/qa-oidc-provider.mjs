import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.QA_OIDC_PORT ?? 3101);
const issuer = `http://${host}:${port}`;
const clientId = process.env.QA_OIDC_CLIENT_ID ?? "market-me-qa";
const clientSecret = process.env.QA_OIDC_CLIENT_SECRET ?? "market-me-qa-secret";
const redirectUri = process.env.QA_OIDC_REDIRECT_URI ?? "http://localhost:3000/api/auth/oidc/callback";
const email = process.env.QA_OIDC_EMAIL ?? "qa-oidc-owner@market-me.local";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "qa-key", use: "sig", alg: "RS256" };
const codes = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", issuer);
    if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return json(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (request.method === "GET" && url.pathname === "/keys") return json(response, 200, { keys: [jwk] });
    if (request.method === "GET" && url.pathname === "/authorize") {
      const required = ["state", "nonce", "code_challenge"];
      if (
        url.searchParams.get("client_id") !== clientId ||
        url.searchParams.get("redirect_uri") !== redirectUri ||
        url.searchParams.get("response_type") !== "code" ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        !required.every((name) => url.searchParams.get(name))
      ) return json(response, 400, { error: "invalid_authorization_request" });
      const code = randomBytes(32).toString("base64url");
      codes.set(code, {
        nonce: url.searchParams.get("nonce"),
        challenge: url.searchParams.get("code_challenge"),
      });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", url.searchParams.get("state"));
      response.writeHead(303, { location: callback.toString(), "cache-control": "no-store" });
      return response.end();
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const body = new URLSearchParams(await readBody(request));
      const code = body.get("code");
      const grant = code ? codes.get(code) : undefined;
      if (
        !grant ||
        body.get("grant_type") !== "authorization_code" ||
        body.get("client_id") !== clientId ||
        body.get("client_secret") !== clientSecret ||
        body.get("redirect_uri") !== redirectUri ||
        sha256(body.get("code_verifier") ?? "") !== grant.challenge
      ) return json(response, 400, { error: "invalid_grant" });
      codes.delete(code);
      const now = Math.floor(Date.now() / 1000);
      return json(response, 200, {
        id_token: jwt({
          iss: issuer,
          sub: "qa-owner-subject",
          aud: clientId,
          exp: now + 300,
          iat: now,
          nonce: grant.nonce,
          email,
          email_verified: true,
          name: "QA OIDC Owner",
        }),
      });
    }
    return json(response, 404, { error: "not_found" });
  } catch {
    return json(response, 500, { error: "qa_provider_error" });
  }
});

server.listen(port, host, () => process.stdout.write(`QA OIDC provider ready at ${issuer}\n`));

function jwt(claims) {
  const header = encode({ alg: "RS256", kid: "qa-key", typ: "JWT" });
  const payload = encode(claims);
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function sha256(value) { return createHash("sha256").update(value).digest("base64url"); }
function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("request_too_large");
  }
  return body;
}
