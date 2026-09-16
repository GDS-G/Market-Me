import { describe, expect, it, vi } from "vitest";
import {
  CampaignPreparationError,
  CampaignPreparationTemplateValidationError,
  CampaignValidationError,
  DraftValidationError,
  type CampaignPreparationRepository,
  type ClaimedSourcePreparationCommand,
  type SourcePreparationClaimBatch,
  type SourcePreparationRepository,
  type StoredCampaignPreparation,
} from "@market-me/database";
import {
  classifySourcePreparationFailure,
  SourcePreparationService,
  SourcePreparationServiceConfigurationError,
  SourcePreparationServiceError,
} from "./source-preparation-service";

const command = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  bindingId: "33333333-3333-4333-8333-333333333333",
  bindingRevision: 3,
  smartSourceId: "44444444-4444-4444-8444-444444444444",
  contentPackageId: "55555555-5555-4555-8555-555555555555",
  contentPackageVersion: 7,
  expectedApprovalId: "66666666-6666-4666-8666-666666666666",
  expectedReviewFingerprint: `mm-package-review-v1:sha256:${"a".repeat(64)}`,
  preparationIdempotencyKey: "11111111-1111-4111-8111-111111111111",
  writerUserId: "77777777-7777-4777-8777-777777777777",
  configurationSnapshot: {
    workspaceId: "22222222-2222-4222-8222-222222222222",
    contentPackageId: "55555555-5555-4555-8555-555555555555",
    expectedPackageVersion: 7,
    templateKey: "general_announcement" as const,
    templateVersion: 1 as const,
    name: "Source announcement",
    description: "",
    audienceProfileVersionIds: [],
    informationDepth: "contextual" as const,
    promotionalStrength: "informational" as const,
    timezone: "UTC",
  },
  bindingSnapshot: {
    bindingId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    smartSourceId: "44444444-4444-4444-8444-444444444444",
    writerUserId: "77777777-7777-4777-8777-777777777777",
    revision: 3,
    enabled: true,
    templateKey: "general_announcement" as const,
    templateVersion: 1 as const,
    name: "Source announcement",
    description: "",
    audienceProfileVersionIds: [],
    informationDepth: "contextual" as const,
    promotionalStrength: "informational" as const,
    timezone: "UTC",
  },
  attempt: 2,
  leaseExpiresAt: "2026-09-15T12:05:00.000000Z",
  createdAt: "2026-09-15T12:00:00.000000Z",
} satisfies ClaimedSourcePreparationCommand;
const preparation = {
  id: "88888888-8888-4888-8888-888888888888",
  campaignId: "99999999-9999-4999-8999-999999999999",
};

type PrepareForSource = (...parameters: Parameters<CampaignPreparationRepository["prepare"]>) => Promise<{
  preparation: Pick<StoredCampaignPreparation, "id" | "campaignId">;
  replayed: boolean;
}>;

function claimBatch(
  commands: readonly ClaimedSourcePreparationCommand[] = [],
  recovered = 0,
  deadLettered = 0,
): SourcePreparationClaimBatch {
  return { commands, recovered, deadLettered };
}

function fixture() {
  const pending = [command];
  const commands = {
    claimSourcePreparationCommands: vi.fn<SourcePreparationRepository["claimSourcePreparationCommands"]>(
      async () => claimBatch(pending.splice(0, 1)),
    ),
    completeSourcePreparationCommand: vi.fn<SourcePreparationRepository["completeSourcePreparationCommand"]>(async () => true),
    failSourcePreparationCommand: vi.fn<SourcePreparationRepository["failSourcePreparationCommand"]>(async () => "dead_letter"),
  };
  const preparations = {
    prepare: vi.fn<PrepareForSource>(async () => ({ preparation, replayed: false })),
  };
  return { commands, preparations, service: new SourcePreparationService({ commands, preparations }) };
}

