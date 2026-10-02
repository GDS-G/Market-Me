import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as database from "./index";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { WorkspaceAnalyticsRepository } from "./workspace-analytics-repository";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_145_"))
  throw new Error("Analytics integration requires isolated market_me_ci or market_me_qa_145_*.");
let sql: DatabaseClient;
async function fixture() {
  const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `analytics-${randomUUID()}@market-me.local`, displayName: "Synthetic analytics QA" });
  return { user, workspace, repository: new WorkspaceAnalyticsRepository(sql), cleanup: async () => {
    await sql`DELETE FROM publication_action WHERE workspace_id=${workspace.workspaceId}`;
    await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`;
  } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function campaign(f: Fixture, name = "Synthetic analytics campaign") {
  const id = randomUUID(), versionId = randomUUID();
  await sql`INSERT INTO campaign(id,workspace_id,name,created_by) VALUES (${id},${f.workspace.workspaceId},${name},${f.user.id})`;
  await sql`INSERT INTO campaign_version(id,campaign_id,version_number,status,objective,information_depth,promotional_strength,autonomy_mode,created_by)
    VALUES (${versionId},${id},1,'published','awareness','contextual','informational','draft_only',${f.user.id})`;
  await sql`UPDATE campaign SET current_version_id=${versionId} WHERE id=${id}`;
  return { id, versionId };
}
async function runRecord(f: Fixture, plan: Awaited<ReturnType<typeof campaign>>, status = "completed") {
  const id = randomUUID(); await sql`INSERT INTO campaign_instance(id,workspace_id,campaign_id,campaign_version_id,status,requested_by)
    VALUES (${id},${f.workspace.workspaceId},${plan.id},${plan.versionId},${status},${f.user.id})`; return id;
}
async function event(f: Fixture, values: { eventType?: string; source?: string; value?: string; currency?: string; campaignId?: string; runId?: string } = {}) {
  const id = randomUUID(); await sql`INSERT INTO measurement_event(id,workspace_id,event_key,event_type,source,campaign_id,campaign_instance_id,value,currency,properties,occurred_at)
    VALUES (${id},${f.workspace.workspaceId},${id},${values.eventType ?? "purchase"},${values.source ?? "synthetic_checkout"},${values.campaignId ?? null},${values.runId ?? null},
      ${values.value ?? null}::numeric,${values.currency ?? null},'{"private_test_person":"do-not-project"}','2026-10-01T12:00:00.123456Z')`; return id;
}
async function publication(f: Fixture, plan: Awaited<ReturnType<typeof campaign>>, runId: string, provider: "mastodon_account" | "mailchimp_email", status = "succeeded") {
  const id = randomUUID(), connectionId = randomUUID(), stepId = randomUUID(), stepRunId = randomUUID();
  const configuration = provider === "mastodon_account" ? { host: "synthetic.invalid", instanceOrigin: "https://synthetic.invalid", accountId: "private-account", username: "synthetic", acct: "synthetic", maxCharacters: 500, charactersReservedPerUrl: 23 } : {};
  const capabilities = provider === "mastodon_account" ? { provider, supportedActions: { publish_content: true }, features: { providerMessageIdentity: true, providerIdempotency: true, attachments: false }, limits: { contentCharacters: 500, charactersReservedPerUrl: 23, attachmentsPerMessage: 0 } } : {};
  await sql`INSERT INTO channel_connection(id,workspace_id,provider,name,encrypted_credentials,configuration,capabilities,created_by)
    VALUES (${connectionId},${f.workspace.workspaceId},${provider},${connectionId},'synthetic-not-a-credential',${sql.json(configuration)},${sql.json(capabilities)},${f.user.id})`;
  await sql`INSERT INTO campaign_step(id,campaign_version_id,step_key,name,operation_type,desired_capability)
    VALUES (${stepId},${plan.versionId},${stepId},'Synthetic reporting fixture','publish_content','publish_content')`;
  await sql`INSERT INTO campaign_step_run(id,campaign_instance_id,campaign_step_id,status,idempotency_key)
    VALUES (${stepRunId},${runId},${stepId},'succeeded',${stepRunId})`;
  await sql`INSERT INTO publication_action(id,workspace_id,campaign_instance_id,campaign_step_run_id,channel_connection_id,action_type,status,idempotency_key,request_snapshot)
    VALUES (${id},${f.workspace.workspaceId},${runId},${stepRunId},${connectionId},'publish_content',${status},${id},'{"private_payload":"do-not-project"}')`;
  return id;
}
async function socialReport(f: Fixture, publicationId: string, total: string, observedAt: string) {
  const id = randomUUID();
  await sql`INSERT INTO mastodon_status_report_snapshot(id,workspace_id,publication_action_id,provider_status_id,provider_account_id,snapshot_hash,
    replies_count,reblogs_count,favourites_count,status_created_at,observed_at,created_by,provider_status_url)
    VALUES (${id},${f.workspace.workspaceId},${publicationId},'private-status','private-account',${id.replaceAll("-", "").repeat(2)},0,0,${total}::bigint,
      '2026-09-29T12:00:00Z',${observedAt},${f.user.id},'https://synthetic.invalid/private-status')`; return id;
}
async function socialTotal(f: Fixture, publicationId: string, runId: string, total: string, observedAt = "2026-10-01T12:00:00Z") {
  const snapshotId = await socialReport(f, publicationId, total, observedAt);
  await sql`INSERT INTO campaign_provider_metric_total(workspace_id,campaign_instance_id,publication_action_id,mastodon_report_snapshot_id,metric_type,metric_total,observed_at)
    VALUES (${f.workspace.workspaceId},${runId},${publicationId},${snapshotId},'mastodon_favourite',${total}::bigint,${observedAt})
    ON CONFLICT (publication_action_id,metric_type) DO UPDATE SET metric_total=EXCLUDED.metric_total,mastodon_report_snapshot_id=EXCLUDED.mastodon_report_snapshot_id,observed_at=EXCLUDED.observed_at`;
  return snapshotId;
}
async function emailTotal(f: Fixture, publicationId: string, runId: string) {
  const id = randomUUID();
  await sql`INSERT INTO mailchimp_campaign_report_snapshot(id,workspace_id,publication_action_id,provider_campaign_id,snapshot_hash,emails_sent,
    opens_total,unique_opens,clicks_total,unique_clicks,unsubscribed,hard_bounces,soft_bounces,abuse_reports,send_time,observed_at,created_by,audience_id)
    VALUES (${id},${f.workspace.workspaceId},${publicationId},'private-campaign',${id.replaceAll("-", "").repeat(2)},10,5,3,4,2,0,0,0,0,
      '2026-09-29T12:00:00Z','2026-10-01T13:00:00Z',${f.user.id},'private-audience')`;
  await sql`INSERT INTO campaign_provider_metric_total(workspace_id,campaign_instance_id,publication_action_id,report_snapshot_id,metric_type,metric_total,observed_at)
    VALUES (${f.workspace.workspaceId},${runId},${publicationId},${id},'email_unique_click',2,'2026-10-01T13:00:00Z')`;
  return id;
}

describe("read-only workspace analytics", () => {
  it("provides a focused workspace analytics repository separate from workflow success evaluation", () => {
    expect((database as Record<string, unknown>).WorkspaceAnalyticsRepository).toBeTypeOf("function");
  });
});

describe.skipIf(!url)("workspace analytics coherent read projection", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it("distinguishes a real empty workspace from absent scope, without writes", async () => using(async f => {
    await sql.begin("read only", async tx => {
      const data = await new WorkspaceAnalyticsRepository(tx as unknown as DatabaseClient).getSnapshot(f.workspace.workspaceId, f.user.id);
      expect(data).toMatchObject({ schemaVersion: 1, workspaceId: f.workspace.workspaceId, campaign: null,
        totals: { campaignRuns: "0", publicationActions: "0", measurementEvents: "0", providerMetricRows: "0" }, runStatuses: [], publicationStatuses: [],
        measurements: { groupCount: "0", hasMore: false, items: [] }, providerMetrics: [], recentRuns: { hasMore: false, items: [] } });
      expect(data?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  }));
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("permits aggregate inspection for current %s members", async role => using(async f => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.workspaceId).toBe(f.workspace.workspaceId);
  }));
  it("rejects revoked membership even when organization ownership survives", async () => using(async f => {
    await sql`DELETE FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toBeUndefined();
  }));
  it("does not reveal another workspace or its Campaigns", async () => using(async f => using(async other => {
    const foreign = await campaign(other); await event(other, { campaignId: foreign.id });
    expect(await f.repository.getSnapshot(other.workspace.workspaceId, f.user.id)).toBeUndefined();
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id, foreign.id)).toBeUndefined();
    expect(await f.repository.getSnapshot(randomUUID(), f.user.id)).toBeUndefined();
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.totals.measurementEvents).toBe("0");
  })));
  it("retains exact decimal sums, negative corrections, null value counts and separate currencies", async () => using(async f => {
    await event(f, { value: "99999999999999.999999", currency: "USD" }); await event(f, { value: "99999999999999.999999", currency: "USD" });
    await event(f, { value: "-0.000001", currency: "USD" }); await event(f, { currency: "USD" });
    await event(f, { value: "12.345678", currency: "EUR" }); await event(f, { value: "-2.500001" }); await event(f);
    const data = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))!;
    expect(data.totals.measurementEvents).toBe("7"); expect(data.measurements.items).toHaveLength(3);
    expect(data.measurements.items.find(x => x.currency === "USD")).toMatchObject({ eventCount: "4", valueCount: "3", valueTotal: "199999999999999.999997" });
    expect(data.measurements.items.find(x => x.currency === "EUR")).toMatchObject({ eventCount: "1", valueCount: "1", valueTotal: "12.345678" });
    expect(data.measurements.items.find(x => x.currency === null)).toMatchObject({ eventCount: "2", valueCount: "1", valueTotal: "-2.500001" });
    expect(JSON.stringify(data)).not.toContain("private_test_person"); expect(JSON.stringify(data)).not.toContain("eventKey");
  }));
  it("does not manufacture zero values for unvalued observations or merge sources", async () => using(async f => {
    await event(f, { eventType: "destination_visit", source: "tracked_link" }); await event(f, { eventType: "destination_visit", source: "synthetic_import" });
    const data = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))!;
    expect(data.measurements.items).toHaveLength(2); for (const item of data.measurements.items) expect(item).toMatchObject({ eventCount: "1", valueCount: "0", valueTotal: null });
    expect(data.providerMetrics).toEqual([]);
  }));
  it("filters explicit or run-derived Campaign attribution without including contradictory links", async () => using(async f => {
    const one = await campaign(f, "One"), two = await campaign(f, "Two"), firstRun = await runRecord(f, one), secondRun = await runRecord(f, two, "failed");
    await event(f, { campaignId: one.id }); await event(f, { runId: firstRun }); await event(f, { campaignId: one.id, runId: firstRun });
    await event(f, { campaignId: one.id, runId: secondRun }); await event(f, { campaignId: two.id }); await event(f);
    const selected = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id, one.id))!;
    expect(selected.campaign).toEqual({ id: one.id, name: "One" }); expect(selected.totals).toMatchObject({ campaignRuns: "1", measurementEvents: "3" });
    expect(selected.recentRuns.items.map(x => x.id)).toEqual([firstRun]); expect(selected.runStatuses).toEqual([{ status: "completed", count: "1" }]);
    const all = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))!; expect(all.totals).toMatchObject({ campaignRuns: "2", measurementEvents: "6" });
  }));
  it("reports complete counts separately from bounded detail groups and recent runs", async () => using(async f => {
    const plan = await campaign(f);
    await sql`INSERT INTO campaign_instance(id,workspace_id,campaign_id,campaign_version_id,status,requested_by)
      SELECT gen_random_uuid(),${f.workspace.workspaceId},${plan.id},${plan.versionId},'completed',${f.user.id} FROM generate_series(1,23)`;
    await sql`INSERT INTO measurement_event(id,workspace_id,event_key,event_type,source,occurred_at)
      SELECT gen_random_uuid(),${f.workspace.workspaceId},gen_random_uuid()::text,'custom','synthetic_'||n::text,now() FROM generate_series(1,205) n`;
    const data = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))!;
    expect(data.totals).toMatchObject({ campaignRuns: "23", measurementEvents: "205" });
    expect(data.recentRuns.hasMore).toBe(true); expect(data.recentRuns.items).toHaveLength(20);
    expect(data.measurements).toMatchObject({ groupCount: "205", hasMore: true }); expect(data.measurements.items).toHaveLength(200);
  }));
  it("sums only current provider totals exactly, preserving provider/source separation and observation ranges", async () => using(async f => {
    const plan = await campaign(f), runId = await runRecord(f, plan);
    const a = await publication(f, plan, runId, "mastodon_account"), b = await publication(f, plan, runId, "mastodon_account"), email = await publication(f, plan, runId, "mailchimp_email");
    await socialTotal(f, a, runId, "9007199254740991", "2026-10-01T11:00:00Z");
    await socialTotal(f, b, runId, "9007199254740991", "2026-10-01T12:00:00Z");
    await emailTotal(f, email, runId); await event(f, { eventType: "outbound_click", source: "synthetic_import", campaignId: plan.id });
    const data = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id, plan.id))!;
    expect(data.totals).toEqual({ campaignRuns: "1", publicationActions: "3", measurementEvents: "1", providerMetricRows: "3" });
    expect(data.providerMetrics).toEqual([
      { provider: "mailchimp_email", metricType: "email_unique_click", metricTotal: "2", publicationCount: "1", firstObservedAt: "2026-10-01T13:00:00+00:00", lastObservedAt: "2026-10-01T13:00:00+00:00" },
      { provider: "mastodon_account", metricType: "mastodon_favourite", metricTotal: "18014398509481982", publicationCount: "2", firstObservedAt: "2026-10-01T11:00:00+00:00", lastObservedAt: "2026-10-01T12:00:00+00:00" },
    ]);
    expect(data.measurements.items).toHaveLength(1);
    expect(data.publicationStatuses).toEqual([{ provider: "mailchimp_email", status: "succeeded", count: "1" }, { provider: "mastodon_account", status: "succeeded", count: "2" }]);
    const encoded = JSON.stringify(data); for (const privateValue of ["private-account", "private-status", "private-campaign", "private_payload", "synthetic-not-a-credential"]) expect(encoded).not.toContain(privateValue);
  }));
  it("replaces corrected provider totals rather than accumulating immutable historical snapshots", async () => using(async f => {
    const plan = await campaign(f), runId = await runRecord(f, plan), id = await publication(f, plan, runId, "mastodon_account");
    await socialTotal(f, id, runId, "12", "2026-10-01T11:00:00Z");
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.providerMetrics[0].metricTotal).toBe("12");
    await socialTotal(f, id, runId, "4", "2026-10-01T12:00:00Z");
    await socialReport(f, id, "300", "2026-10-01T10:00:00Z");
    await sql.begin("read only", async tx => {
      const data = (await new WorkspaceAnalyticsRepository(tx as unknown as DatabaseClient).getSnapshot(f.workspace.workspaceId, f.user.id))!;
      expect(data.providerMetrics[0]).toMatchObject({ metricTotal: "4", publicationCount: "1", lastObservedAt: "2026-10-01T12:00:00+00:00" });
      expect(data.totals.providerMetricRows).toBe("1");
    });
    expect((await sql`SELECT count(*)::text AS count FROM mastodon_status_report_snapshot WHERE publication_action_id=${id}`)[0].count).toBe("3");
    await socialTotal(f, id, runId, "0", "2026-10-01T13:00:00Z");
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.providerMetrics[0].metricTotal).toBe("0");
  }));
  it("keeps failed/ambiguous publication activity distinct from absent measurement reports", async () => using(async f => {
    const plan = await campaign(f), runId = await runRecord(f, plan, "failed");
    await publication(f, plan, runId, "mailchimp_email", "failed"); await publication(f, plan, runId, "mastodon_account", "ambiguous");
    const data = (await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))!;
    expect(data.totals.publicationActions).toBe("2"); expect(data.providerMetrics).toEqual([]); expect(data.measurements.items).toEqual([]);
    expect(data.publicationStatuses.map(p => p.status)).toEqual(["failed", "ambiguous"]);
  }));
  it("excludes cross-workspace snapshot lineage and mismatched provider records", async () => using(async f => using(async other => {
    const plan = await campaign(f), runId = await runRecord(f, plan), id = await publication(f, plan, runId, "mastodon_account");
    const report = await socialTotal(f, id, runId, "6");
    await sql`UPDATE mastodon_status_report_snapshot SET workspace_id=${other.workspace.workspaceId} WHERE id=${report}`;
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.providerMetrics).toEqual([]);
    await sql`UPDATE mastodon_status_report_snapshot SET workspace_id=${f.workspace.workspaceId} WHERE id=${report}`;
    await sql`UPDATE channel_connection SET provider='mailchimp_email' WHERE id=(SELECT channel_connection_id FROM publication_action WHERE id=${id})`;
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.providerMetrics).toEqual([]);
    expect((await other.repository.getSnapshot(other.workspace.workspaceId, other.user.id))?.providerMetrics).toEqual([]);
  })));
});
