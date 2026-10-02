import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {TransactionSql} from "postgres";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createDatabaseClient,type DatabaseClient} from "./client";
const url=process.env.DATABASE_URL;
if(url&&new URL(url).pathname!=="/market_me_ci")throw new Error("Activation schema tests require isolated market_me_ci.");
let sql:DatabaseClient;
type Fixture={tx:TransactionSql;workspace:string;actor:string;campaign:string;version:string;instance:string;grant:string;requestId:string};
async function migrated(run:(f:Fixture)=>Promise<void>){
  const rollback=new Error("Rollback isolated activation schema");
  await expect(sql.begin(async tx=>{
    const schema=`qa_activation_${randomUUID().replaceAll("-","")}`,f={tx,workspace:randomUUID(),actor:randomUUID(),campaign:randomUUID(),version:randomUUID(),instance:randomUUID(),grant:randomUUID(),requestId:randomUUID()};
    await tx`CREATE SCHEMA ${tx(schema)}`;await tx`SET LOCAL search_path TO ${tx(schema)},public`;
    await tx`CREATE TABLE workspace(id uuid PRIMARY KEY)`;await tx`CREATE TABLE app_user(id uuid PRIMARY KEY)`;
    await tx`CREATE TABLE workspace_membership(workspace_id uuid,user_id uuid,incarnation_id uuid,role text,revoked_at timestamptz)`;
    await tx`CREATE VIEW active_workspace_membership AS SELECT * FROM workspace_membership WHERE revoked_at IS NULL`;
    await tx`CREATE TABLE campaign(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,current_version_id uuid)`;
    await tx`CREATE TABLE campaign_version(id uuid PRIMARY KEY,campaign_id uuid NOT NULL,status text NOT NULL)`;
    await tx`CREATE TABLE campaign_instance(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,campaign_id uuid NOT NULL,campaign_version_id uuid NOT NULL,
      requested_by uuid NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL)`;
    await tx`INSERT INTO workspace VALUES(${f.workspace})`;await tx`INSERT INTO app_user VALUES(${f.actor})`;
    await tx`INSERT INTO workspace_membership(workspace_id,user_id,incarnation_id,role) VALUES(${f.workspace},${f.actor},${f.grant},'editor')`;
    await tx`INSERT INTO campaign VALUES(${f.campaign},${f.workspace},${f.version})`;await tx`INSERT INTO campaign_version VALUES(${f.version},${f.campaign},'published')`;
    await tx`INSERT INTO campaign_instance VALUES(${f.instance},${f.workspace},${f.campaign},${f.version},${f.actor},'scheduled','2026-10-02T12:00:00.123456Z')`;
    for(const name of ["0130_campaign_activation_receipts.sql","0131_campaign_activation_closure.sql"])await tx.unsafe(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
    await run(f);throw rollback;
  })).rejects.toBe(rollback);
}
function request(f:Fixture){return{workspaceId:f.workspace,campaignId:f.campaign,requestId:f.requestId,expectedVersionId:f.version,expectedActorIncarnationId:f.grant};}
function insertReceipt(f:Fixture,canonical:unknown=request(f)){
  return f.tx`INSERT INTO campaign_activation_receipt(workspace_id,request_id,campaign_id,expected_version_id,expected_actor_incarnation_id,created_by,instance_id,initial_status,accepted_at,canonical_request)
    SELECT workspace_id,${f.requestId},campaign_id,campaign_version_id,${f.grant},requested_by,id,status,created_at,${JSON.stringify(canonical)} FROM campaign_instance WHERE id=${f.instance}`;
}
function insertClosure(f:Fixture,canonical:unknown=request(f)){
  return f.tx`INSERT INTO campaign_activation_closure(workspace_id,request_id,campaign_id,expected_version_id,expected_actor_incarnation_id,created_by,canonical_request)
    VALUES(${f.workspace},${f.requestId},${f.campaign},${f.version},${f.grant},${f.actor},${JSON.stringify(canonical)})`;
}
describe.skipIf(!url)("activation and closure schema in rollback-only namespaces",()=>{
  beforeAll(()=>{sql=createDatabaseClient(url!);});afterAll(async()=>{await sql?.end();});
  it("creates no invented history for old instances and retains exact timestamp precision",async()=>migrated(async f=>{
    expect(await f.tx`SELECT * FROM campaign_activation_receipt`).toEqual([]);expect(await f.tx`SELECT * FROM campaign_activation_closure`).toEqual([]);
    await insertReceipt(f);expect(await f.tx`SELECT r.accepted_at=i.created_at AS same,to_char(r.accepted_at AT TIME ZONE 'UTC','US') AS micros
      FROM campaign_activation_receipt r JOIN campaign_instance i ON i.id=r.instance_id`).toEqual([{same:true,micros:"123456"}]);
    await f.tx`UPDATE campaign_instance SET status='active' WHERE id=${f.instance}`;
    expect(await f.tx`SELECT initial_status FROM campaign_activation_receipt`).toEqual([{initialStatus:"scheduled"}]);
  }));
  it.each(["accepted","closed"] as const)("prevents a second contradictory outcome after %s",async first=>migrated(async f=>{
    if(first==="accepted"){await insertReceipt(f);await expect(insertClosure(f)).rejects.toMatchObject({code:"23514"});}
    else{await insertClosure(f);await expect(insertReceipt(f)).rejects.toMatchObject({code:"23514"});}
  }));
  it.each(["workspaceId","campaignId","requestId","expectedVersionId","expectedActorIncarnationId"])("requires typed matching canonical %s",async field=>migrated(async f=>{
    await expect(insertReceipt(f,{...request(f),[field]:null})).rejects.toMatchObject({code:"23514"});
  }));
  it.each([null,[],{},"scalar",true])("rejects nonobject/missing canonical intent %#",async canonical=>migrated(async f=>{
    await expect(insertClosure(f,canonical)).rejects.toMatchObject({code:"23514"});
  }));
  it("rejects unrequested authority-bearing canonical fields",async()=>migrated(async f=>{
    await expect(insertClosure(f,{...request(f),actorUserId:f.actor})).rejects.toMatchObject({code:"23514"});
  }));
  it.each(["grant","role","revoked","workspace","campaign","version","status","current_version"])("requires actual original-run and authority lineage: %s",async kind=>migrated(async f=>{
    if(kind==="grant")await f.tx`UPDATE workspace_membership SET incarnation_id=${randomUUID()}`;
    if(kind==="role")await f.tx`UPDATE workspace_membership SET role='viewer'`;
    if(kind==="revoked")await f.tx`UPDATE workspace_membership SET revoked_at=now()`;
    if(kind==="workspace")await f.tx`UPDATE campaign SET workspace_id=${randomUUID()}`;
    if(kind==="campaign")await f.tx`UPDATE campaign_version SET campaign_id=${randomUUID()}`;
    if(kind==="version")await f.tx`UPDATE campaign_instance SET campaign_version_id=${randomUUID()}`;
    if(kind==="status")await f.tx`UPDATE campaign_instance SET status='active'`;
    if(kind==="current_version")await f.tx`UPDATE campaign SET current_version_id=${randomUUID()}`;
    await expect(insertReceipt(f)).rejects.toMatchObject({code:"23514"});
  }));
  it("allows current-member closure of stale old grant but not of foreign version lineage",async()=>migrated(async f=>{
    await f.tx`UPDATE workspace_membership SET role='viewer',incarnation_id=${randomUUID()}`;
    await insertClosure(f);expect(await f.tx`SELECT request_id FROM campaign_activation_closure`).toEqual([{requestId:f.requestId}]);
  }));
  it("rejects closure outside actual campaign/version lineage",async()=>migrated(async f=>{
    await f.tx`UPDATE campaign_version SET campaign_id=${randomUUID()}`;await expect(insertClosure(f)).rejects.toMatchObject({code:"23514"});
  }));
  it.each(["update","delete"])("retains immutable closure history for direct %s",async kind=>migrated(async f=>{
    await insertClosure(f);await expect(kind==="update"?f.tx`UPDATE campaign_activation_closure SET closed_at=closed_at`:f.tx`DELETE FROM campaign_activation_closure`).rejects.toMatchObject({code:"23514"});
  }));
});
