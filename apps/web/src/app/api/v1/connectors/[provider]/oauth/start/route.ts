import { createOAuthEntropy, sha256, STORAGE_PROVIDERS } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getStorageConnector } from "@/server/connectors";
import { getRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: rawProvider } = await context.params;
    if (!STORAGE_PROVIDERS.includes(rawProvider as (typeof STORAGE_PROVIDERS)[number])) {
      return Response.json({ error: { code: "provider_not_found", message: "Unknown storage provider." } }, { status: 404 });
    }
    const provider = rawProvider as (typeof STORAGE_PROVIDERS)[number];
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string; returnTo?: string };
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "write");
    const config = getServerConfiguration();
    if (!config.connectorTokenEncryptionKey) {
      return Response.json({
        error: { code: "connector_encryption_not_configured", message: "Configure CONNECTOR_TOKEN_ENCRYPTION_KEY before connecting storage." },
      }, { status: 503 });
    }
    const connector = getStorageConnector(provider);
    if (!connector.status.configured) {
      return Response.json({
        error: { code: "connector_not_configured", message: `Missing ${connector.status.missingVariables.join(", ")}.` },
      }, { status: 503 });
    }
    const entropy = createOAuthEntropy();
    const authorization = connector.createAuthorizationRequest(entropy);
    await getRepository().saveOAuthState({
      stateHash: sha256(entropy.state),
      workspaceId: workspace.workspaceId,
      userId: user.id,
      provider,
      codeVerifier: entropy.codeVerifier,
      returnTo: body.returnTo?.startsWith("/") ? body.returnTo : "/integrations",
      expiresAt: authorization.expiresAt,
    });
    return Response.json({ data: { authorizationUrl: authorization.authorizationUrl } });
  } catch (error) {
    return apiError(error);
  }
}
