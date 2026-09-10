import { createHash } from "node:crypto";
import { encryptToken, validateOperationalAlertEndpoint } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import {
  aiOperationalAlertWebhookActionSchema,
  aiOperationalAlertWebhookSaveSchema,
} from "@/server/ai-schema";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiOperationalAlertWebhookActionSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().getWorkspaceAiOperationalAlertWebhook(
        parsed.data.workspaceId, user.id,
      ),
      meta: safeMeta(),
    });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const parsed = aiOperationalAlertWebhookSaveSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (!["owner", "admin"].includes(workspace.role)) return forbidden();
    const configuration = getServerConfiguration();
    const key = configuration.aiOperationalAlertEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32) return vaultUnavailable();
    try {
      validateOperationalAlertEndpoint(
        parsed.data.endpointUrl, configuration.aiOperationalAlertAllowedHosts,
      );
    } catch (error) {
      return validation({ endpointUrl: [error instanceof Error ? error.message : "Webhook endpoint is not permitted."] });
    }
    const saved = await getAiRepository().saveWorkspaceAiOperationalAlertWebhook({
      workspaceId: parsed.data.workspaceId,
      endpointUrl: parsed.data.endpointUrl,
      encryptedSigningSecret: encryptToken(parsed.data.signingSecret, key),
      secretFingerprint: createHash("sha256").update(parsed.data.signingSecret).digest("hex"),
      encryptionKeyVersion: "v1",
    }, user.id);
    return Response.json({ data: saved, meta: safeMeta() }, { status: 201 });
  } catch (error) { return apiError(error); }
}

function safeMeta() {
  return {
    endpointPathReturned: false,
    signingSecretReturned: false,
    payloadReturned: false,
    executionAuthority: false,
    providerRequestAuthority: false,
  };
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: { code: "validation_failed", message: "Check the operational alert webhook fields.", fields },
  }, { status: 422 });
}

function forbidden() {
  return Response.json({
    error: { code: "forbidden", message: "Workspace administration is required." },
  }, { status: 403 });
}

function vaultUnavailable() {
  return Response.json({
    error: { code: "vault_unavailable", message: "Operational alert encryption is not configured." },
  }, { status: 503 });
}
