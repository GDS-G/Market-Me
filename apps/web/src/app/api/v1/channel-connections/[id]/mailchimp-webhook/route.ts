import {
  ChannelConnectorError,
  decodeMailchimpCredentialBundle,
  decryptToken,
  encodeMailchimpCredentialBundle,
  encryptToken,
  MailchimpEmailConnector,
} from "@market-me/connectors";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getPublishingRepository } from "@/server/database";
import { assessMailchimpWebhookHealth, webhooksEligibleForReplacement } from "@/server/mailchimp-webhook-management";

const workspaceSchema = z.object({ workspaceId: z.string().uuid() }).strict();
const provisionSchema = workspaceSchema.extend({ replaceExisting: z.boolean().optional().default(false) }).strict();
const manualSchema = workspaceSchema.extend({ signingSecret: z.string().trim().min(16).max(256) }).strict();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = workspaceSchema.safeParse({ workspaceId: new URL(request.url).searchParams.get("workspaceId") });
    if (!parsed.success) return validationResponse("A workspace ID is required.");
    const { workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "read");
    const setup = await loadSetup(workspace.workspaceId, (await context.params).id);
    if (setup instanceof Response) return setup;
    try {
      const webhooks = await setup.connector.listAudienceWebhooks(setup.audienceId);
      const health = assessMailchimpWebhookHealth({
        webhooks,
        callbackUrl: setup.callbackUrl,
        management: stringValue(setup.connection.configuration.webhookManagement),
        providerWebhookId: identifierValue(setup.connection.configuration.webhookProviderId),
        signingConfigured: Boolean(setup.credentials.webhookSigningSecret),
      });
      return Response.json({ data: { ...health, callbackUrl: setup.callbackUrl, signingConfigured: Boolean(setup.credentials.webhookSigningSecret) } });
    } catch (error) { return providerErrorResponse(error); }
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = provisionSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse("A workspace ID and explicit replacement choice are required.");
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const connectionId = (await context.params).id;
    const setup = await loadSetup(workspace.workspaceId, connectionId);
    if (setup instanceof Response) return setup;
    let inventory;
    try { inventory = await setup.connector.listAudienceWebhooks(setup.audienceId); }
    catch (error) { return providerErrorResponse(error); }
    const replaceable = webhooksEligibleForReplacement({
      webhooks: inventory,
      callbackUrl: setup.callbackUrl,
      providerWebhookId: identifierValue(setup.connection.configuration.webhookProviderId),
    });
    if (replaceable.length && !parsed.data.replaceExisting) {
      return Response.json({ error: { code: "provider_webhook_exists", message: "A matching or previously managed provider webhook exists. Confirm replacement to rotate it safely." } }, { status: 409 });
    }
    try {
      for (const webhook of replaceable) await setup.connector.deleteAudienceWebhook(setup.audienceId, webhook.webhookId);
    } catch (error) { return providerErrorResponse(error); }

    let created: Awaited<ReturnType<MailchimpEmailConnector["createCampaignWebhook"]>> | undefined;
    try {
      created = await setup.connector.createCampaignWebhook(setup.audienceId, setup.callbackUrl);
      const encrypted = encryptToken(encodeMailchimpCredentialBundle({
        apiKey: setup.credentials.apiKey,
        webhookSigningSecret: created.signingSecret,
      }), setup.vaultKey);
      const saved = await setup.repository.configureManagedMailchimpWebhook(
        workspace.workspaceId,
        connectionId,
        encrypted,
        {
          providerWebhookId: created.webhookId,
          callbackUrl: created.callbackUrl,
          audienceId: created.audienceId,
          configuredAt: new Date().toISOString(),
        },
        user.id,
      );
      if (!saved) throw new LocalWebhookSaveError();
      return Response.json({ data: {
        health: "managed_active", callbackUrl: created.callbackUrl,
        providerWebhookId: created.webhookId, signingConfigured: true,
      } }, { status: 201 });
    } catch (error) {
      if (created) {
        try { await setup.connector.deleteAudienceWebhook(setup.audienceId, created.webhookId); }
        catch { return Response.json({ error: { code: "provider_cleanup_ambiguous", message: "The provider webhook may exist, but its signing secret could not be stored. Retry replacement after checking provider status." } }, { status: 502 }); }
      }
      if (error instanceof LocalWebhookSaveError) {
        return Response.json({ error: { code: "connection_unavailable", message: "The provider webhook was removed because the active connection could not be updated." } }, { status: 409 });
      }
      return providerErrorResponse(error);
    }
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = manualSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse("A 16-256 character signing secret is required.");
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const connectionId = (await context.params).id;
    const setup = await loadSetup(workspace.workspaceId, connectionId);
    if (setup instanceof Response) return setup;
    if (setup.connection.configuration.webhookManagement === "managed") {
      return Response.json({ error: { code: "managed_webhook", message: "Use managed rotation so the provider webhook and one-time secret remain synchronized." } }, { status: 409 });
    }
    const encrypted = encryptToken(encodeMailchimpCredentialBundle({ apiKey: setup.credentials.apiKey, webhookSigningSecret: parsed.data.signingSecret }), setup.vaultKey);
    if (!await setup.repository.configureMailchimpWebhook(workspace.workspaceId, connectionId, encrypted, user.id)) {
      return Response.json({ error: { code: "connection_unavailable", message: "Re-test the Mailchimp connection first." } }, { status: 409 });
    }
    return Response.json({ data: { callbackUrl: setup.callbackUrl, signingConfigured: true, health: "manual_unverified" } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = workspaceSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse("A workspace ID is required.");
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const connectionId = (await context.params).id;
    const setup = await loadSetup(workspace.workspaceId, connectionId);
    if (setup instanceof Response) return setup;
    const providerWebhookId = identifierValue(setup.connection.configuration.webhookProviderId);
    if (setup.connection.configuration.webhookManagement === "managed" && providerWebhookId) {
      try {
        const inventory = await setup.connector.listAudienceWebhooks(setup.audienceId);
        if (inventory.some((webhook) => webhook.webhookId === providerWebhookId)) {
          await setup.connector.deleteAudienceWebhook(setup.audienceId, providerWebhookId);
        }
      } catch (error) { return providerErrorResponse(error); }
    }
    const encrypted = encryptToken(encodeMailchimpCredentialBundle({ apiKey: setup.credentials.apiKey }), setup.vaultKey);
    if (!await setup.repository.disableMailchimpWebhook(workspace.workspaceId, connectionId, encrypted, user.id)) {
      return Response.json({ error: { code: "connection_unavailable", message: "Re-test the Mailchimp connection first." } }, { status: 409 });
    }
    return Response.json({ data: { health: "disabled", callbackUrl: setup.callbackUrl, signingConfigured: false } });
  } catch (error) { return apiError(error); }
}

