import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { AuthenticationError,AuthorizationError } from "./auth";
import { PreparationPresetError } from "@market-me/database";
const mocks=vi.hoisted(()=>({access:vi.fn(),mutate:vi.fn(),getReceipt:vi.fn(),copySettings:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("./auth",async importOriginal=>({...await importOriginal<typeof import("./auth")>(),requireWorkspaceAccess:mocks.access}));
vi.mock("./database",()=>({getPreparationPresetRepository:()=>mocks}));
vi.mock("@/server/auth",()=>import("./auth"));
vi.mock("@/server/database",()=>import("./database"));
vi.mock("@/server/source-setup-api",()=>import("./source-setup-api"));
vi.mock("@/server/preparation-preset-api",()=>import("./preparation-preset-api"));
import { GET,POST } from "../app/api/v1/preparation-presets/route";
import { POST as copy } from "../app/api/v1/preparation-presets/[id]/copy-settings/route";
const workspaceId="11111111-1111-4111-8111-111111111111",requestId="22222222-2222-4222-8222-222222222222",presetId="33333333-3333-4333-8333-333333333333",actor="44444444-4444-4444-8444-444444444444";
const base="http://127.0.0.1:3119",body={operation:"create",workspaceId,requestId,title:"Reusable",configuration:{}};
const result={workspaceId,requestId,operation:"create",presetId,versionNumber:1,revision:1,archived:false,title:"Reusable",createdAt:"2026-10-01T00:00:00.000Z"};
const request=(data:unknown=body,headers:Record<string,string>={})=>new Request(`${base}/api/v1/preparation-presets`,{method:"POST",headers:{origin:base,"content-type":"application/json",...headers},body:typeof data==="string"?data:JSON.stringify(data)});
const context={params:Promise.resolve({id:presetId})};
describe("preset mutation, recovery and values-only copying",()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("APP_BASE_URL",base);mocks.access.mockResolvedValue({user:{id:actor},workspace:{workspaceId}});mocks.mutate.mockResolvedValue({receipt:result,replayed:false});mocks.getReceipt.mockResolvedValue(result);mocks.copySettings.mockResolvedValue({workspaceId,presetId,versionNumber:1,configuration:{}});});
  afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
  it("normalizes with the shared compiler and uses the authenticated actor",async()=>{
    const response=await POST(request());expect(response.status).toBe(201);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledWith(workspaceId,"write");expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({configuration:expect.objectContaining({templateKey:"general_announcement",templateVersion:1})}),actor);
    expect(mocks.mutate.mock.calls[0]![0].configuration).not.toHaveProperty("autonomyMode");
    expect(await response.json()).toEqual({data:result,meta:{replayed:false}});
    mocks.mutate.mockResolvedValue({receipt:result,replayed:true});expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined,"https://outside.invalid",`${base}/path`])("rejects invalid Origin %s before data access",async origin=>{
    const req=request();if(origin===undefined)req.headers.delete("origin");else req.headers.set("origin",origin);
    expect((await POST(req)).status).toBe(403);expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([{actorUserId:actor},{enabled:true},{operation:"execute"},{configuration:{steps:[]}}])("rejects unsupported authority %j",async patch=>{
    expect((await POST(request({...body,...patch}))).status).toBe(422);expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("requires JSON, bounds streamed/declared bodies and refuses query scope",async()=>{
    expect((await POST(request(body,{"content-type":"text/plain"}))).status).toBe(415);
    expect((await POST(request(body,{"content-length":"32769"}))).status).toBe(413);
    expect((await POST(request("x".repeat(32769)))).status).toBe(413);
    expect((await POST(request("{"))).status).toBe(422);
    const query=new Request(`${base}/api/v1/preparation-presets?workspaceId=${workspaceId}`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)});
    expect((await POST(query)).status).toBe(422);expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("looks up actor-private requests with exact unambiguous query scope",async()=>{
    const url=`${base}/api/v1/preparation-presets?workspaceId=${workspaceId}&requestId=${requestId}`;
    expect((await GET(new Request(url))).status).toBe(200);expect(mocks.getReceipt).toHaveBeenCalledWith(workspaceId,requestId,actor);
    for(const suffix of ["&operation=create",`&workspaceId=${workspaceId}`,"&actorUserId=x"]){expect((await GET(new Request(url+suffix))).status).toBe(422);}
    mocks.getReceipt.mockResolvedValue(undefined);expect((await GET(new Request(url))).status).toBe(404);
  });
  it("performs explicit scoped copying without invoking any mutation",async()=>{
    const response=await copy(request({workspaceId,expectedRevision:2,versionNumber:1}),context);
    expect(response.status).toBe(200);expect(mocks.copySettings).toHaveBeenCalledWith(workspaceId,presetId,2,1,actor);expect(mocks.mutate).not.toHaveBeenCalled();
    expect((await copy(request({workspaceId,expectedRevision:2,versionNumber:1,actorUserId:actor}),context)).status).toBe(422);
    expect((await copy(request({workspaceId,expectedRevision:0,versionNumber:1}),context)).status).toBe(422);
    expect((await copy(request(),{params:Promise.resolve({id:"bad"})})).status).toBe(422);
  });
  it.each([["invalid_input",422],["not_found",404],["access_denied",403],["request_conflict",409],["revision_conflict",409],["archived",409],["reference_unavailable",409],["policy_conflict",409]] as const)("maps safe %s errors",async(code,status)=>{
    const error=new PreparationPresetError(code,"Safe explanation");Object.setPrototypeOf(error,Error.prototype);mocks.mutate.mockRejectedValue(error);
    const response=await POST(request());expect(response.status).toBe(status);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toEqual({error:{code,message:"Safe explanation"}});
  });
  it("keeps authentication and write authorization independent of preset settings",async()=>{
    mocks.access.mockRejectedValue(new AuthenticationError());expect((await POST(request())).status).toBe(401);
    mocks.access.mockRejectedValue(new AuthorizationError());expect((await POST(request())).status).toBe(403);expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("sanitizes unbranded provider/database errors without exposing or logging private settings",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    mocks.mutate.mockRejectedValue(Object.assign(new Error("private SQL and settings"),{name:"PreparationPresetError",code:"revision_conflict"}));
    const response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain("private SQL");expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  });
});
