import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import type { StoredCampaignFinalization } from "./campaign-finalization-repository";
import { assertFinalizedCampaignPreviewInTransaction, setFinalizedPublicationAdmissionInTransaction } from "./campaign-finalization-proof";
import { makeCampaignFinalizationFixture, type CampaignFinalizationFixture } from "./test-support/campaign-finalization-fixture";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (database !== "market_me_qa_123_finalization" && database !== "market_me_ci") {
    throw new Error("Finalization fence tests require the explicitly isolated QA123 or CI database.");
  }
}
let sql: DatabaseClient;
const network = vi.fn(() => { throw new Error("External network is forbidden in finalization fence tests."); });
type FinalizedFixture = CampaignFinalizationFixture & { finalization: StoredCampaignFinalization };

async function withFinalization(run: (fixture: FinalizedFixture) => Promise<void>) {
  const f = await makeCampaignFinalizationFixture(sql);
  try {
    const { finalization } = await f.finalizations.finalize(f.input, f.key, f.user.id);
    await run({ ...f, finalization });
    expect(network).not.toHaveBeenCalled();
  } finally { await f.cleanup(); }
}

async function replaceReceiptExpectRejected(f: FinalizedFixture, overrides: Record<string, JSONValue>) {
  // Removing/reinserting this owned QA receipt is deliberately rolled back on
  // rejection; no production trigger is disabled and no migration is changed.
  await expect(sql.begin(async (tx) => {
    const original = (await tx<{ raw: string }[]>`SELECT to_jsonb(receipt)::text AS raw FROM campaign_finalization receipt WHERE id=${f.finalization.id}`)[0]!.raw;
    await tx`DELETE FROM campaign_finalization WHERE id=${f.finalization.id}`;
    await tx`INSERT INTO campaign_finalization SELECT * FROM jsonb_populate_record(NULL::campaign_finalization,
      ${original}::text::jsonb || ${tx.json(overrides)})`;
  })).rejects.toMatchObject({ code: "23514" });
  expect((await sql<{ id: string }[]>`SELECT id FROM campaign_finalization WHERE id=${f.finalization.id}`)).toHaveLength(1);
}

async function execution(f: FinalizedFixture) {
  await f.campaigns.publishCampaign(f.workspace.workspaceId, f.receipt.campaignId, { expectedVersionId: f.finalization.finalizedVersionId });
  const instance = (await f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId,
    campaignId: f.receipt.campaignId, actorUserId: f.user.id, expectedVersionId: f.finalization.finalizedVersionId }))!;
  const run = instance.stepRuns[0]!;
  expect(run).toBeDefined();
  return { instanceId: instance.id, runId: run.id, stepId: run.campaignStepId };
}
type Execution = Awaited<ReturnType<typeof execution>>;
function requestSnapshot(f: FinalizedFixture) {
  return { campaignFinalizationId: f.finalization.id, draftChannelPreviewFingerprint: f.finalization.previewFingerprint,
    content: f.preview.renderedContent };
}
async function insertClaim(tx: TransactionSql, f: FinalizedFixture, target: Execution, snapshot = requestSnapshot(f)) {
  const id = randomUUID();
  await tx`INSERT INTO publication_action (id, workspace_id, campaign_instance_id, campaign_step_run_id,
    channel_connection_id, action_type, status, idempotency_key, request_snapshot)
    VALUES (${id},${f.workspace.workspaceId},${target.instanceId},${target.runId},${f.connection.id},
      'publish_content','dispatching',${`fence-qa:${id}`},${tx.json(snapshot)})`;
  return id;
}
async function setMarker(tx: TransactionSql, f: FinalizedFixture, target: Execution) {
  const proof = await assertFinalizedCampaignPreviewInTransaction(tx, { workspaceId: f.workspace.workspaceId,
    campaignId: f.receipt.campaignId, campaignVersionId: f.finalization.finalizedVersionId }, { appBaseUrl: f.appBaseUrl, lockPreview: true });
  expect(proof).toBeDefined();
  await setFinalizedPublicationAdmissionInTransaction(tx, proof!, { campaignInstanceId: target.instanceId, campaignStepRunId: target.runId });
}
async function admittedClaim(f: FinalizedFixture, target: Execution) {
  return sql.begin(async (tx) => { await setMarker(tx, f, target); return insertClaim(tx, f, target); });
}

