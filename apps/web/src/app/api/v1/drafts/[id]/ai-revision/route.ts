import { apiError } from "@/server/api-response";
import { aiDraftRevisionIntentPrepareSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getAiRepository } from "@/server/database";
import { executePreparedTextInvocation } from "@/server/ai-text-invocation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = aiDraftRevisionIntentPrepareSchema.safeParse({
      ...(await request.json().catch(() => ({}))),
      contentDraftId: id,
    });
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const configuration = getServerConfiguration();
    const key = configuration.aiProviderCredentialEncryptionKey;
    if (parsed.data.executeAfterPrepare &&
      (!key || Buffer.from(key, "base64").length !== 32))
      return Response.json({
        error: {
          code: "vault_unavailable",
          message: "AI provider credential and output encryption is not configured.",
        },
      }, { status: 503 });
    if (parsed.data.executeAfterPrepare && !configuration.aiProviderExecutionEnabled)
      return Response.json({
        error: {
          code: "execution_disabled",
          message: "AI provider execution is disabled by deployment configuration.",
        },
      }, { status: 503 });
    const repository = getAiRepository();
    const prepared = await repository.prepareWorkspaceDraftRevisionIntent({
      workspaceId: parsed.data.workspaceId,
      contentDraftId: parsed.data.contentDraftId,
      invocationBindingId: parsed.data.invocationBindingId,
      reservationId: parsed.data.reservationId,
      idempotencyKey: parsed.data.idempotencyKey,
      goal: parsed.data.goal,
      maxOutputTokens: parsed.data.maxOutputTokens,
    }, user.id);
    if (!parsed.data.executeAfterPrepare)
      return Response.json({
        data: prepared.intent,
        meta: productMeta(prepared.intent.sourceContentDraftId!, prepared.intent.sourceContentDraftVersionId!),
      }, { status: 201 });
    const result = await executePreparedTextInvocation({
      workspaceId: parsed.data.workspaceId,
      intentId: prepared.intent.id,
      userText: prepared.prompt.userText,
      systemText: prepared.prompt.systemText,
    }, user.id, {
      repository,
      encryptionKey: key!,
      deploymentExecutionEnabled: true,
    });
    return Response.json({
      data: result.attempt,
      meta: {
        ...productMeta(prepared.prompt.contentDraftId, prepared.prompt.contentDraftVersionId),
        providerRequestAttempted: result.attempt.providerRequestStatus !== "not_sent",
        providerRequestRetried: false,
        outputReturned: false,
        outputEncrypted: result.attempt.outputEncrypted,
        settlementComplete: result.attempt.settlement,
        publishingAuthority: false,
        draftMutationAuthority: false,
      },
    }, { status: 201 });
  } catch (error) {
    if (isValidationError(error)) return policyValidation(error);
    return apiError(error);
  }
}

function productMeta(contentDraftId: string, contentDraftVersionId: string) {
  return {
    productBound: true,
    contentDraftId,
    contentDraftVersionId,
    promptStored: false,
    promptReturned: false,
    draftMutationAuthority: false,
    publishingAuthority: false,
  };
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "The governed Draft revision request is not valid.",
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
