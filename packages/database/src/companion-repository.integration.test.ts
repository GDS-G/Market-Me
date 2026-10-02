import { randomUUID } from "node:crypto";
import { createPairingCode, createWorkerToken, signCompanionJob, verifyCompanionJob, type CompanionJobEnvelope } from "@market-me/companion-protocol";
import { afterAll, describe, expect, it } from "vitest";
import { CompanionRepository } from "./companion-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { setFixtureExecutionState } from "./test-support/workspace-execution-fixture";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("desktop companion repository", () => {
  afterAll(async () => { await sql?.end(); });

  it("holds queued and expired companion claims without revoking workers or suppressing already-claimed completion", async () => {
    sql ??= createDatabaseClient(databaseUrl!);
    const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `held-companion-${randomUUID()}@market-me.local`, displayName: "Synthetic hold owner" });
    const repository = new CompanionRepository(sql);
    try {
      const code = createPairingCode(), token = createWorkerToken();
      await repository.createPairingCode({ workspaceId: workspace.workspaceId, codeHash: code.codeHash, expiresAt: new Date(Date.now() + 60_000), createdBy: user.id });
      const worker = (await repository.pairWorker({ codeHash: code.codeHash, name: "Synthetic held worker", platform: "windows", architecture: "x86_64", appVersion: "1.52.0", tokenPrefix: token.prefix, tokenHash: token.tokenHash }))!;
      const create = () => repository.createJob({ workspaceId: workspace.workspaceId, workerId: worker.id, action: "open_url", actionMode: "assisted",
        targetUrl: "https://example.test/held", expectedOrigin: "https://example.test", allowedDomains: ["example.test"], instructions: "Synthetic; do not dispatch.", idempotencyKey: randomUUID(), createdBy: user.id });
      const first = await create(), claim = (await repository.claimNextJob(worker.id))!;
      const queued = await create();
      await setFixtureExecutionState(sql, workspace.workspaceId, user.id, "paused");
      const before = await repository.listJobs(workspace.workspaceId);
      expect(await repository.claimNextJob(worker.id)).toBeUndefined();
      expect(await repository.listJobs(workspace.workspaceId)).toEqual(before);
      expect((await repository.authenticateWorker(token.secret))?.status).toBe("active");
      expect(await repository.completeJob({ workerId: worker.id, jobId: first.id, claimToken: claim.claimToken, status: "succeeded", result: { synthetic: true } })).toBe(true);
      await setFixtureExecutionState(sql, workspace.workspaceId, user.id, "open");
      expect((await repository.claimNextJob(worker.id))?.job.id).toBe(queued.id);
      await sql`UPDATE browser_job SET lease_expires_at=now()-interval '1 second' WHERE id=${queued.id}`;
      await setFixtureExecutionState(sql, workspace.workspaceId, user.id, "paused");
      const expired = await repository.listJobs(workspace.workspaceId);
      expect(await repository.claimNextJob(worker.id)).toBeUndefined();
      expect(await repository.listJobs(workspace.workspaceId)).toEqual(expired);
      await repository.setWorkerStatus(workspace.workspaceId, worker.id, "paused");
      await setFixtureExecutionState(sql, workspace.workspaceId, user.id, "open");
      expect(await repository.claimNextJob(worker.id)).toBeUndefined();
      expect((await repository.listWorkers(workspace.workspaceId))[0]?.status).toBe("paused");
    } finally { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; }
  });

  it("pairs once, reports health, leases a signed job, and prevents claims while paused", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const repository = new CompanionRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `companion-${suffix}@market-me.local`, displayName: "Companion Test" });
    try {
      const code = createPairingCode();
      await repository.createPairingCode({ workspaceId: workspace.workspaceId, codeHash: code.codeHash, expiresAt: new Date(Date.now() + 60_000), createdBy: user.id });
      const token = createWorkerToken();
      const worker = await repository.pairWorker({ codeHash: code.codeHash, name: "Windows test worker", platform: "windows", architecture: "x86_64", appVersion: "0.6.0", tokenPrefix: token.prefix, tokenHash: token.tokenHash });
      expect(worker).toMatchObject({ workspaceId: workspace.workspaceId, status: "active" });
      expect(await repository.pairWorker({ codeHash: code.codeHash, name: "Replay", platform: "windows", architecture: "x86_64", appVersion: "0.6.0", tokenPrefix: "replay", tokenHash: "replay" })).toBeUndefined();
      expect((await repository.authenticateWorker(token.secret))?.id).toBe(worker!.id);

      const heartbeat = await repository.heartbeat({ workerId: worker!.id, appVersion: "0.9.0", platform: "windows", architecture: "x86_64", healthState: "healthy", capabilities: { signedJobs: true, localFolderIngestion: true }, details: { localPaused: false } });
      expect(heartbeat?.effectiveHealthState).toBe("healthy");

      const localSource = await core.createSmartSource({
        workspaceId: workspace.workspaceId, name: "Approved local source", provider: "local",
        locations: [{ providerLocationId: worker!.id, displayPath: "Approved companion folder" }],
        recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 0,
        allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [],
        autonomyMode: "approval_required", enabled: true,
      }, user.id);
      expect(await repository.listLocalSourceAssignments(worker!.id)).toEqual([expect.objectContaining({ id: localSource.id, workspaceId: workspace.workspaceId })]);
      const localHash = `sha256:${"a".repeat(64)}`;
      await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: localSource.id, upserts: [{
        workspaceId: workspace.workspaceId, smartSourceId: localSource.id, providerItemId: `local:${"b".repeat(64)}`,
        name: "launch.txt", displayPath: "launch.txt", mimeType: "text/plain", isFolder: false,
        sizeBytes: 6, modifiedAt: new Date().toISOString(), contentHash: localHash,
      }], deletedProviderItemIds: [] });
      expect(await core.setLocalSourceObjectKey({ workspaceId: workspace.workspaceId, smartSourceId: localSource.id,
        providerItemId: `local:${"b".repeat(64)}`, contentHash: localHash, objectKey: `originals/${"a".repeat(64)}/source` })).toBe(true);
      expect((await core.getSourceItemByProviderId(localSource.id, `local:${"b".repeat(64)}`))?.objectKey).toBe(`originals/${"a".repeat(64)}/source`);

      const job = await repository.createJob({ workspaceId: workspace.workspaceId, workerId: worker!.id, action: "open_url", actionMode: "assisted", targetUrl: "https://example.com/test", expectedOrigin: "https://example.com", allowedDomains: ["example.com"], instructions: "Open the test page.", idempotencyKey: `companion-${suffix}`, createdBy: user.id });
      expect((await repository.createJob({ workspaceId: workspace.workspaceId, workerId: worker!.id, action: "open_url", actionMode: "assisted", targetUrl: "https://example.com/test", expectedOrigin: "https://example.com", allowedDomains: ["example.com"], instructions: "Open the test page.", idempotencyKey: `companion-${suffix}`, createdBy: user.id })).id).toBe(job.id);
      const claimed = await repository.claimNextJob(worker!.id, 300);
      expect(claimed?.job).toMatchObject({ id: job.id, status: "claimed", attemptCount: 1 });
      const now = new Date();
      const envelope: CompanionJobEnvelope = { schemaVersion: 1, jobId: job.id, workerId: worker!.id, workspaceId: workspace.workspaceId, action: "open_url", mode: "assisted", targetUrl: job.targetUrl, expectedOrigin: job.expectedOrigin, allowedDomains: job.allowedDomains, instructions: job.instructions, idempotencyKey: job.idempotencyKey, claimToken: claimed!.claimToken, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
      const signature = signCompanionJob(token.secret, envelope);
      expect(verifyCompanionJob(token.secret, envelope, signature, new Date(now.getTime() + 1_000))).toBe(true);
      expect(await repository.completeJob({ workerId: worker!.id, jobId: job.id, claimToken: claimed!.claimToken, status: "succeeded", result: { opened: true } })).toBe(true);
      expect(await repository.completeJob({ workerId: worker!.id, jobId: job.id, claimToken: claimed!.claimToken, status: "succeeded", result: {} })).toBe(false);

      await repository.createJob({ workspaceId: workspace.workspaceId, workerId: worker!.id, action: "open_url", actionMode: "confirm_before_submit", targetUrl: "https://example.com/next", expectedOrigin: "https://example.com", allowedDomains: ["example.com"], instructions: "Wait for confirmation.", idempotencyKey: `paused-${suffix}`, createdBy: user.id });
      expect(await repository.setWorkerStatus(workspace.workspaceId, worker!.id, "paused")).toBe(true);
      expect(await repository.claimNextJob(worker!.id)).toBeUndefined();
      expect(await repository.setWorkerStatus(workspace.workspaceId, worker!.id, "active")).toBe(true);
      expect((await repository.claimNextJob(worker!.id))?.job.id).toBeDefined();
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });
});
