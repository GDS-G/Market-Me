import { decryptToken } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { aiAdapterHealthProbeSchema } from "@/server/ai-schema";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";
import { verifyAiProviderCredential } from "@/server/ai-provider-verification";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = aiAdapterHealthProbeSchema.safeParse(
      await request.json().catch(() => undefined),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin") {
      throw new AuthorizationError();
    }
    const key = getServerConfiguration().aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32) return vaultUnavailable();
    const repository = getAiRepository();
    const target = await repository.getWorkspaceAdapterHealthProbeTarget(
      parsed.data.workspaceId,
      (await context.params).id,
      user.id,
    );
    let apiKey: string;
    try {
      apiKey = decryptToken(target.encryptedCredential, key);
    } catch {
      return vaultUnavailable();
    }
    const result = await verifyAiProviderCredential(target.provider, apiKey);
    apiKey = "";
    const observation = await repository.recordWorkspaceAdapterHealthObservation({
      workspaceId: target.workspaceId,
      invocationBindingId: target.invocationBindingId,
      provider: target.provider,
      expectedCredentialFingerprint: target.credentialFingerprint,
      expectedContractSourceHash: target.contractSourceHash,
      status: result.status === "verified" ? "healthy" : "unhealthy",
      ...(result.status === "error"
        ? { failureCode: result.failure, safeMessage: result.lastError }
        : {}),
    }, user.id);
    return Response.json({
      data: observation,
      meta: {
        providerRequest: true,
        providerResponseStored: false,
        generation: false,
        implementationAvailable: true,
        healthReady: observation.healthReady,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "Check the non-generative health-probe fields.",
      fields,
    },
  }, { status: 422 });
}

function vaultUnavailable() {
  return Response.json({
    error: {
      code: "vault_unavailable",
      message: "AI provider credential decryption is not available.",
    },
  }, { status: 503 });
}
