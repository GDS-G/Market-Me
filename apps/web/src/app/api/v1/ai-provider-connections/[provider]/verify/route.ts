import { decryptToken } from "@market-me/connectors";
import { AI_HOSTED_PROVIDER_TYPES } from "@market-me/domain";
import { apiError } from "@/server/api-response";
import { verifyAiProviderCredential } from "@/server/ai-provider-verification";
import { aiProviderConnectionVerifySchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const provider = (await context.params).provider;
    if (!AI_HOSTED_PROVIDER_TYPES.includes(provider as (typeof AI_HOSTED_PROVIDER_TYPES)[number]))
      return validation({ provider: ["Choose a supported hosted provider."] });
    const parsed = aiProviderConnectionVerifySchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const key = getServerConfiguration().aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32)
      return vaultUnavailable();
    const repository = getAiRepository();
    const target = await repository.getProviderConnectionVerificationTarget(
      parsed.data.workspaceId,
      provider as (typeof AI_HOSTED_PROVIDER_TYPES)[number],
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
    const saved = await repository.recordProviderConnectionVerification(
      {
        workspaceId: target.workspaceId,
        provider: target.provider,
        expectedCredentialFingerprint: target.credentialFingerprint,
        status: result.status,
        ...(result.status === "error" ? { lastError: result.lastError } : {}),
      },
      user.id,
    );
    return Response.json({
      data: saved,
      meta: {
        verification: true,
        providerRequest: true,
        providerResponseStored: false,
        modelDataStored: false,
        generation: false,
        adapterActivation: false,
        execution: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the hosted-provider verification fields.",
        fields,
      },
    },
    { status: 422 },
  );
}

function vaultUnavailable() {
  return Response.json(
    {
      error: {
        code: "vault_unavailable",
        message: "AI provider credential decryption is not available.",
      },
    },
    { status: 503 },
  );
}
