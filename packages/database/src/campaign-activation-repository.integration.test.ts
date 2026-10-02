import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { CampaignRepository } from "./campaign-repository";
import { CampaignActivationRepository } from "./campaign-activation-repository";
import type { CampaignActivationRequest } from "./campaign-activation-models";
import { setFixtureExecutionState } from "./test-support/workspace-execution-fixture";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci") throw new Error("Activation recovery integration requires isolated market_me_ci.");
let sql: DatabaseClient;
async function fixture(autonomyMode: "approval_required" | "campaign_approval" = "approval_required") {
  const core = new MarketMeRepository(sql), campaigns = new CampaignRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `activation-${randomUUID()}@market-me.local`, displayName: "Synthetic activation owner" });
  const actors = [user.id];
  const definition = { workspaceId: workspace.workspaceId, name: "Reviewed synthetic wait", description: "", objective: "awareness" as const,
    contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual" as const, promotionalStrength: "light" as const,
    autonomyMode, timezone: "UTC", context: {}, steps: [{ id: "wait", name: "Synthetic wait", operationType: "wait" as const,
      desiredCapability: "workflow.wait", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff" as const], approvalRequired: false }] };
  const campaign = await campaigns.createCampaign(definition, user.id);
  await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
  return { core, campaigns, user, workspace, campaign, definition, actors, repository: new CampaignActivationRepository(sql),
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id IN ${sql(actors)}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>, mode?: "campaign_approval") { const f = await fixture(mode); try { await run(f); } finally { await f.cleanup(); } }
async function member(f: Fixture, role: string) {
  const id = randomUUID(), email = `activation-member-${id}@market-me.local`;
  await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES(${id},${email},${email},'Synthetic collaborator')`;
  f.actors.push(id);
  await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES(${f.workspace.organizationId},${id},'owner')`;
  await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES(${f.workspace.workspaceId},${id},${role})`;
  return id;
}
async function intent(f: Fixture, actor = f.user.id): Promise<CampaignActivationRequest> {
  const preview = await f.repository.preview(f.workspace.workspaceId, f.campaign.id, actor);
  if (!preview?.canActivate) throw new Error("Synthetic fixture needs writer review");
  return { workspaceId: preview.workspaceId, campaignId: preview.campaignId, requestId: randomUUID(),
    expectedVersionId: preview.versionId, expectedActorIncarnationId: preview.actorIncarnationId };
}
async function counts(f: Fixture) {
  return (await sql`SELECT (SELECT count(*)::int FROM campaign_activation_receipt WHERE workspace_id=${f.workspace.workspaceId}) AS receipts,
    (SELECT count(*)::int FROM campaign_instance WHERE workspace_id=${f.workspace.workspaceId}) AS instances,
    (SELECT count(*)::int FROM campaign_step_run r JOIN campaign_instance i ON i.id=r.campaign_instance_id WHERE i.workspace_id=${f.workspace.workspaceId}) AS steps,
    (SELECT count(*)::int FROM campaign_workflow_command WHERE workspace_id=${f.workspace.workspaceId}) AS commands,
    (SELECT count(*)::int FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='campaign.activation_requested') AS audits`)[0];
}
const one = { receipts: 1, instances: 1, steps: 1, commands: 1, audits: 1 };
const zero = { receipts: 0, instances: 0, steps: 0, commands: 0, audits: 0 };
async function closures(f: Fixture) {
  return (await sql`SELECT (SELECT count(*)::int FROM campaign_activation_closure WHERE workspace_id=${f.workspace.workspaceId}) AS closures,
    (SELECT count(*)::int FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='campaign.activation_closed') AS audits`)[0];
}
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function tracked() {
  let identify!: (pid: number) => void; const pid = new Promise<number>(resolve => { identify = resolve; });
  const client = new Proxy(sql, { get(target, property) {
    if (property !== "begin") return Reflect.get(target, property);
    return (run: (tx: TransactionSql) => Promise<unknown>) => sql.begin(async tx => {
      identify((await tx`SELECT pg_backend_pid() AS pid`)[0]!.pid); return run(tx);
    });
  } });
  return { repository: new CampaignActivationRepository(client), async waitForLock() {
    const value = await pid;
    for (let i=0;i<150;i++) { if ((await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${value}`)[0]?.waitEventType === "Lock") return; await delay(20); }
    throw new Error("Expected activation statement did not wait on a database lock");
  } };
}
function heldInsert(kind: "accepted" | "closed", commit: boolean) {
  const ready=latch(),release=latch(),rollback=new Error("Synthetic activation transaction rollback");
  const match=kind==="accepted"?"INSERT INTO campaign_activation_receipt":"INSERT INTO campaign_activation_closure";
  const client=new Proxy(sql,{get(target,property){
    if(property!=="begin")return Reflect.get(target,property);
    return (run:(tx:TransactionSql)=>Promise<unknown>)=>sql.begin(tx=>run(new Proxy(tx,{async apply(target,thisArg,args){
      const result=await Reflect.apply(target,thisArg,args);
      if(Array.isArray(args[0])&&args[0].join("").includes(match)){ready.release();await release.promise;if(!commit)throw rollback;}
      return result;
    }})));
  }});
  return {repository:new CampaignActivationRepository(client),ready,release,rollback};
}