async function loadSetup(workspaceId: string, connectionId: string) {
  const configuration = getServerConfiguration();
  if (!configuration.connectorTokenEncryptionKey) {
    return Response.json({ error: { code: "vault_unavailable", message: "CONNECTOR_TOKEN_ENCRYPTION_KEY is required." } }, { status: 503 });
  }
  const webhookOrigin = configuration.publicWebhookBaseUrl;
  if (!webhookOrigin || new URL(webhookOrigin).protocol !== "https:") {
    return Response.json({ error: { code: "webhook_origin_unavailable", message: "A public HTTPS webhook origin is required." } }, { status: 503 });
  }
  const repository = getPublishingRepository();
  const connection = await repository.getChannelConnection(workspaceId, connectionId);
  if (!connection || connection.provider !== "mailchimp_email") {
    return Response.json({ error: { code: "not_found", message: "Mailchimp connection not found." } }, { status: 404 });
  }
  const audienceId = identifierValue(connection.configuration.audienceId);
  if (!audienceId) return Response.json({ error: { code: "connection_invalid", message: "Re-test the Mailchimp audience first." } }, { status: 409 });
  const credentials = decodeMailchimpCredentialBundle(decryptToken(connection.encryptedCredentials, configuration.connectorTokenEncryptionKey));
  const callbackUrl = `${webhookOrigin.replace(/\/$/u, "")}/api/webhooks/mailchimp/${connectionId}`;
  return {
    repository, connection, credentials, audienceId, callbackUrl,
    vaultKey: configuration.connectorTokenEncryptionKey,
    connector: new MailchimpEmailConnector(credentials.apiKey),
  };
}

function providerErrorResponse(error: unknown): Response {
  if (!(error instanceof ChannelConnectorError)) return apiError(error);
  const status = error.kind === "rate_limit" ? 429
    : error.kind === "authorization" ? 502
      : error.kind === "validation" || error.kind === "permanent" ? 422
        : 503;
  return Response.json({ error: { code: `provider_${error.kind}`, message: error.message } }, { status });
}

function validationResponse(message: string): Response {
  return Response.json({ error: { code: "validation_failed", message } }, { status: 422 });
}

function identifierValue(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 ? value : undefined;
}

class LocalWebhookSaveError extends Error {}
