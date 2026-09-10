import { NextRequest, NextResponse } from "next/server";
import { createUserSession } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getRepository } from "@/server/database";
import {
  exchangeAndVerifyOidcCode,
  hashOidcValue,
  oidcValuesEqual,
  oidcConfigurationFrom,
  OidcError,
} from "@/server/oidc";

const OIDC_STATE_COOKIE = "mm_oidc_state";

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get(OIDC_STATE_COOKIE)?.value;
  if (
    !state ||
    state.length > 256 ||
    !cookieState ||
    !oidcValuesEqual(state, cookieState)
  ) {
    return loginError("oidc_state_invalid");
  }

  const repository = getRepository();
  const stored = await repository.consumeOidcAuthState(hashOidcValue(state));
  if (!stored) return loginError("oidc_state_invalid");
  if (request.nextUrl.searchParams.has("error")) return loginError("oidc_provider_denied");

  try {
    const server = getServerConfiguration();
    const configuration = oidcConfigurationFrom({
      issuer: server.oidcIssuer,
      clientId: server.oidcClientId,
      clientSecret: server.oidcClientSecret,
      appBaseUrl: server.appBaseUrl,
    });
    if (!configuration || configuration.issuer !== stored.issuer) {
      return loginError("oidc_configuration_changed");
    }
    const identity = await exchangeAndVerifyOidcCode(configuration, {
      code: request.nextUrl.searchParams.get("code") ?? "",
      codeVerifier: stored.codeVerifier,
      expectedNonceHash: stored.nonceHash,
    });
    const normalizedEmail = identity.email.trim().toLowerCase();
    const signIn = await repository.completeOidcSignIn({
      ...identity,
      allowBootstrap: server.oidcBootstrapEmails.includes(normalizedEmail),
    });
    if (signIn.status === "not_provisioned") return loginError("account_not_provisioned");
    await createUserSession(signIn.user.id);
    const response = NextResponse.redirect(new URL(stored.returnTo, server.appBaseUrl), 303);
    clearStateCookie(response);
    return response;
  } catch (error) {
    const code = error instanceof OidcError ? error.code : "oidc_sign_in_failed";
    return loginError(code);
  }
}

function loginError(code: string): NextResponse {
  const allowedCode = /^[a-z0-9_]{1,64}$/u.test(code) ? code : "oidc_sign_in_failed";
  const response = NextResponse.redirect(new URL(`/login?error=${allowedCode}`, getServerConfiguration().appBaseUrl), 303);
  clearStateCookie(response);
  return response;
}

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(OIDC_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oidc",
    expires: new Date(0),
  });
}
