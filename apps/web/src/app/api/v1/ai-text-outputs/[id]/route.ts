import { decryptToken } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { aiTextOutputListSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = aiTextOutputListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "The output request is not valid.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    const key = getServerConfiguration().aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32) return vaultUnavailable();
    const target = await getAiRepository().getWorkspaceTextOutputArtifactReadTarget(
      parsed.data.workspaceId, (await context.params).id, user.id,
    );
    let outputText: string;
    try {
      outputText = decryptToken(target.encryptedOutput, key);
    } catch {
      return vaultUnavailable();
    }
    return Response.json({
      data: { id: target.id, status: target.status, outputText },
      meta: { outputDecrypted: true, outputPersistedEncrypted: true, publishingAuthorized: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

function vaultUnavailable() {
  return Response.json({
    error: {
      code: "vault_unavailable",
      message: "AI output decryption is not available.",
    },
  }, { status: 503 });
}
