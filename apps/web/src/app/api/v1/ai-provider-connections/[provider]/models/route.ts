import { decryptToken } from "@market-me/connectors";
import { AI_HOSTED_PROVIDER_TYPES } from "@market-me/domain";
import { apiError } from "@/server/api-response";
import { discoverAiProviderModels } from "@/server/ai-provider-model-discovery";
import { aiProviderModelInventorySchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const provider = await closedProvider(context);
    if (!provider) return providerValidation();
    const parsed = aiProviderModelInventorySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().listProviderModelInventory(
        parsed.data.workspaceId,
        provider,
        user.id,
      ),
      meta: { workspacePrivate: true, rawProviderResponse: false, adapterActivation: false, execution: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const provider = await closedProvider(context);
    if (!provider) return providerValidation();
    const parsed = aiProviderModelInventorySchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const repository = getAiRepository();
    const target = await repository.getProviderConnectionVerificationTarget(
      parsed.data.workspaceId,
      provider,
      user.id,
    );
    if (target.status !== "verified")
      return Response.json(
        { error: { code: "verified_connection_required", message: "Verify the current provider credential before discovering models." } },
        { status: 422 },
      );
    const key = getServerConfiguration().aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32) return vaultUnavailable();
    let apiKey: string;
    try {
      apiKey = decryptToken(target.encryptedCredential, key);
    } catch {
      return vaultUnavailable();
    }
    const result = await discoverAiProviderModels(provider, apiKey);
    apiKey = "";
    if (result.status === "error") {
      await repository.recordProviderConnectionVerification(
        {
          workspaceId: target.workspaceId,
          provider,
          expectedCredentialFingerprint: target.credentialFingerprint,
          status: "error",
          lastError: result.lastError,
        },
        user.id,
      );
      return Response.json(
        { error: { code: "provider_discovery_failed", message: result.lastError } },
        { status: 502 },
      );
    }
    return Response.json({
      data: await repository.replaceProviderModelInventory(
        {
          workspaceId: target.workspaceId,
          provider,
          expectedCredentialFingerprint: target.credentialFingerprint,
          models: result.models,
        },
        user.id,
      ),
      meta: { workspacePrivate: true, rawProviderResponseStored: false, adapterActivation: false, execution: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

async function closedProvider(context: { params: Promise<{ provider: string }> }) {
  const value = (await context.params).provider;
  return AI_HOSTED_PROVIDER_TYPES.includes(value as (typeof AI_HOSTED_PROVIDER_TYPES)[number])
    ? (value as (typeof AI_HOSTED_PROVIDER_TYPES)[number])
    : undefined;
}

function providerValidation() {
  return validation({ provider: ["Choose a supported hosted provider."] });
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    { error: { code: "validation_failed", message: "Check the provider model-inventory fields.", fields } },
    { status: 422 },
  );
}

function vaultUnavailable() {
  return Response.json(
    { error: { code: "vault_unavailable", message: "AI provider credential decryption is not available." } },
    { status: 503 },
  );
}
