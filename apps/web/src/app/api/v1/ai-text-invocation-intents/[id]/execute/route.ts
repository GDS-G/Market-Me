import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiTextInvocationIntentExecuteSchema } from "@/server/ai-schema";
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
    const parsed = aiTextInvocationIntentExecuteSchema.safeParse({
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
    const result = await executePreparedTextInvocation({
      workspaceId: parsed.data.workspaceId,
      intentId: parsed.data.intentId,
      userText: parsed.data.userText,
      ...(parsed.data.systemText ? { systemText: parsed.data.systemText } : {}),
    }, user.id, {
      repository: getAiRepository(),
      encryptionKey: key,
      deploymentExecutionEnabled: configuration.aiProviderExecutionEnabled,
    });
    return Response.json({
      data: result.attempt,
      meta: {
        providerRequestAttempted: result.attempt.providerRequestStatus !== "not_sent",
        providerRequestRetried: false,
        outputReturned: false,
        outputEncrypted: result.attempt.outputEncrypted,
        settlementComplete: result.attempt.settlement,
        publishingAuthority: false,
      },
    });
  } catch (error) {
    if (error instanceof AiProviderExecutionDisabledError)
      return Response.json({
        error: {
          code: "execution_disabled",
          message: error.message,
        },
      }, { status: 503 });
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "The prepared text invocation cannot be executed.",
      fields,
    },
  }, { status: 422 });
}
