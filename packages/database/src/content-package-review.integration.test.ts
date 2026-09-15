import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { ContentPackageReviewRepository, assertCurrentContentPackageApprovalInTransaction } from "./content-package-review-repository";
import type { ContentPackageWrite } from "./models";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name.startsWith("market_me_qa_") && name !== "market_me_ci") throw new Error("Package review integration requires an isolated QA database.");
}
let sql: DatabaseClient;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function taggedClient(tag: string): Promise<DatabaseClient> {
  const client = createDatabaseClient(databaseUrl!, { max: 1 });
  try {
    await client`
      SELECT set_config('application_name',${tag},false),
        set_config('lock_timeout','8s',false),
        set_config('statement_timeout','15s',false)
    `;
    return client;
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
}

async function waitUntilBlockedBy(tag: string, blockerPid: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  let observed: { pid: number; blockingPids: number[] }[] = [];
  while (Date.now() < deadline) {
    observed = await sql<{ pid: number; blockingPids: number[] }[]>`
      SELECT pid,pg_blocking_pids(pid) AS blocking_pids
      FROM pg_stat_activity
      WHERE datname=current_database() AND application_name=${tag}
        AND wait_event_type='Lock'
    `;
    const blocked = observed.find((row) => row.blockingPids.map(Number).includes(blockerPid));
    if (blocked) return Number(blocked.pid);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Backend ${tag} did not queue behind ${blockerPid}; observed ${JSON.stringify(observed)}`);
}

async function fixture() {
  const core = new MarketMeRepository(sql); const reviews = new ContentPackageReviewRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `package-review-${randomUUID()}@market-me.local`, displayName: "Exact Review QA" });
  const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Review source", provider: "local",
    locations: [{ providerLocationId: "fixture", displayPath: "/Fixtures" }], recursive: false, readinessMode: "immediate",
    stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true }, user.id);
  await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id, upserts: [{ workspaceId: workspace.workspaceId,
    smartSourceId: source.id, providerItemId: "fact", name: "fact.txt", displayPath: "/Fixtures/fact.txt", mimeType: "text/plain", isFolder: false,
    contentHash: "sha256:synthetic-review" }], deletedProviderItemIds: [] });
  const item = (await core.getSourceItemByProviderId(source.id, "fact"))!;
  const input: ContentPackageWrite = { workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
    title: "Café 🚀 exact review", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
    evidence: [{ id: randomUUID(), factKey: "event.time", claim: "The event starts at noon.", provenance: "observed", sourceReferences: ["source:synthetic"], confidence: 1 }] };
  const pkg = await core.saveContentPackage(input);
  const identity = { workspaceId: workspace.workspaceId, packageId: pkg.id, actorUserId: user.id };
  const expectation = async () => {
    const review = (await reviews.getReview(identity.workspaceId, identity.packageId, identity.actorUserId))!;
    return { ...identity, expectedVersion: review.version, expectedReviewFingerprint: review.reviewFingerprint };
  };
  const cleanup = async () => {
    await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id=${user.id}`;
  };
  return { core, reviews, user, workspace, source, item, input, pkg, identity, expectation, cleanup };
}

describe.skipIf(!databaseUrl)("exact Content Package approval", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!, { max: 12 }); });
  afterAll(async () => { await sql?.end(); });

  it("captures raw UTC microseconds, coherent exact content and immutable receipt history", async () => {
    const f = await fixture();
    try {
      await sql`UPDATE content_package SET created_at='2026-09-09T12:34:56.123456Z' WHERE id=${f.pkg.id}`;
      await sql`UPDATE evidence_item SET created_at='2026-09-09T12:34:56.654321Z' WHERE content_package_id=${f.pkg.id}`;
      const displayed = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(displayed.snapshot.package.createdAtUtcMicros).toBe("2026-09-09T12:34:56.123456Z");
      expect(displayed.snapshot.evidence[0]!.createdAtUtcMicros).toBe("2026-09-09T12:34:56.654321Z");
      const saved = await f.reviews.approve({ ...await f.expectation(), idempotencyKey: randomUUID() });
      expect(saved.replayed).toBe(false); expect(saved.review?.currentApprovalValid).toBe(true);
      expect(saved.approval.reviewSnapshot).toEqual(displayed.snapshot);
      expect(saved.approval.createdAt).toMatch(/\.\d{6}Z$/);
      await expect(sql`UPDATE content_package_approval SET created_at=clock_timestamp() WHERE id=${saved.approval.id}`).rejects.toMatchObject({ code: "23514" });
      const proof = await sql`SELECT * FROM learning_review_proof WHERE content_package_id=${f.pkg.id}`;
      expect(proof).toHaveLength(1);
      await expect(sql`UPDATE learning_review_proof SET decision_snapshot='{}'::jsonb WHERE content_package_id=${f.pkg.id}`).rejects.toMatchObject({ code: "23514" });
      expect(await f.reviews.getApproval(f.identity.workspaceId, saved.approval.id, f.user.id)).toEqual(saved.approval);
    } finally { await f.cleanup(); }
  });

  it("serializes a lost-response retry into one receipt and rejects changed intent under the same key", async () => {
    const f = await fixture();
    try {
      const attempt = { ...await f.expectation(), idempotencyKey: randomUUID() };
      const results = await Promise.all(Array.from({ length: 5 }, () => f.reviews.approve(attempt)));
      expect(new Set(results.map((row) => row.approval.id)).size).toBe(1);
      expect(results.filter((row) => !row.replayed)).toHaveLength(1);
      const receipt = results[0]!.approval;
      await f.core.saveContentPackage({ ...f.input, title: "New ingestion", evidence: [{ ...f.input.evidence[0]!, id: randomUUID(), claim: "A changed source fact." }] });
      expect((await f.reviews.approve(attempt)).approval).toEqual(receipt);
      expect(await f.reviews.getApprovalByKey(f.identity.workspaceId, attempt.idempotencyKey, f.user.id)).toEqual(receipt);
      await expect(f.reviews.approve({ ...await f.expectation(), idempotencyKey: attempt.idempotencyKey })).rejects.toMatchObject({ code: "idempotency_conflict", existingApprovalId: receipt.id });
      const current = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(current.version).toBe(2); expect(current.currentApproval).toBeNull(); expect(current.currentApprovalValid).toBe(false);
      expect(await f.reviews.getApproval(f.identity.workspaceId, receipt.id, f.user.id)).toEqual(receipt);
    } finally { await f.cleanup(); }
  });

  it.each(["owner", "admin", "approver", "editor", "analyst", "viewer"])("enforces %s review permissions in the repository", async (role) => {
    const f = await fixture();
    try {
      await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.identity.workspaceId} AND user_id=${f.user.id}`;
      const attempt = { ...await f.expectation(), idempotencyKey: randomUUID() };
      expect(await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id)).toBeDefined();
      if (["owner", "admin", "approver"].includes(role)) expect((await f.reviews.approve(attempt)).review?.currentApprovalValid).toBe(true);
      else await expect(f.reviews.approve(attempt)).rejects.toMatchObject({ code: "access_denied" });
    } finally { await f.cleanup(); }
  });

  it("does not treat a legacy approved flag as an exact attestation", async () => {
    const f = await fixture();
    try {
      await sql`UPDATE content_package SET status='approved' WHERE id=${f.pkg.id}`;
      const old = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(old.historicalApproval).toBe(true); expect(old.currentApprovalValid).toBe(false);
      await expect(sql.begin((tx) => assertCurrentContentPackageApprovalInTransaction(tx, {
        workspaceId: f.identity.workspaceId, contentPackageId: f.pkg.id, expectedPackageVersion: 1,
      }))).rejects.toMatchObject({ code: "approval_unavailable" });
      expect((await f.reviews.approve({ ...await f.expectation(), idempotencyKey: randomUUID() })).review?.currentApprovalValid).toBe(true);
    } finally { await f.cleanup(); }
  });

  it("detects in-place evidence changes without pretending ingestion version changed", async () => {
    const f = await fixture();
    try {
      const before = await f.expectation();
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM content_package WHERE id=${f.pkg.id} FOR UPDATE`;
        await tx`UPDATE evidence_item SET claim='Different exact fact' WHERE content_package_id=${f.pkg.id}`;
      });
      const after = await f.expectation();
      expect(after.expectedVersion).toBe(before.expectedVersion); expect(after.expectedReviewFingerprint).not.toBe(before.expectedReviewFingerprint);
      await expect(f.reviews.approve({ ...before, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "review_changed" });
      expect(await sql`SELECT id FROM content_package_approval WHERE content_package_id=${f.pkg.id}`).toHaveLength(0);
    } finally { await f.cleanup(); }
  });

  it("preserves JSON underscore keys, numeric-looking keys and exact bigint bytes; rejects numeric rounding", async () => {
    const f = await fixture();
    try {
      const assetId = randomUUID();
      await sql`INSERT INTO content_asset(id,content_package_id,role,file_name,mime_type,content_hash,byte_size,
        extraction_status,metadata,recipe) VALUES (${assetId},${f.pkg.id},'supporting','exact.bin','application/octet-stream','sha256:exact',
          9007199254740993,'skipped','{"snake_key":{"10":"ten","2":"two"}}'::jsonb,'{}'::jsonb)`;
      const exact = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(exact.snapshot.assets[0]!.byteSizeDecimal).toBe("9007199254740993");
      expect(exact.snapshot.assets[0]!.metadata).toEqual({ snake_key: { "10": "ten", "2": "two" } });
      await sql`UPDATE content_asset SET metadata='{"number":9007199254740993}'::jsonb WHERE id=${assetId}`;
      await expect(f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id)).rejects.toMatchObject({ code: "review_snapshot_lossy" });
    } finally { await f.cleanup(); }
  });

  it("rejects derivative lineage that does not resolve to a local original", async () => {
    const f = await fixture();
    try {
      await expect(f.core.saveContentPackage({ ...f.input, assets: [{ clientKey: "loop", sourceAssetClientKey: "loop",
        role: "derivative", fileName: "loop.webp", mimeType: "image/webp", contentHash: "sha256:loop",
        extractionStatus: "skipped", metadata: {} }] })).rejects.toMatchObject({ code: "invalid_review_input" });
      const assetId = randomUUID();
      await sql`INSERT INTO content_asset(id,content_package_id,source_asset_id,role,file_name,mime_type,content_hash,
        extraction_status,metadata,recipe) VALUES (${assetId},${f.pkg.id},${assetId},'derivative','self.webp','image/webp',
          'sha256:self-lineage','skipped','{}'::jsonb,'{}'::jsonb)`;
      const review = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(review.blockers).toContainEqual(expect.objectContaining({ code: "asset_source_invalid", assetId }));
      await expect(f.reviews.approve({ ...await f.expectation(), idempotencyKey: randomUUID() }))
        .rejects.toMatchObject({ code: "review_blocked" });
      expect(await sql`SELECT id FROM content_package_approval WHERE content_package_id=${f.pkg.id}`).toHaveLength(0);
    } finally { await f.cleanup(); }
  });

  it("returns the actual root for simultaneous first ingestion and keeps all children local", async () => {
    const f = await fixture();
    try {
      await sql`DELETE FROM content_package WHERE id=${f.pkg.id}`;
      const results = await Promise.all(Array.from({ length: 4 }, (_, index) => f.core.saveContentPackage({ ...f.input, title: `Concurrent ${index}`,
        evidence: [{ ...f.input.evidence[0]!, id: randomUUID() }] })));
      expect(new Set(results.map((row) => row.id)).size).toBe(1);
      const rows = await sql`SELECT id,version FROM content_package WHERE smart_source_id=${f.source.id}`;
      expect(rows).toHaveLength(1); expect(rows[0]!.version).toBe(4);
      expect(await sql`SELECT id FROM evidence_item WHERE content_package_id=${rows[0]!.id}`).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it("serializes approval before a queued material writer and preserves the superseded exact receipt", async () => {
    const f = await fixture();
    const suffix = randomUUID().slice(0, 8);
    const approvalTag = `mm-approve-first-${suffix}`;
    const writerTag = `mm-writer-second-${suffix}`;
    const gateSql = await taggedClient(`mm-root-gate-${suffix}`);
    const approvalSql = await taggedClient(approvalTag);
    const writerSql = await taggedClient(writerTag);
    const attempt = { ...await f.expectation(), idempotencyKey: randomUUID() };
    const release = deferred<void>();
    const locked = deferred<number>();
    const work: Promise<unknown>[] = [];
    const gateWork = gateSql.begin(async (tx) => {
      try {
        const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx`SELECT id FROM content_package WHERE id=${f.pkg.id} FOR UPDATE`;
        locked.resolve(Number(pid));
        await release.promise;
      } catch (error) {
        locked.reject(error);
        throw error;
      }
    });
    work.push(gateWork); void gateWork.catch(() => undefined);
    try {
      const gatePid = await locked.promise;
      const approvalPromise = new ContentPackageReviewRepository(approvalSql).approve(attempt);
      work.push(approvalPromise); void approvalPromise.catch(() => undefined);
      const approvalPid = await waitUntilBlockedBy(approvalTag, gatePid);

      const writerPromise = new MarketMeRepository(writerSql).saveContentPackage({
        ...f.input,
        title: "Material writer committed second",
        evidence: [{ ...f.input.evidence[0]!, id: randomUUID(), claim: "The source now says one o'clock." }],
      });
      work.push(writerPromise); void writerPromise.catch(() => undefined);
      await waitUntilBlockedBy(writerTag, approvalPid);

      release.resolve(undefined);
      await gateWork;
      const [approved, written] = await Promise.all([approvalPromise, writerPromise]);
      expect(approved.replayed).toBe(false);
      expect(approved.review?.currentApprovalValid).toBe(true);
      expect(written.version).toBe(2);

      const current = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(current.snapshot.package.title).toBe("Material writer committed second");
      expect(current.reviewFingerprint).not.toBe(attempt.expectedReviewFingerprint);
      expect(current.currentApproval).toBeNull();
      expect(current.currentApprovalValid).toBe(false);
      expect(approved.approval.reviewSnapshot.package.title).toBe(f.input.title);
      expect(await f.reviews.getApproval(f.identity.workspaceId, approved.approval.id, f.user.id)).toEqual(approved.approval);
      expect(await sql`SELECT id FROM content_package_approval WHERE idempotency_key=${attempt.idempotencyKey}`).toHaveLength(1);
    } finally {
      release.resolve(undefined);
      await Promise.allSettled(work);
      await Promise.all([gateSql.end(), approvalSql.end(), writerSql.end()]);
      await f.cleanup();
    }
  }, 20_000);

  it("serializes a material writer before queued approval and creates no stale receipt", async () => {
    const f = await fixture();
    const suffix = randomUUID().slice(0, 8);
    const writerTag = `mm-writer-first-${suffix}`;
    const approvalTag = `mm-approve-second-${suffix}`;
    const gateSql = await taggedClient(`mm-root-gate-${suffix}`);
    const writerSql = await taggedClient(writerTag);
    const approvalSql = await taggedClient(approvalTag);
    const attempt = { ...await f.expectation(), idempotencyKey: randomUUID() };
    const release = deferred<void>();
    const locked = deferred<number>();
    const work: Promise<unknown>[] = [];
    const gateWork = gateSql.begin(async (tx) => {
      try {
        const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx`SELECT id FROM content_package WHERE id=${f.pkg.id} FOR UPDATE`;
        locked.resolve(Number(pid));
        await release.promise;
      } catch (error) {
        locked.reject(error);
        throw error;
      }
    });
    work.push(gateWork); void gateWork.catch(() => undefined);
    try {
      const gatePid = await locked.promise;
      const writerPromise = new MarketMeRepository(writerSql).saveContentPackage({
        ...f.input,
        title: "Material writer committed first",
        evidence: [{ ...f.input.evidence[0]!, id: randomUUID(), claim: "The source now says two o'clock." }],
      });
      work.push(writerPromise); void writerPromise.catch(() => undefined);
      const writerPid = await waitUntilBlockedBy(writerTag, gatePid);

      const approvalPromise = new ContentPackageReviewRepository(approvalSql).approve(attempt);
      work.push(approvalPromise); void approvalPromise.catch(() => undefined);
      await waitUntilBlockedBy(approvalTag, writerPid);

      release.resolve(undefined);
      await gateWork;
      const written = await writerPromise;
      expect(written.version).toBe(2);
      await expect(approvalPromise).rejects.toMatchObject({ code: "package_version_mismatch" });
      const current = (await f.reviews.getReview(f.identity.workspaceId, f.pkg.id, f.user.id))!;
      expect(current.snapshot.package.title).toBe("Material writer committed first");
      expect(current.reviewFingerprint).not.toBe(attempt.expectedReviewFingerprint);
      expect(current.currentApproval).toBeNull();
      expect(await sql`SELECT id FROM content_package_approval WHERE idempotency_key=${attempt.idempotencyKey}`).toHaveLength(0);
      expect(await sql`SELECT id FROM learning_review WHERE content_package_id=${f.pkg.id} AND action='package_approved'`).toHaveLength(0);
    } finally {
      release.resolve(undefined);
      await Promise.allSettled(work);
      await Promise.all([gateSql.end(), writerSql.end(), approvalSql.end()]);
      await f.cleanup();
    }
  }, 20_000);

  it("rechecks membership after a queued approval waits for revocation and creates no unauthorized receipt", async () => {
    const f = await fixture();
    const suffix = randomUUID().slice(0, 8);
    const approvalTag = `mm-approve-revoke-${suffix}`;
    const revokerSql = await taggedClient(`mm-revoker-${suffix}`);
    const approvalSql = await taggedClient(approvalTag);
    const attempt = { ...await f.expectation(), idempotencyKey: randomUUID() };
    const release = deferred<void>();
    const locked = deferred<number>();
    const work: Promise<unknown>[] = [];
    const revocationWork = revokerSql.begin(async (tx) => {
      try {
        const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx`SELECT role FROM workspace_membership
          WHERE workspace_id=${f.identity.workspaceId} AND user_id=${f.user.id} FOR UPDATE`;
        locked.resolve(Number(pid));
        await release.promise;
        await tx`DELETE FROM workspace_membership
          WHERE workspace_id=${f.identity.workspaceId} AND user_id=${f.user.id}`;
      } catch (error) {
        locked.reject(error);
        throw error;
      }
    });
    work.push(revocationWork); void revocationWork.catch(() => undefined);
    try {
      const revokerPid = await locked.promise;
      const approvalPromise = new ContentPackageReviewRepository(approvalSql).approve(attempt);
      work.push(approvalPromise); void approvalPromise.catch(() => undefined);
      await waitUntilBlockedBy(approvalTag, revokerPid);

      release.resolve(undefined);
      await revocationWork;
      await expect(approvalPromise).rejects.toMatchObject({ code: "access_denied" });
      expect(await sql`SELECT user_id FROM workspace_membership
        WHERE workspace_id=${f.identity.workspaceId} AND user_id=${f.user.id}`).toHaveLength(0);
      expect(await sql`SELECT id FROM content_package_approval WHERE idempotency_key=${attempt.idempotencyKey}`).toHaveLength(0);
      expect(await sql`SELECT id FROM learning_review WHERE content_package_id=${f.pkg.id} AND action='package_approved'`).toHaveLength(0);
    } finally {
      release.resolve(undefined);
      await Promise.allSettled(work);
      await Promise.all([revokerSql.end(), approvalSql.end()]);
      await f.cleanup();
    }
  }, 20_000);

  it("rejects cross-workspace source lineage and ingestion attempts to self-approve", async () => {
    const f = await fixture(); const other = await fixture();
    try {
      await expect(f.core.saveContentPackage({ ...f.input, workspaceId: other.identity.workspaceId })).rejects.toMatchObject({ code: "invalid_review_input" });
      await expect(f.core.saveContentPackage({ ...f.input, status: "approved" } as unknown as ContentPackageWrite)).rejects.toMatchObject({ code: "invalid_review_input" });
      const attempt = { ...await f.expectation(), idempotencyKey: randomUUID() };
      await expect(f.reviews.approve({ ...attempt, actorUserId: other.user.id })).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.reviews.approve({ ...attempt, expectedVersion: 2 })).rejects.toMatchObject({ code: "package_version_mismatch" });
      await expect(f.reviews.approve({ ...attempt, expectedReviewFingerprint: undefined } as unknown as typeof attempt)).rejects.toMatchObject({ code: "invalid_review_input" });
    } finally { await f.cleanup(); await other.cleanup(); }
  });
});
