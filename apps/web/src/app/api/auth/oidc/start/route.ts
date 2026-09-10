import { NextRequest, NextResponse } from "next/server";
import { getServerConfiguration } from "@/server/config";
import { getRepository } from "@/server/database";
import {
  createOidcAuthorizationUrl,
  createOidcEntropy,
  hashOidcValue,
  oidcConfigurationFrom,
  safeReturnTo,
  OidcError,
} from "@/server/oidc";

const OIDC_STATE_COOKIE = "mm_oidc_state";
const STATE_DURATION_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const server = getServerConfiguration();
    const configuration = oidcConfigurationFrom({
      issuer: server.oidcIssuer,
      clientId: server.oidcClientId,
      clientSecret: server.oidcClientSecret,
      appBaseUrl: server.appBaseUrl,
    });
    if (!configuration) return NextResponse.redirect(new URL("/login?error=oidc_not_configured", server.appBaseUrl), 303);

    const entropy = createOidcEntropy();
    const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
    const authorizationUrl = await createOidcAuthorizationUrl(configuration, entropy);
    const expiresAt = new Date(Date.now() + STATE_DURATION_MS);
    await getRepository().saveOidcAuthState({
      stateHash: hashOidcValue(entropy.state),
      issuer: configuration.issuer,
      nonceHash: hashOidcValue(entropy.nonce),
      codeVerifier: entropy.codeVerifier,
      returnTo,
      expiresAt,
    });
    const response = NextResponse.redirect(authorizationUrl, 303);
    response.cookies.set(OIDC_STATE_COOKIE, entropy.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/oidc",
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    const code = error instanceof OidcError ? error.code : "oidc_sign_in_failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, getServerConfiguration().appBaseUrl), 303);
  }
}
