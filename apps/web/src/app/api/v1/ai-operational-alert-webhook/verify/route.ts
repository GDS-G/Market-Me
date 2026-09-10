import { randomUUID } from "node:crypto";
import { decryptToken, deliverOperationalAlertWebhook } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiOperationalAlertWebhookActionSchema } from "@/server/ai-schema";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request) {
  try {
    const parsed = aiOperationalAlertWebhookActionSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "A workspace is required." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (!["owner", "admin"].includes(workspace.role))
      return Response.json({ error: { code: "forbidden", message: "Workspace administration is required." } }, { status: 403 });
    const configuration = getServerConfiguration();
    const key = configuration.aiOperationalAlertEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32)
      return Response.json({ error: { code: "vault_unavailable", message: "Operational alert decryption is not configured." } }, { status: 503 });
    const repository = getAiRepository();
    const target = await repository.getWorkspaceAiOperationalAlertWebhookVerificationTarget(
      parsed.data.workspaceId, user.id,
    );
    if (!target)
      return Response.json({ error: { code: "not_configured", message: "Save a webhook before verifying it." } }, { status: 409 });
    let secret: string;
    try { secret = decryptToken(target.encryptedSigningSecret, key); }
    catch { return Response.json({ error: { code: "vault_unavailable", message: "The stored signing secret could not be opened." } }, { status: 503 }); }
    const now = new Date();
    const result = await deliverOperationalAlertWebhook({
      endpointUrl: target.endpointUrl,
      signingSecret: secret,
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      payload: {
        version: "1",
        eventType: "configuration_verification",
        occurredAt: now.toISOString(),
        workspaceId: target.workspaceId,
        test: true,
        executionAuthority: false,
        providerRequestAuthority: false,
      },
    }, { allowedHosts: configuration.aiOperationalAlertAllowedHosts });
    secret = "";
    const saved = await repository.recordWorkspaceAiOperationalAlertWebhookVerification({
      workspaceId: target.workspaceId,
      expectedSecretFingerprint: target.secretFingerprint,
      status: result.status === "delivered" ? "verified" : "error",
      ...(result.status === "failed" ? { safeError: result.safeError } : {}),
    }, user.id, now);
    return Response.json({ data: saved, meta: {
      verificationDelivery: true,
      responseBodyStored: false,
      endpointPathReturned: false,
      signingSecretReturned: false,
      executionAuthority: false,
      providerRequestAuthority: false,
    } });
  } catch (error) { return apiError(error); }
}
