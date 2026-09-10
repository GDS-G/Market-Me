import { decryptToken, encryptToken, invokeAiProviderText, type AiProviderTextResponse } from "@market-me/connectors";
import type { AiTextInvocationAttempt } from "@market-me/domain";
import type { AiRepository } from "@market-me/database";

export interface ExecutePreparedTextInvocationInput {
  workspaceId: string;
  intentId: string;
  userText: string;
  systemText?: string;
}

export interface ExecutePreparedTextInvocationResult {
  attempt: AiTextInvocationAttempt;
}

interface ExecutionDependencies {
  repository: Pick<AiRepository,
    "claimWorkspaceTextInvocationAttempt" | "completeWorkspaceTextInvocationAttempt">;
  encryptionKey: string;
  deploymentExecutionEnabled: boolean;
  decrypt?: typeof decryptToken;
  encrypt?: typeof encryptToken;
  invoke?: typeof invokeAiProviderText;
}

export class AiProviderExecutionDisabledError extends Error {
  constructor() {
    super("AI provider execution is disabled for this deployment.");
    this.name = "AiProviderExecutionDisabledError";
  }
}

export async function executePreparedTextInvocation(
  input: ExecutePreparedTextInvocationInput,
  actorUserId: string,
  dependencies: ExecutionDependencies,
): Promise<ExecutePreparedTextInvocationResult> {
  if (!dependencies.deploymentExecutionEnabled)
    throw new AiProviderExecutionDisabledError();
  const target = await dependencies.repository.claimWorkspaceTextInvocationAttempt(
    input, actorUserId,
  );
  let apiKey = "";
  try {
    try {
      apiKey = (dependencies.decrypt ?? decryptToken)(
        target.encryptedCredential,
        dependencies.encryptionKey,
      );
    } catch {
      return {
        attempt: await dependencies.repository.completeWorkspaceTextInvocationAttempt({
          workspaceId: input.workspaceId,
          attemptId: target.attemptId,
          expectedCredentialFingerprint: target.credentialFingerprint,
          expectedContractSourceHash: target.contractSourceHash,
          outcome: {
            status: "failed",
            failureCode: "credential_unavailable",
            safeMessage: "The provider credential could not be opened for this attempt.",
          },
        }, actorUserId),
      };
    }
    const startedAt = Date.now();
    const result = await (dependencies.invoke ?? invokeAiProviderText)({
      provider: target.provider,
      modelId: target.modelId,
      userText: input.userText,
      ...(input.systemText ? { systemText: input.systemText } : {}),
      maxOutputTokens: target.maxOutputTokens,
    }, apiKey);
    if (result.status === "error") {
      return {
        attempt: await dependencies.repository.completeWorkspaceTextInvocationAttempt({
          workspaceId: input.workspaceId,
          attemptId: target.attemptId,
          expectedCredentialFingerprint: target.credentialFingerprint,
          expectedContractSourceHash: target.contractSourceHash,
          outcome: {
            status: "ambiguous",
            failureCode: "provider_outcome_unknown",
            safeMessage: result.safeMessage,
          },
        }, actorUserId),
      };
    }
    const attempt = await dependencies.repository.completeWorkspaceTextInvocationAttempt({
      workspaceId: input.workspaceId,
      attemptId: target.attemptId,
      expectedCredentialFingerprint: target.credentialFingerprint,
      expectedContractSourceHash: target.contractSourceHash,
      outcome: successOutcome(
        result.response,
        (dependencies.encrypt ?? encryptToken)(result.response.text, dependencies.encryptionKey),
        Math.max(0, Date.now() - startedAt),
      ),
    }, actorUserId);
    return { attempt };
  } finally {
    apiKey = "";
  }
}

function successOutcome(response: AiProviderTextResponse, encryptedOutput: string, latencyMs: number) {
  return {
    status: "succeeded" as const,
    outputText: response.text,
    encryptedOutput,
    encryptionKeyVersion: "v1" as const,
    ...(response.providerResponseId ? { responseId: response.providerResponseId } : {}),
    stopReason: response.stopReason,
    ...(response.usage?.inputTokens !== undefined
      ? { inputTokens: response.usage.inputTokens }
      : {}),
    ...(response.usage?.outputTokens !== undefined
      ? { outputTokens: response.usage.outputTokens }
      : {}),
    latencyMs,
  };
}