describe.skipIf(!url)("durable activation request boundary", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(["owner", "admin", "editor"])("atomically creates one original run and private receipt for %s", async role => using(async f => {
    const actor = role === "owner" ? f.user.id : await member(f, role), request = await intent(f, actor);
    const result = await f.repository.activate(request, actor);
    expect(result).toEqual({ replayed: false, receipt: { ...request, instanceId: expect.any(String), initialStatus: "scheduled", acceptedAt: expect.any(String) } });
    expect(await counts(f)).toEqual(one);
    expect(await f.repository.getReceipt(request.workspaceId, request.campaignId, request.requestId, actor)).toEqual(result.receipt);
    expect(JSON.stringify(result)).not.toMatch(/canonicalRequest|createdBy|token|email/);
    expect(await sql`SELECT r.accepted_at=i.created_at AS exact_time FROM campaign_activation_receipt r
      JOIN campaign_instance i ON i.id=r.instance_id WHERE r.workspace_id=${request.workspaceId}`).toEqual([{ exactTime: true }]);
    expect(await sql`SELECT data FROM audit_event WHERE workspace_id=${request.workspaceId} AND event_type='campaign.activation_requested'`)
      .toEqual([{ data: { requestId: request.requestId, campaignId: request.campaignId, versionId: request.expectedVersionId,
        instanceId: result.receipt.instanceId, actorIncarnationId: request.expectedActorIncarnationId, initialStatus: "scheduled" } }]);
  }));
  it("retains campaign-level approval without creating approval or provider dispatch", async () => using(async f => {
    const result = await f.repository.activate(await intent(f), f.user.id);
    expect(result.receipt.initialStatus).toBe("awaiting_approval"); expect(await counts(f)).toEqual(one);
    expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toEqual([]);
  }, "campaign_approval"));
  it("serializes six exact concurrent requests into one transaction result", async () => using(async f => {
    const request = await intent(f), results = await Promise.all(Array.from({ length: 6 }, () => f.repository.activate(request, f.user.id)));
    expect(results.filter(r => !r.replayed)).toHaveLength(1); expect(new Set(results.map(r => JSON.stringify(r.receipt))).size).toBe(1);
    expect(await counts(f)).toEqual(one);
  }));
  it("allows a second deliberately different request without conflating its receipt", async () => using(async f => {
    const request = await intent(f), first = await f.repository.activate(request, f.user.id);
    const second = await f.repository.activate({ ...request, requestId: randomUUID() }, f.user.id);
    expect(second.receipt.instanceId).not.toBe(first.receipt.instanceId);
    expect(await counts(f)).toEqual({ receipts: 2, instances: 2, steps: 2, commands: 2, audits: 2 });
  }));
  it.each(["campaignId", "expectedVersionId", "expectedActorIncarnationId"] as const)("rejects conflicting %s without returning another receipt", async field => using(async f => {
    const request = await intent(f); await f.repository.activate(request, f.user.id);
    await expect(f.repository.activate({ ...request, [field]: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    expect(await counts(f)).toEqual(one);
  }));
  it("keeps receipts creator-private and never adopts another writer's request key", async () => using(async f => {
    const request = await intent(f); await f.repository.activate(request, f.user.id); const other = await member(f, "admin");
    expect(await f.repository.getReceipt(request.workspaceId, request.campaignId, request.requestId, other)).toBeUndefined();
    await expect(f.repository.activate(request, other)).rejects.toMatchObject({ code: "request_conflict" });
    expect(await counts(f)).toEqual(one);
  }));
  it.each(["viewer", "analyst", "approver"])("minimizes %s review and denies activation despite organization ownership", async role => using(async f => {
    const actor = await member(f, role), preview = await f.repository.preview(f.workspace.workspaceId, f.campaign.id, actor);
    expect(preview).toMatchObject({ canActivate: false }); expect(preview).not.toHaveProperty("actorIncarnationId");
    await expect(f.repository.activate(await intent(f), actor)).rejects.toMatchObject({ code: "access_denied" }); expect(await counts(f)).toEqual(zero);
  }));
  it("returns historical acceptance while paused, progressed or superseded without revalidation/relaunch", async () => using(async f => {
    const request = await intent(f), original = await f.repository.activate(request, f.user.id);
    await f.campaigns.setInstanceStatus(original.receipt.instanceId, "active");
    await f.campaigns.saveCampaignDraft(f.campaign.id, f.definition, f.user.id);
    await f.campaigns.publishCampaign(f.workspace.workspaceId, f.campaign.id);
    await setFixtureExecutionState(sql, f.workspace.workspaceId, f.user.id, "paused");
    expect(await f.repository.activate(request, f.user.id)).toEqual({ ...original, replayed: true });
    expect(await f.repository.getReceipt(request.workspaceId, request.campaignId, request.requestId, f.user.id)).toEqual(original.receipt);
    await expect(f.repository.activate(await intent(f), f.user.id)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_paused" })] });
    expect(await counts(f)).toEqual(one);
  }));
  it("rejects a fresh stale version or grant without writing any run", async () => using(async f => {
    const request = await intent(f);
    await expect(f.repository.activate({ ...request, expectedVersionId: randomUUID() }, f.user.id)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "campaign_version_changed" })] });
    await expect(f.repository.activate({ ...request, expectedActorIncarnationId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "grant_changed" });
    expect(await counts(f)).toEqual(zero);
  }));
  it("treats absent original lookup as a read without a replacement run", async () => using(async f => {
    expect(await f.repository.getReceipt(f.workspace.workspaceId, f.campaign.id, randomUUID(), f.user.id)).toBeUndefined();
    expect(await counts(f)).toEqual(zero);
  }));
  it("does not expose another tenant's preview, receipt or activation", async () => using(async f => using(async other => {
    const request = await intent(f); await f.repository.activate(request, f.user.id);
    await expect(f.repository.preview(request.workspaceId, request.campaignId, other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.getReceipt(request.workspaceId, request.campaignId, request.requestId, other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.activate(request, other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    expect(await f.repository.preview(other.workspace.workspaceId, request.campaignId, other.user.id)).toBeUndefined();
    expect(await counts(f)).toEqual(one); expect(await counts(other)).toEqual(zero);
  })));
  it("preserves receipt after downgrade while denying new POST and allows read-only recovery", async () => using(async f => {
    const actor = await member(f, "editor"), request = await intent(f, actor), original = await f.repository.activate(request, actor);
    await sql`UPDATE workspace_membership SET role='viewer',role_revision=role_revision+1 WHERE workspace_id=${request.workspaceId} AND user_id=${actor}`;
    expect(await f.repository.getReceipt(request.workspaceId, request.campaignId, request.requestId, actor)).toEqual(original.receipt);
    await expect(f.repository.activate(request, actor)).rejects.toMatchObject({ code: "access_denied" }); expect(await counts(f)).toEqual(one);
  }));
  it("retains history through revocation/rejoin but rejects a stale new intent", async () => using(async f => {
    const actor = await member(f, "editor"), request = await intent(f, actor), original = await f.repository.activate(request, actor);
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp(),role_revision=role_revision+1 WHERE workspace_id=${request.workspaceId} AND user_id=${actor}`;
    await expect(f.repository.getReceipt(request.workspaceId, request.campaignId, request.requestId, actor)).rejects.toMatchObject({ code: "access_denied" });
    await sql`UPDATE workspace_membership SET revoked_at=NULL,incarnation_id=${randomUUID()},role_revision=role_revision+1 WHERE workspace_id=${request.workspaceId} AND user_id=${actor}`;
    expect(await f.repository.activate(request, actor)).toEqual({ ...original, replayed: true });
    await expect(f.repository.activate({ ...request, requestId: randomUUID() }, actor)).rejects.toMatchObject({ code: "grant_changed" });
    expect(await counts(f)).toEqual(one);
  }));
  it("rolls run, steps, outbox, campaign status and receipt back if audit insertion fails", async () => using(async f => {
    const constraint = `qa_activation_audit_${randomUUID().replaceAll("-", "")}`, request = await intent(f);
    const before = await sql`SELECT status,updated_at FROM campaign WHERE id=${f.campaign.id}`;
    await sql.unsafe(`ALTER TABLE audit_event ADD CONSTRAINT ${constraint} CHECK (workspace_id <> '${f.workspace.workspaceId}'::uuid OR event_type <> 'campaign.activation_requested')`);
    try { await expect(f.repository.activate(request, f.user.id)).rejects.toMatchObject({ code: "23514" }); }
    finally { await sql.unsafe(`ALTER TABLE audit_event DROP CONSTRAINT ${constraint}`); }
    expect(await counts(f)).toEqual(zero); expect(await sql`SELECT status,updated_at FROM campaign WHERE id=${f.campaign.id}`).toEqual(before);
  }));
  it.each([true, false])("observes actual revocation lock wait and then %s commit", async commit => using(async f => {
    const actor = await member(f, "editor"), request = await intent(f, actor), ready = latch(), release = latch(), rollback = new Error("Synthetic revocation rollback");
    const holder = sql.begin(async tx => { await tx`UPDATE workspace_membership SET revoked_at=clock_timestamp(),role_revision=role_revision+1 WHERE workspace_id=${request.workspaceId} AND user_id=${actor}`;
      ready.release(); await release.promise; if (!commit) throw rollback; }).catch(error => { if (error !== rollback) throw error; });
    await ready.promise; const run = tracked(), pending = run.repository.activate(request, actor).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try { await run.waitForLock(); } finally { release.release(); await holder; }
    const result = await pending;
    if (commit) { expect(result.error).toMatchObject({ code: "access_denied" }); expect(await counts(f)).toEqual(zero); }
    else { expect(result.value?.replayed).toBe(false); expect(await counts(f)).toEqual(one); }
  }));
  it.each(["receipt_update", "receipt_delete", "instance_identity", "instance_delete"])("rejects direct %s while allowing ordinary progress", async action => using(async f => {
    const original = await f.repository.activate(await intent(f), f.user.id), id = original.receipt.instanceId;
    const operation = action === "receipt_update" ? sql`UPDATE campaign_activation_receipt SET accepted_at=accepted_at WHERE instance_id=${id}`
      : action === "receipt_delete" ? sql`DELETE FROM campaign_activation_receipt WHERE instance_id=${id}`
      : action === "instance_identity" ? sql`UPDATE campaign_instance SET created_at=created_at+interval '1 second' WHERE id=${id}`
      : sql`DELETE FROM campaign_instance WHERE id=${id}`;
    await expect(operation).rejects.toMatchObject({ code: "23514" });
    await f.campaigns.setInstanceStatus(id, "active"); expect(await counts(f)).toEqual(one);
  }));
  it("closes an unaccepted request once and prevents every later exact activation",async()=>using(async f=>{
    const request=await intent(f),result=await f.repository.closeRequest(request,f.user.id);
    expect(result).toEqual({kind:"closed",receipt:{...request,closedAt:expect.any(String)}});
    expect(await f.repository.closeRequest(request,f.user.id)).toEqual(result);
    expect(await f.repository.getOutcome(request.workspaceId,request.campaignId,request.requestId,f.user.id)).toEqual(result);
    await expect(f.repository.activate(request,f.user.id)).rejects.toMatchObject({code:"request_closed"});
    expect(await counts(f)).toEqual(zero);expect(await closures(f)).toEqual({closures:1,audits:1});
    await f.repository.activate({...request,requestId:randomUUID()},f.user.id);expect(await counts(f)).toEqual(one);
  }));
  it("closing an accepted request returns its history without canceling or changing the run",async()=>using(async f=>{
    const request=await intent(f),original=await f.repository.activate(request,f.user.id);
    await f.campaigns.setInstanceStatus(original.receipt.instanceId,"active");
    expect(await f.repository.closeRequest(request,f.user.id)).toEqual({kind:"accepted",receipt:original.receipt});
    expect(await f.repository.getOutcome(request.workspaceId,request.campaignId,request.requestId,f.user.id)).toEqual({kind:"accepted",receipt:original.receipt});
    expect(await closures(f)).toEqual({closures:0,audits:0});expect((await f.campaigns.getCampaignInstance(request.workspaceId,original.receipt.instanceId))?.status).toBe("active");
  }));
  it("permits safe closure after downgrade/rejoin or a workspace hold without enabling execution",async()=>using(async f=>{
    const actor=await member(f,"editor"),request=await intent(f,actor);
    await sql`UPDATE workspace_membership SET role='viewer',role_revision=role_revision+1 WHERE workspace_id=${request.workspaceId} AND user_id=${actor}`;
    await setFixtureExecutionState(sql,request.workspaceId,f.user.id,"paused");
    expect((await f.repository.closeRequest(request,actor)).kind).toBe("closed");
    await expect(f.repository.activate(request,actor)).rejects.toMatchObject({code:"access_denied"});expect(await counts(f)).toEqual(zero);
  }));
  it("keeps closed history private and immutable",async()=>using(async f=>{
    const request=await intent(f),other=await member(f,"admin");await f.repository.closeRequest(request,f.user.id);
    expect(await f.repository.getOutcome(request.workspaceId,request.campaignId,request.requestId,other)).toBeUndefined();
    await expect(f.repository.closeRequest(request,other)).rejects.toMatchObject({code:"request_conflict"});
    await expect(f.repository.activate(request,other)).rejects.toMatchObject({code:"request_conflict"});
    await expect(f.repository.closeRequest({...request,expectedVersionId:randomUUID()},f.user.id)).rejects.toMatchObject({code:"request_conflict"});
    await expect(sql`UPDATE campaign_activation_closure SET closed_at=closed_at WHERE workspace_id=${request.workspaceId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`DELETE FROM campaign_activation_closure WHERE workspace_id=${request.workspaceId}`).rejects.toMatchObject({code:"23514"});
    expect(await closures(f)).toEqual({closures:1,audits:1});
  }));
  it.each([["accepted",true],["accepted",false],["closed",true],["closed",false]] as const)("observes the %s versus competing intent lock, commit=%s",async(kind,commit)=>using(async f=>{
    const request=await intent(f),held=heldInsert(kind,commit),other=tracked();
    const first=(kind==="accepted"?held.repository.activate(request,f.user.id):held.repository.closeRequest(request,f.user.id)).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
    await held.ready.promise;
    const second=(kind==="accepted"?other.repository.closeRequest(request,f.user.id):other.repository.activate(request,f.user.id)).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
    try{await other.waitForLock();}finally{held.release.release();}
    const [a,b]=await Promise.all([first,second]);expect(a.error).toBe(commit?undefined:held.rollback);
    if(kind==="closed"&&commit)expect(b.error).toMatchObject({code:"request_closed"});else expect(b.error).toBeUndefined();
    const accepted=kind==="accepted"?commit:!commit;
    expect(await counts(f)).toEqual(accepted?one:zero);expect(await closures(f)).toEqual(accepted?{closures:0,audits:0}:{closures:1,audits:1});
    expect((await f.repository.getOutcome(request.workspaceId,request.campaignId,request.requestId,f.user.id))?.kind).toBe(accepted?"accepted":"closed");
  }));
  it("rolls closure back on audit failure so the key remains usable",async()=>using(async f=>{
    const constraint=`qa_activation_close_${randomUUID().replaceAll("-","")}`,request=await intent(f);
    await sql.unsafe(`ALTER TABLE audit_event ADD CONSTRAINT ${constraint} CHECK (workspace_id <> '${request.workspaceId}'::uuid OR event_type <> 'campaign.activation_closed')`);
    try{await expect(f.repository.closeRequest(request,f.user.id)).rejects.toMatchObject({code:"23514"});}
    finally{await sql.unsafe(`ALTER TABLE audit_event DROP CONSTRAINT ${constraint}`);}
    expect(await closures(f)).toEqual({closures:0,audits:0});expect(await counts(f)).toEqual(zero);
    await f.repository.activate(request,f.user.id);expect(await counts(f)).toEqual(one);
  }));
});
