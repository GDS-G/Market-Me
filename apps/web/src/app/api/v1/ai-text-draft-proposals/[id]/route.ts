import { decryptToken } from "@market-me/connectors";
import { parseAiDraftRevisionPresentationSuggestion } from "@market-me/domain";
import { apiError } from "@/server/api-response";
import { aiTextOutputListSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = aiTextOutputListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "The Draft-proposal request is not valid.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const key = getServerConfiguration().aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32) return vaultUnavailable();
    const target = await getAiRepository().getWorkspaceTextDraftProposalReadTarget(
      parsed.data.workspaceId, (await context.params).id, user.id,
    );
    let outputText: string;
    try { outputText = decryptToken(target.encryptedOutput, key); }
    catch { return vaultUnavailable(); }
    const suggestionParse = target.productPromptVersion === "draft-revision-v2"
      ? parseAiDraftRevisionPresentationSuggestion(outputText)
      : {
          status: "unavailable" as const,
          issues: ["This proposal predates the structured Draft revision contract."],
          draftContentMutated: false as const,
          publishingAuthorized: false as const,
        };
    return Response.json({
      data: { id: target.id, contentDraftId: target.contentDraftId, outputText, suggestionParse },
      meta: { proposalOnly: true, draftContentMutated: false, publishingAuthorized: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

function vaultUnavailable() {
  return Response.json({ error: { code: "vault_unavailable", message: "AI Draft-proposal decryption is not available." } }, { status: 503 });
}
