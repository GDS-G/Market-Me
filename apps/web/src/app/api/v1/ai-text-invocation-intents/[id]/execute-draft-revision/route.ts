import { apiError } from "@/server/api-response";
import { aiDraftRevisionIntentExecuteSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";
import {
  AiProviderExecutionDisabledError,
  executePreparedTextInvocation,
} from "@/server/ai-text-invocation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = aiDraftRevisionIntentExecuteSchema.safeParse({
      ...(await request.json().catch(() => ({}))),
      intentId: id,
    });
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const configuration = getServerConfiguration();
    const key = configuration.aiProviderCredentialEncryptionKey;
    if (!key || Buffer.from(key, "base64").length !== 32)
      return Response.json({
        error: {
          code: "vault_unavailable",
          message: "AI provider credential and output encryption is not configured.",
        },
      }, { status: 503 });
    const repository = getAiRepository();
    const prompt = await repository.getWorkspaceDraftRevisionExecutionPrompt(
      parsed.data.workspaceId, parsed.data.intentId, user.id,
    );
    const result = await executePreparedTextInvocation({
      workspaceId: parsed.data.workspaceId,
      intentId: parsed.data.intentId,
      userText: prompt.userText,
      systemText: prompt.systemText,
    }, user.id, {
      repository,
      encryptionKey: key,
      deploymentExecutionEnabled: configuration.aiProviderExecutionEnabled,
    });
    return Response.json({
      data: result.attempt,
      meta: {
        productBound: true,
        contentDraftId: prompt.contentDraftId,
        contentDraftVersionId: prompt.contentDraftVersionId,
        providerRequestAttempted: result.attempt.providerRequestStatus !== "not_sent",
        providerRequestRetried: false,
        promptStored: false,
        promptReturned: false,
        outputReturned: false,
        outputEncrypted: result.attempt.outputEncrypted,
        settlementComplete: result.attempt.settlement,
        draftMutationAuthority: false,
        publishingAuthority: false,
      },
    });
  } catch (error) {
    if (error instanceof AiProviderExecutionDisabledError)
      return Response.json({
        error: { code: "execution_disabled", message: error.message },
      }, { status: 503 });
    if (isValidationError(error)) return policyValidation(error);
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "The governed Draft revision request cannot be executed.",
      fields,
    },
  }, { status: 422 });
}

function policyValidation(error: { issues: { field: string; message: string }[] }) {
  return validation(Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])));
}

function isValidationError(error: unknown): error is { issues: { field: string; message: string }[] } {
  return Boolean(error && typeof error === "object" && "name" in error &&
    error.name === "AiPolicyValidationError" && "issues" in error && Array.isArray(error.issues));
}
