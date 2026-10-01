import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { PreparationPresetRepository } from "./preparation-preset-repository";

const url=process.env.DATABASE_URL;
if(url&&new URL(url).pathname!=="/market_me_ci"&&!new URL(url).pathname.startsWith("/market_me_qa_130_"))throw new Error("Preset integration tests require isolated market_me_ci or market_me_qa_130_* databases.");
let sql:DatabaseClient;
async function fixture(){
  const {user,workspace}=await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({email:`preset-qa-${randomUUID()}@market-me.local`,displayName:"Preset QA"});
  const request={operation:"create" as const,workspaceId:workspace.workspaceId,requestId:randomUUID(),title:"Weekly updates",notes:"Reusable values",configuration:{name:"Weekly announcement"}};
  return {user,workspace,request,presets:new PreparationPresetRepository(sql),cleanup:async()=>{await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;await sql`DELETE FROM app_user WHERE id=${user.id}`;}};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function using(run:(f:Fixture)=>Promise<void>){const f=await fixture();try{await run(f);}finally{await f.cleanup();}}
async function counts(scope:string){return (await sql`SELECT
  (SELECT count(*)::int FROM preparation_preset WHERE workspace_id=${scope}) AS presets,
  (SELECT count(*)::int FROM preparation_preset_version WHERE workspace_id=${scope}) AS versions,
  (SELECT count(*)::int FROM preparation_preset_receipt WHERE workspace_id=${scope}) AS receipts,
  (SELECT count(*)::int FROM audit_event WHERE workspace_id=${scope}) AS audits,
  (SELECT count(*)::int FROM campaign WHERE workspace_id=${scope}) AS campaigns,
  (SELECT count(*)::int FROM content_package WHERE workspace_id=${scope}) AS packages,
  (SELECT count(*)::int FROM source_preparation_command WHERE workspace_id=${scope}) AS commands`)[0];}
function action(f:Fixture,presetId:string,operation:"archive"|"restore",expectedRevision:number){return{operation,workspaceId:f.workspace.workspaceId,requestId:randomUUID(),presetId,expectedRevision};}

describe.skipIf(!url)("versioned preparation preset library",()=>{
  beforeAll(()=>{sql=createDatabaseClient(url!);});afterAll(async()=>{await sql?.end();});
  it("creates one minimized library snapshot and no Campaign/content/execution work",async()=>using(async f=>{
    const before=await counts(f.request.workspaceId),result=await f.presets.mutate(f.request,f.user.id);
    expect(result).toMatchObject({replayed:false,receipt:{operation:"create",revision:1,versionNumber:1,archived:false,title:"Weekly updates"}});
    expect(await counts(f.request.workspaceId)).toEqual({...before,presets:1,versions:1,receipts:1,audits:before.audits+1});
    const saved=await f.presets.get(f.request.workspaceId,result.receipt.presetId,f.user.id);
    expect(saved?.version).toMatchObject({title:"Weekly updates",configuration:{name:"Weekly announcement",templateKey:"general_announcement"},copiedFrom:null});
    const audits=await sql`SELECT data FROM audit_event WHERE workspace_id=${f.request.workspaceId} AND event_type='preparation_preset.create'`;
    expect(audits[0]?.data).toEqual({revision:1,versionNumber:1,archived:false});
    expect(JSON.stringify(result.receipt)).not.toMatch(/canonical|createdBy|configuration|settings/);
  }));
  it("deduplicates six concurrent exact creates and survives later edits",async()=>using(async f=>{
    const results=await Promise.all(Array.from({length:6},()=>f.presets.mutate(f.request,f.user.id)));
    expect(new Set(results.map(r=>r.receipt.presetId)).size).toBe(1);expect(results.filter(r=>!r.replayed)).toHaveLength(1);
    const first=results[0]!.receipt;
    await f.presets.mutate({...f.request,operation:"revise",requestId:randomUUID(),presetId:first.presetId,expectedRevision:1,title:"New version"},f.user.id);
    expect(await f.presets.mutate(f.request,f.user.id)).toEqual({replayed:true,receipt:first});
    expect(await f.presets.getReceipt(f.request.workspaceId,f.request.requestId,f.user.id)).toEqual(first);
    await expect(f.presets.mutate({...f.request,title:"Different"},f.user.id)).rejects.toMatchObject({code:"request_conflict"});
  }));
  it("admits exactly one concurrent version update and preserves the historical snapshot",async()=>using(async f=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id);
    const results=await Promise.allSettled(["A","B"].map(title=>f.presets.mutate({...f.request,operation:"revise",requestId:randomUUID(),presetId:r.presetId,expectedRevision:1,title},f.user.id)));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.find(r=>r.status==="rejected")).toMatchObject({reason:{code:"revision_conflict"}});
    expect((await f.presets.get(r.workspaceId,r.presetId,f.user.id,1))?.version.title).toBe("Weekly updates");
    expect((await f.presets.history(r.workspaceId,r.presetId,f.user.id)).items.map(v=>v.versionNumber)).toEqual([2,1]);
  }));
  it("clones a selected historical version and never changes its source",async()=>using(async f=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id);
    await f.presets.mutate({...f.request,operation:"revise",requestId:randomUUID(),presetId:r.presetId,expectedRevision:1,configuration:{name:"Changed"}},f.user.id);
    const clone={operation:"clone",workspaceId:r.workspaceId,requestId:randomUUID(),presetId:r.presetId,expectedRevision:2,versionNumber:1,title:"Cloned preset"};
    const copied=await f.presets.mutate(clone,f.user.id);
    expect(copied.receipt.presetId).not.toBe(r.presetId);
    expect((await f.presets.get(r.workspaceId,copied.receipt.presetId,f.user.id))?.version).toMatchObject({configuration:{name:"Weekly announcement"},copiedFrom:{presetId:r.presetId,versionNumber:1}});
    await f.presets.mutate(action(f,r.presetId,"archive",2),f.user.id);
    expect(await f.presets.mutate(clone,f.user.id)).toEqual({...copied,replayed:true});
    await expect(f.presets.mutate({...clone,requestId:randomUUID(),expectedRevision:3},f.user.id)).rejects.toMatchObject({code:"archived"});
  }));
  it("archives/restores without destroying versions and replays original results",async()=>using(async f=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id),archive=action(f,r.presetId,"archive",1);
    const archived=await f.presets.mutate(archive,f.user.id);
    expect(archived.receipt).toMatchObject({archived:true,revision:2,versionNumber:1});
    expect((await f.presets.get(r.workspaceId,r.presetId,f.user.id))?.root.archived).toBe(true);
    await f.presets.mutate(action(f,r.presetId,"restore",2),f.user.id);
    expect(await f.presets.mutate(archive,f.user.id)).toEqual({...archived,replayed:true});
    expect((await f.presets.get(r.workspaceId,r.presetId,f.user.id))?.root).toMatchObject({archived:false,revision:3,latestVersionNumber:1});
  }));
  it.each(["owner","admin","editor"])("accepts a current %s writer",async role=>using(async f=>{
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.request.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.presets.mutate(f.request,f.user.id)).replayed).toBe(false);
  }));
  it.each(["viewer","analyst","approver"])("allows %s reads but not writes or writer receipt recovery",async role=>using(async f=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id);
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${r.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.presets.get(r.workspaceId,r.presetId,f.user.id))?.version.title).toBe(r.title);
    await expect(f.presets.mutate(f.request,f.user.id)).rejects.toMatchObject({code:"access_denied"});
    await expect(f.presets.getReceipt(r.workspaceId,r.requestId,f.user.id)).rejects.toMatchObject({code:"access_denied"});
  }));
  it("isolates tenants, actors, and revoked memberships including exact replay",async()=>using(async f=>using(async other=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id);
    expect(await f.presets.get(r.workspaceId,r.presetId,other.user.id)).toBeUndefined();
    expect((await f.presets.list(r.workspaceId,other.user.id)).items).toEqual([]);
    expect((await f.presets.history(r.workspaceId,r.presetId,other.user.id)).items).toEqual([]);
    await expect(f.presets.mutate({...f.request,workspaceId:other.request.workspaceId},f.user.id)).rejects.toMatchObject({code:"access_denied"});
    await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${r.workspaceId},${other.user.id},'editor')`;
    expect(await f.presets.getReceipt(r.workspaceId,r.requestId,other.user.id)).toBeUndefined();
    await expect(f.presets.mutate(f.request,other.user.id)).rejects.toMatchObject({code:"request_conflict"});
    await sql`DELETE FROM workspace_membership WHERE workspace_id=${r.workspaceId} AND user_id=${other.user.id}`;
    await sql`DELETE FROM workspace_membership WHERE workspace_id=${r.workspaceId} AND user_id=${f.user.id}`;
    await expect(f.presets.mutate(f.request,f.user.id)).rejects.toMatchObject({code:"access_denied"});
  })));
  it("requires current published profile references and obeys communication ceilings",async()=>using(async f=>{
    const brand=randomUUID(),versionId=randomUUID();
    await sql`INSERT INTO brand_profile(id,workspace_id,name,status,created_by) VALUES (${brand},${f.request.workspaceId},'Brand','published',${f.user.id})`;
    await sql`INSERT INTO brand_profile_version(id,brand_profile_id,version_number,status,promotional_strength_ceiling,created_by) VALUES (${versionId},${brand},1,'published','light',${f.user.id})`;
    await sql`UPDATE brand_profile SET current_version_id=${versionId} WHERE id=${brand}`;
    const request={...f.request,configuration:{name:"Brand announcement",brandProfileVersionId:versionId,promotionalStrength:"standard"}};
    await expect(f.presets.mutate(request,f.user.id)).rejects.toMatchObject({code:"policy_conflict"});
    const saved=await f.presets.mutate({...request,configuration:{...request.configuration,promotionalStrength:"light"}},f.user.id);
    await sql`UPDATE brand_profile SET status='archived' WHERE id=${brand}`;
    expect((await f.presets.get(saved.receipt.workspaceId,saved.receipt.presetId,f.user.id))?.version.configuration.brandProfileVersionId).toBe(versionId);
    await expect(f.presets.mutate({...request,requestId:randomUUID()},f.user.id)).rejects.toMatchObject({code:"reference_unavailable"});
    expect((await f.presets.mutate({...request,configuration:{...request.configuration,promotionalStrength:"light"}},f.user.id)).replayed).toBe(true);
  }));
  it("refuses missing destinations/audiences and cross-workspace profile references",async()=>using(async f=>{
    for(const configuration of [{destinationId:randomUUID()},{audienceProfileVersionIds:[randomUUID()]},{brandProfileVersionId:randomUUID()}]){
      await expect(f.presets.mutate({...f.request,configuration},f.user.id)).rejects.toMatchObject({code:"reference_unavailable"});
    }
    expect((await counts(f.request.workspaceId)).presets).toBe(0);
  }));
  it("protects immutable snapshots/receipts and individual roots while allowing workspace erasure",async()=>using(async f=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id);
    await expect(sql`UPDATE preparation_preset_version SET title='tampered' WHERE preset_id=${r.presetId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`DELETE FROM preparation_preset_version WHERE preset_id=${r.presetId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`UPDATE preparation_preset_receipt SET title='tampered' WHERE preset_id=${r.presetId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`DELETE FROM preparation_preset_receipt WHERE preset_id=${r.presetId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`DELETE FROM preparation_preset WHERE id=${r.presetId}`).rejects.toMatchObject({code:"23514"});
    await expect(sql`UPDATE preparation_preset SET revision=revision+2,archived=true WHERE id=${r.presetId}`).rejects.toMatchObject({code:"23514"});
    await sql`DELETE FROM organization WHERE id=${f.workspace.organizationId}`;
    expect(await sql`SELECT id FROM preparation_preset WHERE id=${r.presetId}`).toHaveLength(0);
  }));
  it("copies exact settings without writes and rejects stale revisions or archived roots",async()=>using(async f=>{
    const {receipt:r}=await f.presets.mutate(f.request,f.user.id),before=await counts(r.workspaceId);
    const copied=await f.presets.copySettings(r.workspaceId,r.presetId,1,1,f.user.id);
    expect(copied.configuration.name).toBe("Weekly announcement");expect(await counts(r.workspaceId)).toEqual(before);
    await expect(f.presets.copySettings(r.workspaceId,r.presetId,2,1,f.user.id)).rejects.toMatchObject({code:"revision_conflict"});
    await expect(f.presets.copySettings(r.workspaceId,r.presetId,1,3,f.user.id)).rejects.toMatchObject({code:"not_found"});
    await f.presets.mutate(action(f,r.presetId,"archive",1),f.user.id);
    await expect(f.presets.copySettings(r.workspaceId,r.presetId,2,1,f.user.id)).rejects.toMatchObject({code:"archived"});
    await f.presets.mutate(action(f,r.presetId,"restore",2),f.user.id);
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${r.workspaceId} AND user_id=${f.user.id}`;
    await expect(f.presets.copySettings(r.workspaceId,r.presetId,3,1,f.user.id)).rejects.toMatchObject({code:"access_denied"});
  }));
  it("preserves authored Audience order and fails copying after a selected profile is retired",async()=>using(async f=>{
    const versions:string[]=[];
    for(let index=0;index<2;index++){
      const root=randomUUID(),versionId=randomUUID();versions.push(versionId);
      await sql`INSERT INTO audience_profile(id,workspace_id,name,status,created_by) VALUES (${root},${f.request.workspaceId},${`Audience ${index}`},'published',${f.user.id})`;
      await sql`INSERT INTO audience_profile_version(id,audience_profile_id,version_number,status,audience_type,created_by) VALUES (${versionId},${root},1,'published','mixed',${f.user.id})`;
      await sql`UPDATE audience_profile SET current_version_id=${versionId} WHERE id=${root}`;
    }
    const authored=[...versions].sort().reverse();
    const {receipt:r}=await f.presets.mutate({...f.request,configuration:{audienceProfileVersionIds:authored}},f.user.id);
    expect((await f.presets.copySettings(r.workspaceId,r.presetId,1,1,f.user.id)).configuration.audienceProfileVersionIds).toEqual(authored);
    await sql`UPDATE audience_profile SET status='archived' WHERE current_version_id=${authored[0]!}`;
    await expect(f.presets.copySettings(r.workspaceId,r.presetId,1,1,f.user.id)).rejects.toMatchObject({code:"reference_unavailable"});
    expect((await f.presets.get(r.workspaceId,r.presetId,f.user.id))?.version.configuration.audienceProfileVersionIds).toEqual(authored);
  }));
  it("paginates bounded library/history reads without disclosing other workspaces",async()=>using(async f=>{
    for(let index=0;index<51;index++)await f.presets.mutate({...f.request,requestId:randomUUID(),title:`Preset ${index}`},f.user.id);
    const first=await f.presets.list(f.request.workspaceId,f.user.id),second=await f.presets.list(f.request.workspaceId,f.user.id,2);
    expect(first.items).toHaveLength(50);expect(first.more).toBe(true);expect(second.items).toHaveLength(1);expect(second.more).toBe(false);
    expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(51);
    const root=first.items[0]!;
    for(let revision=1;revision<=21;revision++)await f.presets.mutate({...f.request,operation:"revise",requestId:randomUUID(),presetId:root.id,expectedRevision:revision},f.user.id);
    const latest=await f.presets.history(root.workspaceId,root.id,f.user.id);
    expect(latest.items).toHaveLength(20);expect(latest.more).toBe(true);
    const older=await f.presets.history(root.workspaceId,root.id,f.user.id,latest.items.at(-1)!.versionNumber);
    expect(older.items.map(item=>item.versionNumber)).toEqual([2,1]);expect(older.more).toBe(false);
    await expect(f.presets.list(root.workspaceId,f.user.id,0)).rejects.toMatchObject({code:"invalid_input"});
    await expect(f.presets.list(root.workspaceId,f.user.id,2001)).rejects.toMatchObject({code:"invalid_input"});
  }));
});