describe.skipIf(!databaseUrl)("finalization durable content and legacy-worker database fences", () => {
  // A one-connection pool proves LOCAL markers expire on the very same backend.
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!, { max: 1 }); vi.stubGlobal("fetch", network); });
  afterAll(async () => { vi.unstubAllGlobals(); await sql?.end(); });

  it("retains immutable receipts and validates their canonical input and snapshot hashes", async () => withFinalization(async (f) => {
    await expect(sql`UPDATE campaign_finalization SET preview_fingerprint=preview_fingerprint WHERE id=${f.finalization.id}`).rejects.toMatchObject({ code: "23514" });
    await replaceReceiptExpectRejected(f, { configuration_hash: "0".repeat(64) });
    await replaceReceiptExpectRejected(f, { preview_fingerprint: `mm-preview-v1:sha256:${"0".repeat(64)}` });
    await replaceReceiptExpectRejected(f, { canonical_preview_snapshot: "{}" });
    await replaceReceiptExpectRejected(f, { canonical_input: "{}" });
  }));

  it.each(["workspace_id", "preparation_id", "campaign_id", "planning_version_id", "finalized_version_id",
    "content_draft_id", "content_draft_version_id", "draft_channel_preview_id"])("rejects wrong receipt %s lineage without losing the original", async (field) => withFinalization(async (f) => {
    await replaceReceiptExpectRejected(f, { [field]: randomUUID() });
  }));

  it("rejects compiled definitions that weaken approval, inputs, timing, or prepared copy controls", async () => withFinalization(async (f) => {
    for (const changes of [
      { autonomyMode: "fully_autonomous" }, { promotionalStrength: "aggressive" },
      { steps: [{ ...f.finalization.compiledDefinition.steps[0]!, approvalRequired: false }] },
      { steps: [{ ...f.finalization.compiledDefinition.steps[0]!, inputs: {} }] },
    ]) await replaceReceiptExpectRejected(f, { compiled_definition: { ...f.finalization.compiledDefinition, ...changes } as unknown as JSONValue });
  }));

  it("requires the actual approval to belong to the selected draft, not merely its version UUID", async () => withFinalization(async (f) => {
    const otherDraft = f.receipt.preparedDrafts.find((draft) => draft.draftId !== f.input.draftId)!;
    await sql`UPDATE content_draft_approval SET content_draft_id=${otherDraft.draftId} WHERE id=${f.approval.id}`;
    await replaceReceiptExpectRejected(f, {});
  }));

  it("rejects actual attachment rows even when the retained snapshot says assets are empty", async () => withFinalization(async (f) => {
    const assetId = randomUUID();
    await sql`INSERT INTO content_asset(id,content_package_id,role,file_name,mime_type,content_hash,extraction_status)
      VALUES(${assetId},${f.contentPackage.id},'original','qa.png','image/png','qa-image-hash','skipped')`;
    await sql`INSERT INTO draft_channel_preview_asset(draft_channel_preview_id,content_asset_id,sort_order,object_key,content_hash,file_name,mime_type,byte_size,alt_text_status,scan_status,rights_status)
      VALUES(${f.preview.id},${assetId},0,'qa/image','qa-image-hash','qa.png','image/png',1,'decorative','not_configured','unchecked')`;
    await replaceReceiptExpectRejected(f, {});
  }));

  it("denies protected version, step, audience-binding, and replacement-version edits", async () => withFinalization(async (f) => {
    const version = f.finalization.finalizedVersionId;
    await expect(sql`UPDATE campaign_version SET autonomy_mode='fully_autonomous' WHERE id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE campaign_version SET context='{"unreviewed":true}'::jsonb WHERE id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM campaign_version WHERE id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE campaign_step SET inputs=inputs-'draftChannelPreviewFingerprint' WHERE campaign_version_id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE campaign_step SET execution_methods=ARRAY['user_assisted']::text[] WHERE campaign_version_id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM campaign_step WHERE campaign_version_id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO campaign_step (id,campaign_version_id,step_key,name,operation_type,desired_capability)
      VALUES (${randomUUID()},${version},'unreviewed','Unreviewed','wait','workflow.wait')`).rejects.toMatchObject({ code: "23514" });
    expect((await sql`SELECT 1 FROM campaign_version_audience_profile WHERE campaign_version_id=${version}`)).toHaveLength(2);
    await expect(sql`DELETE FROM campaign_version_audience_profile WHERE campaign_version_id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE campaign_version_audience_profile SET sort_order=sort_order+10 WHERE campaign_version_id=${version}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO campaign_version_audience_profile(campaign_version_id,audience_profile_version_id,sort_order)
      VALUES (${version},${f.audienceVersionA.id},10)`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO campaign_version(id,campaign_id,version_number,objective,information_depth,promotional_strength,autonomy_mode,created_by)
      VALUES (${randomUUID()},${f.receipt.campaignId},100,'awareness','contextual','light','fully_autonomous',${f.user.id})`).rejects.toMatchObject({ code: "23514" });
  }));

  it("allows exact publish status changes and keeps both historical version contents protected", async () => withFinalization(async (f) => {
    const published = await f.campaigns.publishCampaign(f.workspace.workspaceId, f.receipt.campaignId, { expectedVersionId: f.finalization.finalizedVersionId });
    expect(published!.currentVersion!.id).toBe(f.finalization.finalizedVersionId);
    expect(published!.draftVersion).toBeUndefined();
    expect((await sql<{ status: string }[]>`SELECT status FROM campaign_version WHERE id=${f.receipt.planningVersionId}`)[0]!.status).toBe("superseded");
    expect((await f.campaigns.publishCampaign(f.workspace.workspaceId, f.receipt.campaignId, { expectedVersionId: f.finalization.finalizedVersionId }))!.currentVersion!.id).toBe(f.finalization.finalizedVersionId);
    await expect(sql`UPDATE campaign_step SET name='Unreviewed' WHERE campaign_version_id=${f.receipt.planningVersionId}`).rejects.toMatchObject({ code: "23514" });
    await expect(f.campaigns.saveCampaignDraft(f.receipt.campaignId, f.finalization.compiledDefinition, f.user.id)).rejects.toMatchObject({ issues: [{ code: "campaign_finalization_protected" }] });
  }));

  it("rejects initial legacy claims and failed retries even with the persisted correct proof tokens", async () => withFinalization(async (f) => {
    const target = await execution(f);
    await expect(sql.begin((tx) => insertClaim(tx, f, target))).rejects.toMatchObject({ code: "23514" });
    const actionId = await admittedClaim(f, target);
    await sql`UPDATE publication_action SET status='failed',completed_at=clock_timestamp() WHERE id=${actionId}`;
    await expect(sql`UPDATE publication_action SET status='dispatching',completed_at=NULL WHERE id=${actionId} AND status='failed'`).rejects.toMatchObject({ code: "23514" });
    expect((await sql<{ status: string }[]>`SELECT status FROM publication_action WHERE id=${actionId}`)[0]!.status).toBe("failed");
    await sql.begin(async (tx) => {
      await setMarker(tx, f, target);
      await tx`UPDATE publication_action SET status='dispatching',completed_at=NULL WHERE id=${actionId} AND status='failed'`;
    });
    expect((await sql<{ status: string }[]>`SELECT status FROM publication_action WHERE id=${actionId}`)[0]!.status).toBe("dispatching");
  }));

  it("checks every non-dispatching transition, not just failed retry", async () => withFinalization(async (f) => {
    const target = await execution(f), actionId = await admittedClaim(f, target);
    for (const state of ["ambiguous", "succeeded"] as const) {
      await sql`UPDATE publication_action SET status=${state},completed_at=clock_timestamp() WHERE id=${actionId}`;
      await expect(sql`UPDATE publication_action SET status='dispatching' WHERE id=${actionId}`).rejects.toMatchObject({ code: "23514" });
    }
  }));

  it("resets LOCAL admission on the same pooled backend after commit and rollback", async () => withFinalization(async (f) => {
    const target = await execution(f);
    const firstPid = await sql.begin(async (tx) => {
      await setMarker(tx, f, target);
      await insertClaim(tx, f, target);
      return (await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    });
    const reset = (await sql<{ pid: number; marker: string | null }[]>`SELECT pg_backend_pid() AS pid,NULLIF(current_setting('market_me.exact_preview_admission',true),'') AS marker`)[0]!;
    expect(reset).toEqual({ pid: firstPid, marker: null });
    await expect(sql.begin((tx) => insertClaim(tx, f, target))).rejects.toMatchObject({ code: "23514" });
    const rollback = new Error("Synthetic rollback after local admission");
    await expect(sql.begin(async (tx) => { await setMarker(tx, f, target); throw rollback; })).rejects.toBe(rollback);
    expect((await sql<{ marker: string | null }[]>`SELECT NULLIF(current_setting('market_me.exact_preview_admission',true),'') AS marker`)[0]!.marker).toBeNull();
    await expect(sql.begin((tx) => insertClaim(tx, f, target))).rejects.toMatchObject({ code: "23514" });
  }));

  it("rejects markers for another instance/run or missing snapshot proof fields", async () => withFinalization(async (f) => {
    const first = await execution(f), second = await execution(f);
    await expect(sql.begin(async (tx) => { await setMarker(tx, f, first); return insertClaim(tx, f, second); })).rejects.toMatchObject({ code: "23514" });
    await expect(sql.begin(async (tx) => { await setMarker(tx, f, { ...second, runId: first.runId }); return insertClaim(tx, f, second); })).rejects.toMatchObject({ code: "23514" });
    await expect(sql.begin(async (tx) => { await setMarker(tx, f, first); return insertClaim(tx, f, first, { ...requestSnapshot(f), campaignFinalizationId: randomUUID() }); })).rejects.toMatchObject({ code: "23514" });
    await expect(sql.begin(async (tx) => { await setMarker(tx, f, first); return insertClaim(tx, f, first, { ...requestSnapshot(f), draftChannelPreviewFingerprint: "" }); })).rejects.toMatchObject({ code: "23514" });
  }));

  it("fences an older pinned version of a now-protected Campaign independently of editable token presence", async () => withFinalization(async (f) => {
    const stepId = (await sql<{ id: string }[]>`SELECT id FROM campaign_step WHERE campaign_version_id=${f.receipt.planningVersionId}`)[0]!.id;
    const instanceId = randomUUID(), runId = randomUUID();
    // Synthetic legacy history: the ordinary activation gate correctly refuses
    // a draft-only planning version, so insert this adversarial QA row directly.
    await sql`INSERT INTO campaign_instance(id,workspace_id,campaign_id,campaign_version_id,status,requested_by)
      VALUES(${instanceId},${f.workspace.workspaceId},${f.receipt.campaignId},${f.receipt.planningVersionId},'active',${f.user.id})`;
    await sql`INSERT INTO campaign_step_run(id,campaign_instance_id,campaign_step_id,idempotency_key)
      VALUES(${runId},${instanceId},${stepId},${`fence-qa-old:${runId}`})`;
    const old = { instanceId, runId, stepId };
    await expect(sql.begin(async (tx) => { await setMarker(tx, f, old); return insertClaim(tx, f, old); })).rejects.toMatchObject({ code: "23514" });
    expect((await sql`SELECT id FROM publication_action WHERE campaign_instance_id=${instanceId}`)).toHaveLength(0);
  }));

  it("allows result recording but requires a fresh verified marker for request-snapshot changes", async () => withFinalization(async (f) => {
    const target = await execution(f), actionId = await admittedClaim(f, target);
    await sql`UPDATE publication_action SET status='succeeded',provider_external_id='qa-provider-result',provider_url='https://example.test/qa-result',
      response_metadata='{"received":true}'::jsonb,completed_at=clock_timestamp() WHERE id=${actionId}`;
    await expect(sql`UPDATE publication_action SET request_snapshot=request_snapshot||'{"unreviewed":true}'::jsonb WHERE id=${actionId}`).rejects.toMatchObject({ code: "23514" });
    await sql.begin(async (tx) => {
      await setMarker(tx, f, target);
      await tx`UPDATE publication_action SET request_snapshot=request_snapshot||'{"dispatchSchedule":{"state":"ready"}}'::jsonb WHERE id=${actionId}`;
    });
    const result = (await sql<{ status: string; providerExternalId: string; metadata: { received: boolean } }[]>`
      SELECT status,provider_external_id,response_metadata AS metadata FROM publication_action WHERE id=${actionId}`)[0]!;
    expect(result).toEqual({ status: "succeeded", providerExternalId: "qa-provider-result", metadata: { received: true } });
  }));

  it("rejects protected-history retargeting into a legacy Campaign even during an outcome write", async () => withFinalization(async (f) => {
    const target = await execution(f), actionId = await admittedClaim(f, target);
    const legacy = await f.campaigns.createCampaign({ workspaceId: f.workspace.workspaceId, name: "Legacy fence comparison", description: "Synthetic legacy plan",
      objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light",
      autonomyMode: "fully_autonomous", timezone: "UTC", context: {}, steps: [{ id: "wait",name: "Wait",operationType: "wait",desiredCapability: "workflow.wait",
        dependsOn: [],inputs: {},outputs: {},executionMethods: ["manual_handoff"],approvalRequired: false }] }, f.user.id);
    await f.campaigns.publishCampaign(f.workspace.workspaceId, legacy.id);
    const legacyInstance = (await f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId,campaignId: legacy.id,actorUserId: f.user.id }))!;
    await expect(sql`UPDATE publication_action SET status='succeeded',campaign_instance_id=${legacyInstance.id},campaign_step_run_id=${legacyInstance.stepRuns[0]!.id}
      WHERE id=${actionId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE publication_action SET status='failed',idempotency_key='changed-qa-key' WHERE id=${actionId}`).rejects.toMatchObject({ code: "23514" });
    const retained = (await sql<{ instanceId: string; status: string }[]>`SELECT campaign_instance_id AS instance_id,status FROM publication_action WHERE id=${actionId}`)[0]!;
    expect(retained).toEqual({ instanceId: target.instanceId, status: "dispatching" });
    // The compatibility fence does not impose finalization proof on legacy rows.
    expect(await sql.begin((tx) => insertClaim(tx, f, { instanceId: legacyInstance.id,runId: legacyInstance.stepRuns[0]!.id,stepId: legacyInstance.stepRuns[0]!.campaignStepId }))).toMatch(/^[0-9a-f-]{36}$/);
  }));
});
