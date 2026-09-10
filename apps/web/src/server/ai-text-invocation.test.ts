import { describe, expect, it, vi } from "vitest";
import { executePreparedTextInvocation } from "./ai-text-invocation";

const input = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  intentId: "22222222-2222-4222-8222-222222222222",
  userText: "Prepare the approved announcement.",
};

const target = {
  attemptId: "33333333-3333-4333-8333-333333333333",
  workspaceId: input.workspaceId,
  intentId: input.intentId,
  provider: "openai" as const,
  modelId: "gpt-example",
  maxOutputTokens: 512,
  encryptedCredential: "v1.encrypted-fixture",
  credentialFingerprint: "a".repeat(64),
  contractSourceHash: "b".repeat(64),
};

function attempt(status: "succeeded" | "failed" | "ambiguous") {
  return {
    id: target.attemptId,
    workspaceId: input.workspaceId,
    intentId: input.intentId,
    provider: target.provider,
    modelId: target.modelId,
    status,
    claimedByUserId: "44444444-4444-4444-8444-444444444444",
    claimedAt: "2026-08-11T00:00:00.000Z",
    claimExpiresAt: "2026-08-11T00:01:00.000Z",
    completedAt: "2026-08-11T00:00:01.000Z",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:01.000Z",
    providerRequestStatus: status === "succeeded" ? "sent" as const : status === "failed" ? "not_sent" as const : "unknown" as const,
    outputStored: status === "succeeded",
    outputEncrypted: status === "succeeded",
    outputHashStored: status === "succeeded",
    providerResponseIdStored: false as const,
    providerResponseIdHashStored: status === "succeeded",
    usageRecorded: false as const,
    settlement: false as const,
    retryAllowed: false as const,
    routingAvailable: false as const,
    attemptComplete: true,
    providerExecutionSucceeded: status === "succeeded",
  };
}

describe("prepared text invocation executor", () => {
  it("claims before one provider call and withholds output after encrypted finalization", async () => {
    const claim = vi.fn().mockResolvedValue(target);
    const complete = vi.fn().mockResolvedValue(attempt("succeeded"));
    const invoke = vi.fn().mockResolvedValue({ status: "success", response: {
      provider: "openai", providerResponseId: "resp-private", text: "Approved output",
      stopReason: "completed", usage: { inputTokens: 12, outputTokens: 4 },
      streaming: false, toolsUsed: false, rawResponseStored: false, execution: false,
    } });
    const result = await executePreparedTextInvocation(input, "44444444-4444-4444-8444-444444444444", {
      repository: { claimWorkspaceTextInvocationAttempt: claim, completeWorkspaceTextInvocationAttempt: complete } as never,
      encryptionKey: "fixture-key", decrypt: () => "provider-secret", invoke,
      deploymentExecutionEnabled: true,
      encrypt: () => "v1.encrypted-output",
    });
    expect(claim).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[1]).toBe("provider-secret");
    expect(complete.mock.calls[0]?.[0].outcome).toMatchObject({
      status: "succeeded", outputText: "Approved output", responseId: "resp-private",
    });
    expect(result).toMatchObject({ attempt: { status: "succeeded", outputEncrypted: true } });
    expect(result).not.toHaveProperty("outputText");
  });

  it("records a known pre-request failure when credential decryption fails", async () => {
    const complete = vi.fn().mockResolvedValue(attempt("failed"));
    const invoke = vi.fn();
    const result = await executePreparedTextInvocation(input, "44444444-4444-4444-8444-444444444444", {
      repository: { claimWorkspaceTextInvocationAttempt: vi.fn().mockResolvedValue(target), completeWorkspaceTextInvocationAttempt: complete } as never,
      encryptionKey: "fixture-key", decrypt: () => { throw new Error("private detail"); }, invoke,
      deploymentExecutionEnabled: true,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(complete.mock.calls[0]?.[0].outcome).toMatchObject({ status: "failed", failureCode: "credential_unavailable" });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });

  it("treats every post-call transport failure as non-retryable ambiguous", async () => {
    const complete = vi.fn().mockResolvedValue(attempt("ambiguous"));
    const result = await executePreparedTextInvocation(input, "44444444-4444-4444-8444-444444444444", {
      repository: { claimWorkspaceTextInvocationAttempt: vi.fn().mockResolvedValue(target), completeWorkspaceTextInvocationAttempt: complete } as never,
      encryptionKey: "fixture-key", decrypt: () => "provider-secret",
      deploymentExecutionEnabled: true,
      invoke: vi.fn().mockResolvedValue({ status: "error", failure: "rate_limited", safeMessage: "Provider could not confirm the request." }),
    });
    expect(complete.mock.calls[0]?.[0].outcome).toMatchObject({ status: "ambiguous", failureCode: "provider_outcome_unknown" });
    expect(result.attempt.retryAllowed).toBe(false);
    expect(result).not.toHaveProperty("outputText");
  });

  it("fails before claim when the deployment-wide execution stop is active", async () => {
    const claim = vi.fn();
    await expect(executePreparedTextInvocation(
      input,
      "44444444-4444-4444-8444-444444444444",
      {
        repository: {
          claimWorkspaceTextInvocationAttempt: claim,
          completeWorkspaceTextInvocationAttempt: vi.fn(),
        } as never,
        encryptionKey: "fixture-key",
        deploymentExecutionEnabled: false,
      },
    )).rejects.toThrow("disabled for this deployment");
    expect(claim).not.toHaveBeenCalled();
  });
});
