import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import type { AiPolicySaveRequest } from "./ai-policy-save-models";
const databaseUrl=process.env.DATABASE_URL;
if (databaseUrl) {
  const name=decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (name!=="market_me_ci" && !name.startsWith("market_me_qa_141_")) throw new Error("Policy recovery tests require disposable CI or 141 QA.");
}
let sql: DatabaseClient;
type Fixture={ai:AiRepository; owner:string; editor:string; viewer:string; workspaceId:string; request:AiPolicySaveRequest};
async function fixture(work:(f:Fixture)=>Promise<void>) {
  const {user,workspace}=await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({email:`policy-recovery-${randomUUID()}@market-me.local`,displayName:"Synthetic Policy Owner"});
  const editor=randomUUID(),viewer=randomUUID(),workspaceId=workspace.workspaceId;
  try {
    for(const [id,role] of [[editor,"editor"],[viewer,"viewer"]]) {
      const email=`policy-recovery-${id}@market-me.local`;
      await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES(${id},${email},${email},'Synthetic Policy Collaborator')`;
      await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES(${workspaceId},${id},${role})`;
    }
    await work({ai:new AiRepository(sql),owner:user.id,editor,viewer,workspaceId,request:{workspaceId,requestId:randomUUID(),expectedRevision:0,
      mode:"recommended",maximumPrivacyClass:"cloud",failoverMode:"ask_before_switching",capBehavior:"require_approval",currency:"USD",
      dailyBudgetMinor:123,campaignBudgetMinor:4567,monthlyBudgetMinor:89012,alertThresholdPercentages:[50,80,100]}});
  } finally {
    await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id IN (${user.id},${editor},${viewer})`;
  }
}
const auditCount=async(workspaceId:string)=>(await sql`SELECT count(*)::int AS count FROM audit_event WHERE workspace_id=${workspaceId} AND event_type='ai.policy_saved'`)[0]!.count;
async function waitForLock(pid:number) {
  const deadline=Date.now()+5_000;
  while(Date.now()<deadline) {
    if((await sql`SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`).length) return;
    await delay(10);
  }
  throw new Error("Synthetic contender did not reach the expected database lock");
}
describe.skipIf(!databaseUrl)("exact policy save transaction and recovery",()=>{
  beforeAll(()=>{sql=createDatabaseClient(databaseUrl!);}); afterAll(async()=>{await sql?.end();});
  it("returns an immutable original receipt and never reapplies it after a newer legacy save",()=>fixture(async f=>{
    const first=await f.ai.savePolicyExactly(f.request,f.editor); expect(first.replayed).toBe(false); expect(first.receipt.revision).toBe(1);
    expect(first.receipt.policy).toMatchObject({dailyBudgetMinor:123,campaignBudgetMinor:4567,monthlyBudgetMinor:89012,currency:"USD"});
    const changed=await f.ai.savePolicy({...first.receipt.policy,mode:"faster"},f.owner);
    expect(changed.mode).toBe("faster"); const latest=await f.ai.getPolicy(f.workspaceId); expect(latest!.revision).toBe(2);
    expect(await f.ai.savePolicyExactly(f.request,f.editor)).toEqual({...first,replayed:true});
    expect(await f.ai.getPolicySaveReceipt(f.workspaceId,f.request.requestId,f.editor)).toEqual(first.receipt);
    expect(await f.ai.getPolicy(f.workspaceId)).toEqual(latest); expect(await auditCount(f.workspaceId)).toBe(2);
  }));
  it("deduplicates two identical simultaneous first requests with one audit",()=>fixture(async f=>{
    const both=await Promise.all([f.ai.savePolicyExactly(f.request,f.editor),f.ai.savePolicyExactly(f.request,f.editor)]);
    expect(both.map(x=>x.replayed).sort()).toEqual([false,true]); expect(both[0]!.receipt).toEqual(both[1]!.receipt);
    expect(await auditCount(f.workspaceId)).toBe(1); expect((await f.ai.getPolicy(f.workspaceId))!.revision).toBe(1);
  }));
  it("allows only one competing first save, including the absent-row upsert race",()=>fixture(async f=>{
    const both=await Promise.allSettled([f.ai.savePolicyExactly(f.request,f.editor),
      f.ai.savePolicyExactly({...f.request,requestId:randomUUID(),mode:"lower_cost"},f.owner)]);
    expect(both.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(both.find(x=>x.status==="rejected")).toMatchObject({reason:{code:"revision_conflict"}});
    expect(await auditCount(f.workspaceId)).toBe(1); expect((await f.ai.getPolicy(f.workspaceId))!.revision).toBe(1);
  }));
  it("allows only one competing update of the same saved revision",()=>fixture(async f=>{
    await f.ai.savePolicyExactly(f.request,f.editor);
    const both=await Promise.allSettled(["lower_cost","faster"].map(mode=>f.ai.savePolicyExactly({...f.request,requestId:randomUUID(),expectedRevision:1,mode},f.owner)));
    expect(both.filter(x=>x.status==="fulfilled")).toHaveLength(1); expect(both.find(x=>x.status==="rejected")).toMatchObject({reason:{code:"revision_conflict"}});
    expect(await auditCount(f.workspaceId)).toBe(2); expect((await f.ai.getPolicy(f.workspaceId))!.revision).toBe(2);
  }));
  it.each(["commit","rollback"] as const)("handles a proven uncommitted first-insert race when the other writer will %s",outcome=>fixture(async f=>{
    const contender=createDatabaseClient(databaseUrl!,{max:1});let release!:()=>void,inserted!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{inserted=resolve;});
    const blocker=sql.begin(async tx=>{
      await tx`INSERT INTO workspace_ai_policy(workspace_id,mode,maximum_privacy_class,failover_mode,cap_behavior,currency,
        daily_budget_minor,campaign_budget_minor,monthly_budget_minor,alert_threshold_percentages,created_by,updated_by)
        VALUES(${f.workspaceId},'faster','cloud','ask_before_switching','require_approval','USD',123,4567,89012,'[50,80,100]'::jsonb,${f.owner},${f.owner})`;
      inserted();await held;if(outcome==="rollback") throw new Error("Synthetic first writer rollback");
    }).then(()=>"committed",()=>"rolled_back");
    let attempt:ReturnType<AiRepository["savePolicyExactly"]>|undefined;
    try {
      await ready;const [{pid}]=await contender<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
      attempt=new AiRepository(contender).savePolicyExactly(f.request,f.editor);
      // Attach the rejection handler immediately; the winner is released only after lock evidence.
      const result=attempt.then(value=>({value}),error=>({error}));
      await waitForLock(pid!);release();expect(await blocker).toBe(outcome==="commit"?"committed":"rolled_back");
      const settled=await result;
      if(outcome==="commit") {
        expect(settled).toMatchObject({error:{code:"revision_conflict"}});
        expect(await f.ai.getPolicy(f.workspaceId)).toMatchObject({revision:1,mode:"faster"});
        expect(await auditCount(f.workspaceId)).toBe(0);
        expect(await f.ai.getPolicySaveReceipt(f.workspaceId,f.request.requestId,f.editor)).toBeUndefined();
      } else {
        expect(settled).toMatchObject({value:{replayed:false,receipt:{revision:1,policy:{mode:"recommended"}}}});
        expect(await auditCount(f.workspaceId)).toBe(1);
      }
    }finally{release();await blocker;await attempt?.catch(()=>undefined);await contender.end();}
  }),15_000);
  it("holds current writer authority through commit while a concurrent demotion waits",()=>fixture(async f=>{
    const saver=createDatabaseClient(databaseUrl!,{max:1}),demoter=createDatabaseClient(databaseUrl!,{max:1});
    let release!:()=>void,locked!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{locked=resolve;});
    const blocker=sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-policy-save:${f.workspaceId}:${f.request.requestId}`},0))`;locked();await hold;});
    let save:ReturnType<AiRepository["savePolicyExactly"]>|undefined,demotion:Promise<unknown>|undefined;
    try {
      await ready;const [{pid:savePid}]=await saver<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
      const [{pid:demotePid}]=await demoter<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
      save=new AiRepository(saver).savePolicyExactly(f.request,f.editor);void save.catch(()=>undefined);
      await waitForLock(savePid!); // The save already holds its membership share lock.
      demotion=demoter`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspaceId} AND user_id=${f.editor}`.then(rows=>rows);
      void demotion.catch(()=>undefined);await waitForLock(demotePid!);
      release();await blocker;expect(await save).toMatchObject({replayed:false,receipt:{revision:1}});await demotion;
      await expect(f.ai.savePolicyExactly(f.request,f.editor)).rejects.toMatchObject({code:"access_denied"});
      expect(await auditCount(f.workspaceId)).toBe(1);
    }finally{release();await blocker;await save?.catch(()=>undefined);await demotion?.catch(()=>undefined);await saver.end();await demoter.end();}
  }),15_000);
  it("binds a request key to actor, exact fields and expected revision",()=>fixture(async f=>{
    await f.ai.savePolicyExactly(f.request,f.editor);
    for(const request of [{...f.request,expectedRevision:1},{...f.request,mode:"faster"},{...f.request,dailyBudgetMinor:124}]) {
      await expect(f.ai.savePolicyExactly(request,f.editor)).rejects.toMatchObject({code:"request_conflict"});
    }
    await expect(f.ai.savePolicyExactly(f.request,f.owner)).rejects.toMatchObject({code:"request_conflict"});
    expect(await f.ai.getPolicySaveReceipt(f.workspaceId,f.request.requestId,f.owner)).toBeUndefined();
    expect(await auditCount(f.workspaceId)).toBe(1);
  }));
  it("rechecks current authority before both replay and lookup",()=>fixture(async f=>{
    await f.ai.savePolicyExactly(f.request,f.editor);
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspaceId} AND user_id=${f.editor}`;
    await expect(f.ai.savePolicyExactly(f.request,f.editor)).rejects.toMatchObject({code:"access_denied"});
    await expect(f.ai.getPolicySaveReceipt(f.workspaceId,f.request.requestId,f.editor)).rejects.toMatchObject({code:"access_denied"});
    expect(await auditCount(f.workspaceId)).toBe(1);
  }));
  it("denies reader, foreign actor and foreign workspace requests without policy writes",()=>fixture(async f=>{
    for(const actor of [f.viewer,randomUUID()]) await expect(f.ai.savePolicyExactly(f.request,actor)).rejects.toMatchObject({code:"access_denied"});
    await expect(f.ai.savePolicyExactly({...f.request,workspaceId:randomUUID()},f.owner)).rejects.toMatchObject({code:"access_denied"});
    expect(await f.ai.getPolicy(f.workspaceId)).toBeUndefined(); expect(await auditCount(f.workspaceId)).toBe(0);
  }));
  it("does not turn a missing recovery receipt into a policy write",()=>fixture(async f=>{
    expect(await f.ai.getPolicySaveReceipt(f.workspaceId,f.request.requestId,f.editor)).toBeUndefined();
    expect(await f.ai.getPolicy(f.workspaceId)).toBeUndefined(); expect(await auditCount(f.workspaceId)).toBe(0);
  }));
  it("rejects stale, fabricated and exhausted revisions without receipts or audits",()=>fixture(async f=>{
    for(const expectedRevision of [1,2147483647]) await expect(f.ai.savePolicyExactly({...f.request,expectedRevision},f.owner)).rejects.toMatchObject({code:"revision_conflict"});
    await f.ai.savePolicyExactly(f.request,f.owner);
    await expect(f.ai.savePolicyExactly({...f.request,requestId:randomUUID()},f.owner)).rejects.toMatchObject({code:"revision_conflict"});
    expect(await auditCount(f.workspaceId)).toBe(1);
    expect((await sql`SELECT request_id FROM workspace_ai_policy_save_receipt WHERE workspace_id=${f.workspaceId}`)).toHaveLength(1);
  }));
  it("advances revisions for trusted same-value and changed-value SQL writes and prevents resetting history",()=>fixture(async f=>{
    await f.ai.savePolicyExactly(f.request,f.owner);
    await sql`UPDATE workspace_ai_policy SET mode=mode WHERE workspace_id=${f.workspaceId}`;
    expect((await f.ai.getPolicy(f.workspaceId))!.revision).toBe(2);
    await sql`UPDATE workspace_ai_policy SET monthly_budget_minor=89013 WHERE workspace_id=${f.workspaceId}`;
    expect(await f.ai.getPolicy(f.workspaceId)).toMatchObject({revision:3,monthlyBudgetMinor:89013,dailyBudgetMinor:123,campaignBudgetMinor:4567});
    await expect(sql`UPDATE workspace_ai_policy SET revision=1 WHERE workspace_id=${f.workspaceId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`DELETE FROM workspace_ai_policy WHERE workspace_id=${f.workspaceId}`).rejects.toMatchObject({code:"23514"});
    await expect(f.ai.savePolicyExactly({...f.request,requestId:randomUUID(),expectedRevision:1},f.owner)).rejects.toMatchObject({code:"revision_conflict"});
  }));
  it("protects receipt content and retention at the database boundary",()=>fixture(async f=>{
    const first=await f.ai.savePolicyExactly(f.request,f.editor);
    await expect(sql`UPDATE workspace_ai_policy_save_receipt SET policy_snapshot='{}'::jsonb WHERE workspace_id=${f.workspaceId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`DELETE FROM workspace_ai_policy_save_receipt WHERE workspace_id=${f.workspaceId}`).rejects.toMatchObject({code:"23514"});
    const forged={...f.request,requestId:randomUUID(),monthlyBudgetMinor:99999};
    await expect(sql`INSERT INTO workspace_ai_policy_save_receipt(workspace_id,request_id,created_by,revision,policy_snapshot,canonical_request)
      VALUES(${f.workspaceId},${forged.requestId},${f.editor},1,${sql.json({...first.receipt.policy,monthlyBudgetMinor:99999})},${JSON.stringify(forged)})`).rejects.toMatchObject({code:"23514"});
    expect(await f.ai.getPolicySaveReceipt(f.workspaceId,f.request.requestId,f.editor)).toEqual(first.receipt);
  }));
  it("returns each legacy writer's actual committed policy rather than a post-commit reread",()=>fixture(async f=>{
    const policy={...f.request}; const both=await Promise.all([f.ai.savePolicy({...policy,mode:"lower_cost"},f.owner),f.ai.savePolicy({...policy,mode:"faster"},f.editor)]);
    expect(both.map(x=>x.mode)).toEqual(["lower_cost","faster"]); expect(await auditCount(f.workspaceId)).toBe(2);
    expect((await f.ai.getPolicy(f.workspaceId))!.revision).toBe(2);
  }));
});
