import { DiscordWebhookConnector, encodeMailchimpCredentialBundle, encryptToken, MailchimpEmailConnector, MastodonAccountConnector, SlackWebhookConnector } from "@market-me/connectors";
import type { StoredChannelConnection } from "@market-me/database";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getPublishingRepository } from "@/server/database";
import { channelConnectionSchema } from "@/server/publishing-schema";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId, "read");
    const data = (await getPublishingRepository().listChannelConnections(workspace.workspaceId)).map(publicConnection);
    return Response.json({ data });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = channelConnectionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Check the channel connection fields.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const serverConfiguration = getServerConfiguration();
    const key = serverConfiguration.connectorTokenEncryptionKey;
    if (!key) return Response.json({ error: { code: "vault_unavailable", message: "CONNECTOR_TOKEN_ENCRYPTION_KEY is required." } }, { status: 503 });
    let test;
    let credential: string;
    let configuration: Record<string, unknown>;
    let capabilities: Record<string, unknown>;
    if (parsed.data.provider === "discord_webhook" || parsed.data.provider === "slack_webhook") {
      const connector = parsed.data.provider === "discord_webhook"
        ? new DiscordWebhookConnector(parsed.data.webhookUrl)
        : new SlackWebhookConnector(parsed.data.webhookUrl);
      test = await connector.testConnection();
      credential = parsed.data.webhookUrl;
      configuration = { ...test.providerIdentity };
      capabilities = connector.manifest as unknown as Record<string, unknown>;
    } else if (parsed.data.provider === "mailchimp_email") {
      const connector = new MailchimpEmailConnector(parsed.data.apiKey);
      test = await connector.testAudience(parsed.data.audienceId);
      credential = encodeMailchimpCredentialBundle({ apiKey: parsed.data.apiKey });
      configuration = { ...test.providerIdentity, fromName: parsed.data.fromName, replyTo: parsed.data.replyTo.toLowerCase() };
      capabilities = connector.manifest as unknown as Record<string, unknown>;
    } else {
      const connector = new MastodonAccountConnector(
        parsed.data.instanceOrigin, parsed.data.accessToken, serverConfiguration.mastodonAllowedHosts,
      );
      test = await connector.testConnection();
      credential = parsed.data.accessToken;
      configuration = { ...(test.providerConfiguration ?? test.providerIdentity) };
      capabilities = test.capabilities as unknown as Record<string, unknown>;
    }
    if (!test.ok) return Response.json({ error: { code: "connection_test_failed", message: test.error } }, { status: 422 });
    const saved = await getPublishingRepository().saveChannelConnection({
      workspaceId: workspace.workspaceId, provider: parsed.data.provider, name: parsed.data.name,
      encryptedCredentials: encryptToken(credential, key), configuration,
      capabilities,
    }, user.id);
    return Response.json({ data: publicConnection(saved) }, { status: 201 });
  } catch (error) { return apiError(error); }
}

function publicConnection(connection: StoredChannelConnection) {
  return { ...connection, encryptedCredentials: undefined };
}
