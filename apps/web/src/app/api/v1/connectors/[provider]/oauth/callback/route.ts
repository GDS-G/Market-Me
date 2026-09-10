import { encryptToken, sha256, STORAGE_PROVIDERS } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { getServerConfiguration } from "@/server/config";
import { getStorageConnector } from "@/server/connectors";
import { getRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: rawProvider } = await context.params;
    if (!STORAGE_PROVIDERS.includes(rawProvider as (typeof STORAGE_PROVIDERS)[number])) {
      return Response.json({ error: { code: "provider_not_found", message: "Unknown storage provider." } }, { status: 404 });
    }
    const provider = rawProvider as (typeof STORAGE_PROVIDERS)[number];
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error");
    if (providerError) return Response.redirect(new URL(`/integrations?oauth=error&reason=${encodeURIComponent(providerError)}`, url));
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code) return Response.json({ error: { code: "oauth_callback_invalid", message: "Missing OAuth code or state." } }, { status: 400 });

    const repository = getRepository();
    const storedState = await repository.consumeOAuthState(sha256(state));
    if (!storedState || storedState.provider !== provider) {
      return Response.json({ error: { code: "oauth_state_invalid", message: "OAuth state is invalid or expired." } }, { status: 400 });
    }
    const config = getServerConfiguration();
    if (!config.connectorTokenEncryptionKey) throw new Error("Connector token encryption is not configured");
    const tokenSet = await getStorageConnector(provider).exchangeAuthorizationCode({
      code,
      codeVerifier: storedState.codeVerifier,
    });
    await repository.saveStorageConnection({
      workspaceId: storedState.workspaceId,
      provider,
      displayName: provider === "google_drive" ? "Google Drive" : provider === "onedrive" ? "OneDrive" : "SharePoint",
      encryptedAccessToken: encryptToken(tokenSet.accessToken, config.connectorTokenEncryptionKey),
      encryptedRefreshToken: tokenSet.refreshToken
        ? encryptToken(tokenSet.refreshToken, config.connectorTokenEncryptionKey)
        : undefined,
      scopes: tokenSet.scopes,
      accessTokenExpiresAt: tokenSet.expiresAt,
      createdBy: storedState.userId,
    });
    return Response.redirect(new URL(`${storedState.returnTo}?oauth=connected&provider=${provider}`, url));
  } catch (error) {
    return apiError(error);
  }
}
