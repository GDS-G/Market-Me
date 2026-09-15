import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { CampaignRepository } from "./campaign-repository";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import { createContentPackageReviewFingerprint, type ContentPackageReviewEvidenceV1, type ContentPackageReviewSnapshotV1 } from "./content-package-review-fingerprint";
import { evaluateReviewedEvidence } from "./content-package-reviewed-evidence";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !/^market_me_qa_124(?:_|$)|^market_me_ci$/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)))) {
  throw new Error("Package approval generation tests require an isolated market_me_qa_124_* or market_me_ci database.");
}
let sql: DatabaseClient;

async function makeFixture() {
  const core = new MarketMeRepository(sql), campaigns = new CampaignRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `approval-generation-${randomUUID()}@market-me.local`, displayName: "Exact approval generation QA" });
  const cleanup = async () => {
    await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Approval generation fixture", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/ApprovalGenerationQA" }], recursive: false, readinessMode: "immediate",
      stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, user.id);
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id, deletedProviderItemIds: [],
      upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "facts", name: "facts.txt", displayPath: "/ApprovalGenerationQA/facts.txt",
        mimeType: "text/plain", isFolder: false, contentHash: "sha256:synthetic-proof-fixture" }] });
    const item = (await core.getSourceItemByProviderId(source.id, "facts"))!;
    const factIds = [randomUUID(), randomUUID(), randomUUID()];
    const contentPackage = await core.saveContentPackage({ workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
      title: "Reviewed facts", status: "ready", contextPackVersionIds: [], assets: [],
      evidence: [
        { id: factIds[0]!, claim: "Admission is free", provenance: "observed", sourceReferences: ["source:one"] },
        { id: factIds[1]!, factKey: "venue", claim: "The venue is Central Hall", provenance: "authoritative_context", sourceReferences: ["source:two"], confidence: 1 },
        { id: factIds[2]!, factKey: "venue", claim: "The venue is rejected", provenance: "observed", sourceReferences: ["source:old"], confidence: 0.5 },
      ], conflicts: [{ factKey: "venue", candidateEvidenceIds: factIds.slice(1) }] });
    // This fixture deliberately exercises raw SQL proof constraints. Material
    // fixture changes obey the same package-first order as production writers.
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM content_package WHERE id = ${contentPackage.id} FOR UPDATE`;
      await tx`UPDATE evidence_conflict SET status = 'resolved', resolution_evidence_id = ${factIds[1]!}, resolution_note = 'Exact selected venue', resolved_at = clock_timestamp()
        WHERE content_package_id = ${contentPackage.id}`;
    });
    const raw = (await sql<{ snapshotJson: string }[]>`
      SELECT jsonb_build_object('schemaVersion', 1, 'reviewContract', 'content-package-review-v1',
        'package', jsonb_build_object('id', p.id::text, 'workspaceId', p.workspace_id::text, 'smartSourceId', p.smart_source_id::text,
          'rootSourceItemId', p.root_source_item_id::text, 'version', p.version, 'title', p.title, 'confidence', p.confidence,
          'contextPackVersionIds', to_jsonb(p.context_pack_version_ids), 'createdAtUtcMicros', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
        'evidence', (SELECT jsonb_agg(jsonb_build_object('id', e.id::text, 'factKey', e.fact_key, 'claim', e.claim, 'provenance', e.provenance,
          'sourceReferences', to_jsonb(e.source_references), 'confidence', e.confidence, 'contextPackVersionId', e.context_pack_version_id::text,
          'supersededByEvidenceId', e.superseded_by_evidence_id::text,
          'createdAtUtcMicros', to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY e.id)
          FROM evidence_item e WHERE e.content_package_id = p.id),
        'conflicts', (SELECT jsonb_agg(jsonb_build_object('id', c.id::text, 'factKey', c.fact_key, 'candidateEvidenceIds', to_jsonb(c.candidate_evidence_ids),
          'status', c.status, 'resolutionEvidenceId', c.resolution_evidence_id::text, 'resolutionNote', c.resolution_note,
          'createdAtUtcMicros', to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'resolvedAtUtcMicros', to_char(c.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY c.id)
          FROM evidence_conflict c WHERE c.content_package_id = p.id), 'assets', '[]'::jsonb)::text AS snapshot_json
      FROM content_package p WHERE p.id = ${contentPackage.id}
    `)[0]!;
    const captured = createContentPackageReviewFingerprint(JSON.parse(raw.snapshotJson));
    const effectiveIds = [...evaluateReviewedEvidence(captured.snapshot).effectiveEvidenceIds];
    const compiled = compileGeneralAnnouncementPreparation({ workspaceId: workspace.workspaceId, contentPackageId: contentPackage.id, expectedPackageVersion: contentPackage.version });
    const campaign = await campaigns.createCampaign(compiled.campaign, user.id);
    const published = (await campaigns.publishCampaign(workspace.workspaceId, campaign.id))!;
    const campaignVersionId = published.currentVersion!.id;
    const recordApproval = async (marker: "valid" | "missing" | "wrong approval" | "wrong workspace" | "wrong package" | "wrong version" | "wrong fingerprint" | "wrong hash" | "wrong actor" | "wrong learning" | "extra field" = "valid") => {
      const approvalId = randomUUID(), learningId = randomUUID();
      const canonicalInput = JSON.stringify({ contract: "market-me:content-package-approval:v1", workspaceId: workspace.workspaceId,
        packageId: contentPackage.id, expectedVersion: contentPackage.version, expectedReviewFingerprint: captured.token });
      const configurationHash = createHash("sha256").update(canonicalInput).digest("hex");
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM content_package WHERE id = ${contentPackage.id} FOR UPDATE`;
        await tx`INSERT INTO learning_review(id, workspace_id, content_package_id, actor_user_id, action)
          VALUES (${learningId}, ${workspace.workspaceId}, ${contentPackage.id}, ${user.id}, 'package_approved')`;
        const admission: Record<string, unknown> = { approvalId, workspaceId: workspace.workspaceId, contentPackageId: contentPackage.id,
          version: contentPackage.version, reviewFingerprint: captured.token, configurationHash, createdBy: user.id, learningReviewId: learningId };
        if (marker === "wrong approval") admission.approvalId = randomUUID();
        if (marker === "wrong workspace") admission.workspaceId = randomUUID();
        if (marker === "wrong package") admission.contentPackageId = randomUUID();
        if (marker === "wrong version") admission.version = contentPackage.version + 1;
        if (marker === "wrong fingerprint") admission.reviewFingerprint = `mm-package-review-v1:sha256:${"0".repeat(64)}`;
        if (marker === "wrong hash") admission.configurationHash = "0".repeat(64);
        if (marker === "wrong actor") admission.createdBy = randomUUID();
        if (marker === "wrong learning") admission.learningReviewId = randomUUID();
        if (marker === "extra field") admission.unvalidated = true;
        if (marker !== "missing") await tx`SELECT set_config('market_me.content_package_approval_admission', ${JSON.stringify(admission)}, true)`;
        await tx`INSERT INTO content_package_approval(id, workspace_id, content_package_id, content_package_version, idempotency_key,
          review_fingerprint, canonical_review_snapshot, effective_evidence_ids, canonical_input, configuration_hash, created_by, learning_review_id)
          VALUES (${approvalId}, ${workspace.workspaceId}, ${contentPackage.id}, ${contentPackage.version}, ${randomUUID()}, ${captured.token},
            ${captured.canonicalSnapshot}, ${effectiveIds}, ${canonicalInput}, ${configurationHash}, ${user.id}, ${learningId})`;
        await tx`INSERT INTO learning_review_proof(learning_review_id, workspace_id, content_package_id, content_package_version, action,
          before_review_fingerprint, after_review_fingerprint, decision_snapshot)
          VALUES (${learningId}, ${workspace.workspaceId}, ${contentPackage.id}, ${contentPackage.version}, 'package_approved',
            ${captured.token}, ${captured.token}, ${tx.json({ approvalId, effectiveEvidenceIds: effectiveIds })})`;
        await tx`UPDATE content_package SET status = 'approved', current_approval_id = ${approvalId} WHERE id = ${contentPackage.id}`;
      });
      return { approvalId, learningId };
    };
    const approval = await recordApproval();
    const effective = captured.snapshot.evidence.filter((e) => effectiveIds.includes(e.id)).sort((a, b) =>
      a.createdAtUtcMicros < b.createdAtUtcMicros ? -1 : a.createdAtUtcMicros > b.createdAtUtcMicros ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const evidenceSnapshot = effective.map(({ id, factKey, claim, provenance, sourceReferences, confidence }) =>
      ({ id, ...(factKey === null ? {} : { factKey }), claim, provenance, sourceReferences, confidence }));
    const insertGeneration = async (overrides: { approvalId?: string | null; evidence?: unknown; version?: number; workspaceId?: string } = {}) => {
      const generationId = randomUUID();
      await sql`INSERT INTO draft_generation(id, workspace_id, campaign_version_id, content_package_id, content_package_version,
        content_package_approval_id, information_depth, promotional_strength, evidence_snapshot, generator_provider, generator_model, generator_version, prompt_version, created_by)
        VALUES (${generationId}, ${overrides.workspaceId ?? workspace.workspaceId}, ${campaignVersionId}, ${contentPackage.id}, ${overrides.version ?? contentPackage.version},
          ${overrides.approvalId === undefined ? approval.approvalId : overrides.approvalId}, 'contextual', 'informational',
          ${sql.json((overrides.evidence ?? evidenceSnapshot) as JSONValue)}, 'deterministic', 'fixture', 'fixture', 'fixture', ${user.id})`;
      return generationId;
    };
    return { workspace, user, contentPackage, captured, effectiveIds, effective, evidenceSnapshot, approval, recordApproval, insertGeneration, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function withFixture(run: (f: Fixture) => Promise<void>) {
  const f = await makeFixture(); try { await run(f); } finally { await f.cleanup(); }
}

describe.skipIf(!databaseUrl)("exact package approval generation database guards", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!, { max: 3 }); });
  afterAll(async () => { await sql?.end(); });

  it("persists only exact proved effective facts, preserving nulls and omitting null factKey", async () => withFixture(async (f) => {
    const generationId = await f.insertGeneration();
    const row = (await sql<{ approvalId: string; evidenceJson: string }[]>`SELECT content_package_approval_id AS approval_id,
      evidence_snapshot::text AS evidence_json FROM draft_generation WHERE id = ${generationId}`)[0]!;
    expect(row.approvalId).toBe(f.approval.approvalId); expect(JSON.parse(row.evidenceJson)).toEqual(f.evidenceSnapshot);
    expect(row.evidenceJson).not.toContain("rejected");
  }));
  it.each([null, "00000000-0000-4000-8000-000000000001"])("rejects legacy missing or nonexistent proof %s", async (approvalId) => withFixture(async (f) => {
    await expect(f.insertGeneration({ approvalId })).rejects.toMatchObject({ code: "23514" });
  }));
  it("rejects a mismatched package revision", async () => withFixture(async (f) => {
    await expect(f.insertGeneration({ version: f.contentPackage.version + 1 })).rejects.toMatchObject({ code: "23514" });
  }));
  it.each(["missing", "wrong approval", "wrong workspace", "wrong package", "wrong version", "wrong fingerprint", "wrong hash", "wrong actor", "wrong learning", "extra field"] as const)(
    "rejects receipt insertion with %s locked-review admission marker", async (marker) => withFixture(async (f) => {
      await expect(f.recordApproval(marker)).rejects.toMatchObject({ code: "23514" });
      expect(await sql`SELECT id FROM content_package_approval WHERE workspace_id = ${f.workspace.workspaceId}`).toHaveLength(1);
      expect(await sql`SELECT id FROM learning_review WHERE workspace_id = ${f.workspace.workspaceId}`).toHaveLength(1);
    }));
  it("timestamps receipt and proof after a package lock wait, not at transaction start", async () => withFixture(async (f) => {
    let locked!: () => void, release!: () => void;
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    let holderPid = 0, releaseInstant = "";
    const holder = sql.begin(async (tx) => {
      holderPid = (await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      await tx`SELECT id FROM content_package WHERE id = ${f.contentPackage.id} FOR UPDATE`;
      locked(); await releaseLock;
      releaseInstant = (await tx<{ now: string }[]>`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)[0]!.now;
    });
    await lockReady;
    const approving = f.recordApproval();
    try {
      await expect.poll(async () => (await sql<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS blocked`)[0]!.blocked,
      { timeout: 3_000, interval: 20 }).toBe(true);
    } finally { release(); await holder; }
    const approved = await approving;
    const [timestamps] = await sql<{ receiptAfterRelease: boolean; proofAfterRelease: boolean }[]>`
      SELECT approval.created_at >= ${releaseInstant}::timestamptz AS receipt_after_release,
        proof.created_at >= ${releaseInstant}::timestamptz AS proof_after_release
      FROM content_package_approval approval JOIN learning_review_proof proof ON proof.learning_review_id = approval.learning_review_id
      WHERE approval.id = ${approved.approvalId}`;
    expect(timestamps).toMatchObject({ receiptAfterRelease: true, proofAfterRelease: true });
  }));
  it.each(["proof", "approval"])("rejects standalone %s deletion at commit while retaining its parent history", async (kind) => withFixture(async (f) => {
    await expect(sql.begin(async (tx) => {
      if (kind === "proof") await tx`DELETE FROM learning_review_proof WHERE learning_review_id = ${f.approval.learningId}`;
      else await tx`DELETE FROM content_package_approval WHERE id = ${f.approval.approvalId}`;
    })).rejects.toMatchObject({ code: "23514" });
    expect(await sql`SELECT id FROM content_package_approval WHERE id = ${f.approval.approvalId}`).toHaveLength(1);
    expect(await sql`SELECT learning_review_id FROM learning_review_proof WHERE learning_review_id = ${f.approval.learningId}`).toHaveLength(1);
  }));
  it.each(["proof with parent edit", "identical proof", "identical approval"])("rejects delete/reinsert even for %s", async (kind) => withFixture(async (f) => {
    const [proof] = await sql<{ raw: string }[]>`SELECT to_jsonb(proof)::text AS raw FROM learning_review_proof proof WHERE learning_review_id = ${f.approval.learningId}`;
    const [approval] = await sql<{ raw: string }[]>`SELECT to_jsonb(approval)::text AS raw FROM content_package_approval approval WHERE id = ${f.approval.approvalId}`;
    let reinserted = false;
    await expect(sql.begin(async (tx) => {
      if (kind === "identical approval") {
        await tx`DELETE FROM content_package_approval WHERE id = ${f.approval.approvalId}`;
        const row = JSON.parse(approval!.raw) as Record<string, unknown>;
        await tx`SELECT set_config('market_me.content_package_approval_admission', ${JSON.stringify({ approvalId: row.id,
          workspaceId: row.workspace_id, contentPackageId: row.content_package_id, version: row.content_package_version,
          reviewFingerprint: row.review_fingerprint, configurationHash: row.configuration_hash,
          createdBy: row.created_by, learningReviewId: row.learning_review_id })}, true)`;
        await tx`INSERT INTO content_package_approval SELECT * FROM jsonb_populate_record(NULL::content_package_approval, ${approval!.raw}::text::jsonb)`;
        await tx`UPDATE content_package SET current_approval_id = ${f.approval.approvalId} WHERE id = ${f.contentPackage.id}`;
      } else {
        await tx`DELETE FROM learning_review_proof WHERE learning_review_id = ${f.approval.learningId}`;
        // Regression: removing the proof must never unlock the parent, even
        // temporarily. Parent immutability now rejects this edit immediately.
        if (kind === "proof with parent edit") await tx`UPDATE learning_review SET notes = 'Rewritten during temporary proof gap' WHERE id = ${f.approval.learningId}`;
        await tx`INSERT INTO learning_review_proof SELECT * FROM jsonb_populate_record(NULL::learning_review_proof, ${proof!.raw}::text::jsonb)`;
      }
      reinserted = true;
    })).rejects.toMatchObject({ code: "23514" });
    expect(reinserted).toBe(kind !== "proof with parent edit");
    expect((await sql<{ notes: string | null }[]>`SELECT notes FROM learning_review WHERE id = ${f.approval.learningId}`)[0]!.notes).toBeNull();
    expect((await sql<{ raw: string }[]>`SELECT to_jsonb(proof)::text AS raw FROM learning_review_proof proof WHERE learning_review_id = ${f.approval.learningId}`)[0]!.raw).toBe(proof!.raw);
  }));
  it("rejects parent deletion of a proved non-approval Learning Review decision", async () => withFixture(async (f) => {
    const learningId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO learning_review(id, workspace_id, content_package_id, actor_user_id, action)
        VALUES (${learningId}, ${f.workspace.workspaceId}, ${f.contentPackage.id}, ${f.user.id}, 'corrected')`;
      await tx`INSERT INTO learning_review_proof(learning_review_id, workspace_id, content_package_id, content_package_version,
        action, before_review_fingerprint, after_review_fingerprint, decision_snapshot)
        VALUES (${learningId}, ${f.workspace.workspaceId}, ${f.contentPackage.id}, ${f.contentPackage.version},
          'corrected', ${f.captured.token}, ${f.captured.token}, ${tx.json({ fixture: "parent-deletion-guard" })})`;
    });
    await expect(sql.begin(async (tx) => { await tx`DELETE FROM learning_review WHERE id = ${learningId}`; }))
      .rejects.toMatchObject({ code: "23514" });
    expect(await sql`SELECT id FROM learning_review WHERE id = ${learningId}`).toHaveLength(1);
    expect(await sql`SELECT learning_review_id FROM learning_review_proof WHERE learning_review_id = ${learningId}`).toHaveLength(1);
    const [original] = await sql<{ raw: string }[]>`SELECT to_jsonb(review)::text AS raw FROM learning_review review WHERE id = ${learningId}`;
    const [proof] = await sql<{ raw: string }[]>`SELECT to_jsonb(proof)::text AS raw FROM learning_review_proof proof WHERE learning_review_id = ${learningId}`;
    let reinserted = false;
    await expect(sql.begin(async (tx) => {
      await tx`DELETE FROM learning_review WHERE id = ${learningId}`;
      await tx`INSERT INTO learning_review SELECT * FROM jsonb_populate_record(NULL::learning_review, ${original!.raw}::text::jsonb)`;
      await tx`INSERT INTO learning_review_proof SELECT * FROM jsonb_populate_record(NULL::learning_review_proof, ${proof!.raw}::text::jsonb)`;
      reinserted = true;
    })).rejects.toMatchObject({ code: "23514" });
    expect(reinserted).toBe(true);
    reinserted = false;
    await expect(sql.begin(async (tx) => {
      const replacementId = randomUUID();
      await tx`DELETE FROM learning_review_proof WHERE learning_review_id = ${learningId}`;
      await tx`UPDATE learning_review SET id = ${replacementId} WHERE id = ${learningId}`;
      const replacement = { ...JSON.parse(proof!.raw), learning_review_id: replacementId };
      await tx`INSERT INTO learning_review_proof SELECT * FROM jsonb_populate_record(NULL::learning_review_proof, ${JSON.stringify(replacement)}::text::jsonb)`;
      reinserted = true;
    })).rejects.toMatchObject({ code: "23514" });
    expect(reinserted).toBe(false);
    expect(await sql`SELECT id FROM learning_review WHERE id = ${learningId}`).toHaveLength(1);
  }));
  it("rejects direct evidence detachment while preserving FK detachment during source refresh", async () => withFixture(async (f) => {
    const learningId = randomUUID();
    const evidenceId = f.captured.snapshot.evidence[0]!.id;
    await sql.begin(async (tx) => {
      await tx`INSERT INTO learning_review(id, workspace_id, content_package_id, evidence_item_id, actor_user_id, action, notes)
        VALUES (${learningId}, ${f.workspace.workspaceId}, ${f.contentPackage.id}, ${evidenceId}, ${f.user.id}, 'accepted', 'Retained fixture decision')`;
      await tx`INSERT INTO learning_review_proof(learning_review_id, workspace_id, content_package_id, content_package_version,
        action, before_review_fingerprint, after_review_fingerprint, decision_snapshot)
        VALUES (${learningId}, ${f.workspace.workspaceId}, ${f.contentPackage.id}, ${f.contentPackage.version},
          'accepted', ${f.captured.token}, ${f.captured.token}, ${tx.json({ evidenceId, fixture: "source-refresh-detachment" })})`;
    });
    const [before] = await sql<{ evidenceItemId: string | null; retainedJson: string }[]>`
      SELECT evidence_item_id, (to_jsonb(review) - 'evidence_item_id')::text AS retained_json
      FROM learning_review review WHERE id = ${learningId}`;
    const [proofBefore] = await sql<{ raw: string }[]>`
      SELECT to_jsonb(proof)::text AS raw FROM learning_review_proof proof WHERE learning_review_id = ${learningId}`;

    await expect(sql`UPDATE learning_review SET evidence_item_id = NULL WHERE id = ${learningId}`)
      .rejects.toMatchObject({ code: "23514" });
    expect((await sql<{ evidenceItemId: string | null }[]>`
      SELECT evidence_item_id FROM learning_review WHERE id = ${learningId}`)[0]!.evidenceItemId).toBe(evidenceId);

    const replacementEvidenceId = randomUUID();
    const refreshed = await new MarketMeRepository(sql).saveContentPackage({
      workspaceId: f.workspace.workspaceId,
      smartSourceId: f.contentPackage.smartSourceId,
      rootSourceItemId: f.contentPackage.rootSourceItemId,
      title: "Reviewed facts after source refresh",
      status: "ready",
      ...(f.contentPackage.confidence === undefined ? {} : { confidence: f.contentPackage.confidence }),
      contextPackVersionIds: f.contentPackage.contextPackVersionIds,
      assets: [],
      evidence: [{ id: replacementEvidenceId, claim: "The refreshed source remains available", provenance: "observed", sourceReferences: ["source:refresh"] }],
      conflicts: [],
    });
    expect(refreshed.id).toBe(f.contentPackage.id);
    expect(refreshed.version).toBe(f.contentPackage.version + 1);
    const [after] = await sql<{ evidenceItemId: string | null; retainedJson: string }[]>`
      SELECT evidence_item_id, (to_jsonb(review) - 'evidence_item_id')::text AS retained_json
      FROM learning_review review WHERE id = ${learningId}`;
    expect(after).toEqual({ evidenceItemId: null, retainedJson: before!.retainedJson });
    expect((await sql<{ raw: string }[]>`
      SELECT to_jsonb(proof)::text AS raw FROM learning_review_proof proof WHERE learning_review_id = ${learningId}`)[0]!.raw)
      .toBe(proofBefore!.raw);
    expect(await sql`SELECT id FROM evidence_item WHERE id = ${evidenceId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM evidence_item WHERE id = ${replacementEvidenceId}`).toHaveLength(1);
    expect(await sql`SELECT id FROM content_package_approval WHERE id = ${f.approval.approvalId}`).toHaveLength(1);
    expect(await sql`SELECT learning_review_id FROM learning_review_proof WHERE learning_review_id IN (${learningId}, ${f.approval.learningId})`).toHaveLength(2);
    expect((await sql<{ currentApprovalId: string | null }[]>`
      SELECT current_approval_id FROM content_package WHERE id = ${f.contentPackage.id}`)[0]!.currentApprovalId).toBeNull();
  }));
  it.each(["claim", "provenance", "sourceReferences", "confidence", "order", "missing", "loser", "duplicate"])("rejects changed effective evidence: %s", async (change) => withFixture(async (f) => {
    const evidence = structuredClone(f.evidenceSnapshot) as Record<string, unknown>[];
    if (change === "order") evidence.reverse();
    else if (change === "missing") evidence.pop();
    else if (change === "duplicate") evidence.push(evidence[0]!);
    else if (change === "loser") evidence.push({ id: f.captured.snapshot.evidence.find((e) => !f.effectiveIds.includes(e.id))!.id });
    else evidence[0]![change] = change === "sourceReferences" ? ["different:source"] : change === "confidence" ? 0.125 : "Different value";
    await expect(f.insertGeneration({ evidence })).rejects.toMatchObject({ code: "23514" });
  }));
  it("retains the original immutable pin after identical reapproval while new generations use current proof", async () => withFixture(async (f) => {
    const generationId = await f.insertGeneration(); const next = await f.recordApproval();
    await expect(f.insertGeneration()).rejects.toMatchObject({ code: "23514" });
    await expect(f.insertGeneration({ approvalId: next.approvalId })).resolves.toBeTypeOf("string");
    await expect(sql`UPDATE draft_generation SET content_package_approval_id = ${next.approvalId} WHERE id = ${generationId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE draft_generation SET evidence_snapshot = '[]'::jsonb WHERE id = ${generationId}`).rejects.toMatchObject({ code: "23514" });
    expect((await sql<{ approvalId: string }[]>`SELECT content_package_approval_id AS approval_id FROM draft_generation WHERE id = ${generationId}`)[0]!.approvalId).toBe(f.approval.approvalId);
  }));
  it.each([false, true])("denies deleting/reinserting an unprepared proved generation (changed provenance=%s)", async (changed) => withFixture(async (f) => {
    const generationId = await f.insertGeneration();
    const [original] = await sql<{ raw: string }[]>`SELECT to_jsonb(generation)::text AS raw FROM draft_generation generation WHERE id = ${generationId}`;
    let reinserted = false;
    await expect(sql.begin(async (tx) => {
      await tx`DELETE FROM draft_generation WHERE id = ${generationId}`;
      const replacement = JSON.parse(original!.raw) as Record<string, unknown>;
      if (changed) replacement.generator_provider = "substituted-history";
      await tx`INSERT INTO draft_generation SELECT * FROM jsonb_populate_record(NULL::draft_generation, ${JSON.stringify(replacement)}::text::jsonb)`;
      reinserted = true;
    })).rejects.toMatchObject({ code: "23514" });
    expect(reinserted).toBe(true);
    expect((await sql<{ raw: string }[]>`SELECT to_jsonb(generation)::text AS raw FROM draft_generation generation WHERE id = ${generationId}`)[0]!.raw).toBe(original!.raw);
  }));
  it("denies coordinated package and full proved-history deletion while the workspace survives", async () => withFixture(async (f) => {
    const generationId = await f.insertGeneration();
    let allDeleted = false;
    await expect(sql.begin(async (tx) => {
      await tx`DELETE FROM draft_generation WHERE id = ${generationId}`;
      await tx`DELETE FROM content_package_approval WHERE id = ${f.approval.approvalId}`;
      await tx`DELETE FROM learning_review WHERE content_package_id = ${f.contentPackage.id}`;
      await tx`DELETE FROM content_package WHERE id = ${f.contentPackage.id}`;
      allDeleted = true;
    })).rejects.toMatchObject({ code: "23514" });
    expect(allDeleted).toBe(true);
    expect(await sql`SELECT id FROM content_package WHERE id = ${f.contentPackage.id}`).toHaveLength(1);
    expect(await sql`SELECT id FROM draft_generation WHERE id = ${generationId}`).toHaveLength(1);
    expect(await sql`SELECT id FROM content_package_approval WHERE id = ${f.approval.approvalId}`).toHaveLength(1);
    expect(await sql`SELECT learning_review_id FROM learning_review_proof WHERE learning_review_id = ${f.approval.learningId}`).toHaveLength(1);
  }));
  it("still permits deleting a never-reviewed package without erasing retained history", async () => withFixture(async (f) => {
    const itemId = randomUUID(), packageId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO source_item(id, workspace_id, smart_source_id, provider_item_id, name, display_path, mime_type)
        SELECT ${itemId}, workspace_id, smart_source_id, ${itemId}, 'unreviewed.txt', '/ApprovalGenerationQA/unreviewed.txt', 'text/plain'
        FROM content_package WHERE id = ${f.contentPackage.id}`;
      await tx`INSERT INTO content_package(id, workspace_id, smart_source_id, root_source_item_id, title, status)
        SELECT ${packageId}, workspace_id, smart_source_id, ${itemId}, 'Never reviewed', 'ready'
        FROM content_package WHERE id = ${f.contentPackage.id}`;
      await tx`DELETE FROM content_package WHERE id = ${packageId}`;
    });
    expect(await sql`SELECT id FROM content_package WHERE id = ${packageId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM content_package WHERE id = ${f.contentPackage.id}`).toHaveLength(1);
  }));
  it("requires a complete Learning Review proof transaction and preserves proved history", async () => withFixture(async (f) => {
    await expect(sql.begin(async (tx: TransactionSql) => tx`INSERT INTO learning_review(id, workspace_id, content_package_id, actor_user_id, action)
      VALUES (${randomUUID()}, ${f.workspace.workspaceId}, ${f.contentPackage.id}, ${f.user.id}, 'accepted')`)).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE learning_review_proof SET decision_snapshot = '{}'::jsonb WHERE learning_review_id = ${f.approval.learningId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE learning_review SET notes = 'Rewritten history' WHERE id = ${f.approval.learningId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE content_package_approval SET review_fingerprint = review_fingerprint WHERE id = ${f.approval.approvalId}`).rejects.toMatchObject({ code: "23514" });
  }));
  it("matches the pure effective-evidence evaluator across valid and invalid graph variants", async () => withFixture(async (f) => {
    const variants: ContentPackageReviewSnapshotV1[] = [f.captured.snapshot,
      { ...f.captured.snapshot, conflicts: [] },
      { ...f.captured.snapshot, conflicts: f.captured.snapshot.conflicts.map((c) => ({ ...c, status: "open" as const, resolutionEvidenceId: null })) },
      { ...f.captured.snapshot, conflicts: f.captured.snapshot.conflicts.map((c) => ({ ...c, status: "dismissed" as const })) },
      { ...f.captured.snapshot, evidence: f.captured.snapshot.evidence.map((e, i, all) => i < 2 ? { ...e, supersededByEvidenceId: all[1 - i]!.id } : e) },
      { ...f.captured.snapshot, evidence: f.captured.snapshot.evidence.map((e, i) => i === 0 ? { ...e, provenance: "unresolved" as const } : e) },
    ];
    for (const candidate of variants) {
      const pure = evaluateReviewedEvidence(candidate);
      const derived = (await sql<{ ids: string[] | null }[]>`SELECT content_package_review_effective_evidence(${sql.json(candidate as unknown as JSONValue)}) AS ids`)[0]!.ids;
      expect(derived ?? []).toEqual(pure.effectiveEvidenceIds);
    }
  }));
});
