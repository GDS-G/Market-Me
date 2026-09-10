import { ChannelConnectorError, decryptToken, MastodonAccountConnector } from "@market-me/connectors";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getPublishingRepository } from "@/server/database";

const requestSchema = z.object({ workspaceId: z.string().uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: { code: "validation_failed", message: "A workspace is required." } }, { status: 422 });
    }
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const publicationActionId = (await context.params).id;
    const repository = getPublishingRepository();
    const target = await repository.getMastodonStatusReportTarget(workspace.workspaceId, publicationActionId);
    if (!target?.action.providerExternalId || !target.action.providerUrl) {
      return Response.json({ error: { code: "not_found", message: "A succeeded Mastodon status identity is required." } }, { status: 404 });
    }
    if (target.connection.status !== "active") {
      return Response.json({ error: { code: "connection_unavailable", message: "Recreate the Mastodon connection before refreshing metrics." } }, { status: 409 });
    }
    const serverConfiguration = getServerConfiguration();
    const encryptionKey = serverConfiguration.connectorTokenEncryptionKey;
    if (!encryptionKey) {
      return Response.json({ error: { code: "vault_unavailable", message: "CONNECTOR_TOKEN_ENCRYPTION_KEY is required." } }, { status: 503 });
    }
    const connector = new MastodonAccountConnector(
      target.instanceOrigin,
      decryptToken(target.connection.encryptedCredentials, encryptionKey),
      serverConfiguration.mastodonAllowedHosts,
    );
    const report = await connector.getStatusReport(target.action.providerExternalId, target.accountId);
    const result = await repository.recordMastodonStatusReportSnapshot(
      workspace.workspaceId,
      publicationActionId,
      report,
      user.id,
    );
    return Response.json({ data: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ChannelConnectorError) {
      const status = error.kind === "rate_limit" ? 429 : error.kind === "transient" ? 503 : error.kind === "authorization" ? 403 : 422;
      return Response.json({ error: { code: "provider_report_unavailable", message: error.message } }, { status });
    }
    return apiError(error);
  }
}