describe("SourcePreparationService", () => {
  it("uses the command UUID and exact approval snapshot, then fences completion by attempt", async () => {
    const f = fixture();
    await expect(f.service.processReadyCommands(4, 90)).resolves.toEqual({
      claimed: 1, completed: 1, retried: 0, deadLettered: 0, lost: 0, settlementFailed: 0,
    });
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenCalledTimes(2);
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenNthCalledWith(1, 1, 90);
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenNthCalledWith(2, 1, 90);
    expect(f.preparations.prepare).toHaveBeenCalledExactlyOnceWith(
      {
        ...command.configurationSnapshot,
        workspaceId: command.workspaceId,
        contentPackageId: command.contentPackageId,
        expectedPackageVersion: command.contentPackageVersion,
      },
      command.id,
      command.writerUserId,
      { expectedReviewFingerprint: command.expectedReviewFingerprint, expectedApprovalId: command.expectedApprovalId },
    );
    expect(f.commands.completeSourcePreparationCommand).toHaveBeenCalledExactlyOnceWith({
      commandId: command.id, attempt: command.attempt,
      preparationId: preparation.id, campaignId: preparation.campaignId,
    });
    expect(f.commands.failSourcePreparationCommand).not.toHaveBeenCalled();
  });

  it("cannot be redirected by conflicting JSON identity or a redundant idempotency field", async () => {
    const f = fixture();
    const redirected = {
      ...command,
      preparationIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      configurationSnapshot: {
        ...command.configurationSnapshot,
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        contentPackageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        expectedPackageVersion: 99,
      },
    } satisfies ClaimedSourcePreparationCommand;
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([redirected]))
      .mockResolvedValue(claimBatch());
    await f.service.processReadyCommands();
    expect(f.preparations.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: redirected.workspaceId,
        contentPackageId: redirected.contentPackageId,
        expectedPackageVersion: redirected.contentPackageVersion,
      }),
      redirected.id,
      redirected.writerUserId,
      expect.any(Object),
    );
  });

  it("completes an idempotent preparation replay after a crash between commits", async () => {
    const f = fixture();
    f.preparations.prepare.mockResolvedValue({ preparation, replayed: true });
    await expect(f.service.processReadyCommands()).resolves.toMatchObject({ completed: 1, lost: 0 });
    expect(f.commands.completeSourcePreparationCommand).toHaveBeenCalledOnce();
  });

  it("dead-letters stale authorization/reference failures without storing their raw message", async () => {
    const f = fixture();
    f.preparations.prepare.mockRejectedValue(new CampaignPreparationError("access_denied", "private detail"));
    await expect(f.service.processReadyCommands()).resolves.toEqual({
      claimed: 1, completed: 0, retried: 0, deadLettered: 1, lost: 0, settlementFailed: 0,
    });
    expect(f.commands.failSourcePreparationCommand).toHaveBeenCalledExactlyOnceWith({
      commandId: command.id, attempt: command.attempt, errorCode: "access_denied", retryable: false,
      safeError: "The approved package or a configured preparation reference is no longer eligible.",
    });
  });

  it("dead-letters deterministic template and campaign-policy failures", () => {
    expect(classifySourcePreparationFailure(new CampaignPreparationTemplateValidationError({
      field: "timezone", code: "invalid_timezone", message: "private input",
    }))).toEqual({
      errorCode: "preparation_configuration_invalid", retryable: false,
      safeError: "The configured draft preparation no longer satisfies the supported template or campaign policy.",
    });
    expect(classifySourcePreparationFailure(new CampaignValidationError([
      { code: "communication_policy", message: "private ceiling" },
    ])).retryable).toBe(false);
    expect(classifySourcePreparationFailure(new DraftValidationError([
      { code: "package_version_mismatch", message: "private package detail" },
    ]))).toEqual({
      errorCode: "preparation_configuration_invalid", retryable: false,
      safeError: "The configured draft preparation no longer satisfies the supported template or campaign policy.",
    });
  });

  it("retries bounded transient database and unknown failures with sanitized text", async () => {
    expect(classifySourcePreparationFailure({ code: "40001", message: "SQL secret" })).toEqual({
      errorCode: "database_40001", retryable: true,
      safeError: "A temporary database condition interrupted draft preparation.",
    });
    expect(classifySourcePreparationFailure({ code: "08006", message: "host secret" }).retryable).toBe(true);
    expect(classifySourcePreparationFailure(new Error("secret")).safeError).not.toContain("secret");
    const f = fixture();
    f.preparations.prepare.mockRejectedValue(new Error("raw driver detail"));
    f.commands.failSourcePreparationCommand.mockResolvedValue("failed");
    await expect(f.service.processReadyCommands()).resolves.toMatchObject({ retried: 1, deadLettered: 0 });
  });

  it("counts a transient failure as dead-lettered when the repository reaches its attempt cap", async () => {
    const f = fixture();
    f.preparations.prepare.mockRejectedValue(new Error("temporary but exhausted"));
    f.commands.failSourcePreparationCommand.mockResolvedValue("dead_letter");
    await expect(f.service.processReadyCommands()).resolves.toMatchObject({
      retried: 0, deadLettered: 1, lost: 0,
    });
  });

  it("dead-letters deterministic database rejections", () => {
    expect(classifySourcePreparationFailure({ code: "23514", detail: "private constraint" })).toEqual({
      errorCode: "database_23514", retryable: false,
      safeError: "The database rejected this preparation command.",
    });
    expect(classifySourcePreparationFailure({ code: "22001" }).retryable).toBe(false);
  });

  it("reports a recovered claim instead of overwriting its newer attempt", async () => {
    const success = fixture();
    success.commands.completeSourcePreparationCommand.mockResolvedValue(false);
    await expect(success.service.processReadyCommands()).resolves.toMatchObject({ completed: 0, lost: 1 });

    const failure = fixture();
    failure.preparations.prepare.mockRejectedValue(new Error("transient"));
    failure.commands.failSourcePreparationCommand.mockResolvedValue(undefined);
    await expect(failure.service.processReadyCommands()).resolves.toMatchObject({ retried: 0, lost: 1 });
  });

  it("sanitizes claim failures before they reach the worker", async () => {
    const f = fixture();
    f.commands.claimSourcePreparationCommands.mockRejectedValue({ code: "08006", message: "postgres://secret" });
    const failure = await f.service.processReadyCommands().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SourcePreparationServiceError);
    expect(failure).toMatchObject({ code: "source_preparation_store_unavailable" });
    expect(String(failure)).not.toContain("secret");
  });

  it("validates public batch and lease bounds before claiming", async () => {
    const f = fixture();
    for (const [limit, lease] of [[0, 300], [101, 300], [1.5, 300], [1, 29], [1, 3601]] as const) {
      await expect(f.service.processReadyCommands(limit, lease)).rejects.toBeInstanceOf(SourcePreparationServiceConfigurationError);
    }
    expect(f.commands.claimSourcePreparationCommands).not.toHaveBeenCalled();
  });

  it("claims each item immediately before work and stops at the requested total", async () => {
    const f = fixture();
    const second = { ...command, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", preparationIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1 };
    const third = { ...command, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", preparationIdempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 1 };
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([command]))
      .mockResolvedValueOnce(claimBatch([second]))
      .mockResolvedValueOnce(claimBatch([third]));
    await expect(f.service.processReadyCommands(2, 120)).resolves.toMatchObject({ claimed: 2, completed: 2 });
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenCalledTimes(2);
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenNthCalledWith(1, 1, 120);
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenNthCalledWith(2, 1, 120);
  });

  it("records a transient completion failure for bounded replay and continues the claimed batch", async () => {
    const f = fixture();
    const second = { ...command, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", preparationIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1 };
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([command]))
      .mockResolvedValueOnce(claimBatch([second]))
      .mockResolvedValue(claimBatch());
    f.commands.completeSourcePreparationCommand.mockRejectedValueOnce({ code: "40001", message: "private SQL" });
    f.commands.failSourcePreparationCommand.mockResolvedValueOnce("failed");
    await expect(f.service.processReadyCommands()).resolves.toEqual({
      claimed: 2, completed: 1, retried: 1, deadLettered: 0, lost: 0, settlementFailed: 0,
    });
  });

  it("counts an exact receipt reconciled after a transient final-attempt settlement failure as completed", async () => {
    const f = fixture();
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([{ ...command, attempt: 8 }]))
      .mockResolvedValue(claimBatch());
    f.commands.completeSourcePreparationCommand.mockRejectedValueOnce({ code: "40001", message: "private SQL" });
    f.commands.failSourcePreparationCommand.mockResolvedValueOnce("completed");
    await expect(f.service.processReadyCommands()).resolves.toEqual({
      claimed: 1, completed: 1, retried: 0, deadLettered: 0, lost: 0, settlementFailed: 0,
    });
    expect(f.commands.failSourcePreparationCommand).toHaveBeenCalledWith(expect.objectContaining({
      commandId: command.id, attempt: 8, retryable: true, errorCode: "database_40001",
    }));
  });

  it("reports and continues bounded cleanup-only batches", async () => {
    const f = fixture();
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([], 1, 0))
      .mockResolvedValueOnce(claimBatch([], 0, 1))
      .mockResolvedValue(claimBatch());
    await expect(f.service.processReadyCommands(2, 120)).resolves.toEqual({
      claimed: 0, completed: 1, retried: 0, deadLettered: 1, lost: 0, settlementFailed: 0,
    });
    expect(f.commands.claimSourcePreparationCommands).toHaveBeenCalledTimes(2);
    expect(f.preparations.prepare).not.toHaveBeenCalled();
  });

  it("dead-letters a current-attempt completion lineage rejection", async () => {
    const f = fixture();
    f.commands.completeSourcePreparationCommand.mockRejectedValue({ code: "23514", detail: "private constraint" });
    await expect(f.service.processReadyCommands()).resolves.toMatchObject({
      completed: 0, retried: 0, deadLettered: 1, lost: 0, settlementFailed: 0,
    });
    expect(f.commands.failSourcePreparationCommand).toHaveBeenCalledWith(expect.objectContaining({
      commandId: command.id, attempt: command.attempt, retryable: false, errorCode: "database_23514",
    }));
  });

  it("leaves an unsettled failure for lease recovery and continues the claimed batch", async () => {
    const f = fixture();
    const second = { ...command, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", preparationIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1 };
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([command]))
      .mockResolvedValueOnce(claimBatch([second]))
      .mockResolvedValue(claimBatch());
    f.preparations.prepare
      .mockRejectedValueOnce(new CampaignPreparationError("approval_unavailable", "private"))
      .mockResolvedValueOnce({ preparation, replayed: false });
    f.commands.failSourcePreparationCommand.mockRejectedValueOnce(new Error("private SQL"));
    await expect(f.service.processReadyCommands()).resolves.toEqual({
      claimed: 2, completed: 1, retried: 0, deadLettered: 0, lost: 0, settlementFailed: 1,
    });
  });

  it("continues the batch after one command is rejected", async () => {
    const f = fixture();
    const second = { ...command, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", preparationIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1 };
    f.commands.claimSourcePreparationCommands.mockReset()
      .mockResolvedValueOnce(claimBatch([command]))
      .mockResolvedValueOnce(claimBatch([second]))
      .mockResolvedValue(claimBatch());
    f.preparations.prepare
      .mockRejectedValueOnce(new CampaignPreparationError("approval_unavailable", "stale"))
      .mockResolvedValueOnce({ preparation, replayed: false });
    await expect(f.service.processReadyCommands()).resolves.toEqual({
      claimed: 2, completed: 1, retried: 0, deadLettered: 1, lost: 0, settlementFailed: 0,
    });
  });
});
