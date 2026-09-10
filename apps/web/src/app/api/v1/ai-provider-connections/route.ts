import { createHash } from "node:crypto";
import { encryptToken } from "@market-me/connectors";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiProviderConnectionListSchema, aiProviderConnectionSaveSchema } from "@/server/ai-schema";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiProviderConnectionListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({ data: await getAiRepository().listProviderConnections(parsed.data.workspaceId, user.id), meta: { credentials: false, verificationAvailable: true, generation: false, execution: false } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = aiProviderConnectionSaveSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const key = getServerConfiguration().aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32)
      return Response.json(
        {
          error: {
            code: "vault_unavailable",
            message: "AI provider credential encryption is not configured.",
          },
        },
        { status: 503 },
      );
    const saved = await getAiRepository().saveProviderConnection({
      workspaceId: parsed.data.workspaceId,
      provider: parsed.data.provider,
      encryptedCredential: encryptToken(parsed.data.apiKey, key),
      credentialFingerprint: createHash("sha256").update(parsed.data.apiKey).digest("hex"),
      encryptionKeyVersion: "v1",
    }, user.id);
    return Response.json({ data: saved, meta: { verified: false, execution: false } }, { status: 201 });
  } catch (error) { return apiError(error); }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "Check the hosted-provider connection fields.", fields } }, { status: 422 });
}
