import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignActivationError, CampaignValidationError } from "@market-me/database";
import { AuthenticationError } from "./auth";
const mocks = vi.hoisted(() => ({ user: vi.fn(), activate: vi.fn(), preview: vi.fn(), getOutcome: vi.fn(), closeRequest: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", async () => ({ ...await import("./auth"), requireAuthenticatedUser: mocks.user }));
vi.mock("@/server/database", () => ({ getCampaignActivationRepository: () => mocks }));
vi.mock("@/server/campaign-activation-api", () => import("./campaign-activation-api"));
import { GET, POST } from "../app/api/v1/campaigns/[id]/activate/route";
import { POST as CLOSE } from "../app/api/v1/campaigns/[id]/activate/close/route";
const uuid = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const workspaceId=uuid("1"), campaignId=uuid("2"), actorId=uuid("3"), requestId=uuid("4"), expectedVersionId=uuid("5"), expectedActorIncarnationId=uuid("a");
const input={ workspaceId,campaignId,requestId,expectedVersionId,expectedActorIncarnationId };
const receipt={ ...input,instanceId:uuid("6"),initialStatus:"scheduled",acceptedAt:"2026-10-02T00:00:00.000Z" };
const base="http://127.0.0.1:3132",endpoint=`${base}/api/v1/campaigns/${campaignId}/activate`;
const context=(id=campaignId)=>({params:Promise.resolve({id})});
const post=(body:unknown=input,headers:Record<string,string>={})=>new Request(endpoint,{method:"POST",headers:{origin:base,"content-type":"application/json",...headers},body:typeof body==="string"?body:JSON.stringify(body)});
const get=(query=`workspaceId=${workspaceId}`)=>new Request(`${endpoint}?${query}`);
function privateResponse(r:Response){ expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("vary")).toBe("Cookie");expect(r.headers.get("x-content-type-options")).toBe("nosniff");expect(r.headers.has("set-cookie")).toBe(false); }
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("APP_BASE_URL",base);mocks.user.mockResolvedValue({id:actorId});mocks.activate.mockResolvedValue({receipt,replayed:false});mocks.getOutcome.mockResolvedValue({kind:"accepted",receipt});mocks.closeRequest.mockResolvedValue({kind:"accepted",receipt});mocks.preview.mockResolvedValue({workspaceId,campaignId,versionId:expectedVersionId,canActivate:false});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("durable activation transport",()=>{
  it("normalizes five exact identifiers and supplies only the session actor",async()=>{
    const response=await POST(post({...input,expectedActorIncarnationId:expectedActorIncarnationId.toUpperCase()}),context());
    expect(response.status).toBe(202);privateResponse(response);expect(await response.json()).toEqual({data:receipt,meta:{replayed:false}});expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(input,actorId);
    mocks.activate.mockResolvedValue({receipt,replayed:true});expect((await POST(post(),context())).status).toBe(200);
  });
  it.each([undefined,"null","https://outside.invalid",`${base}/`,`${base}/path`])("rejects origin %s before authentication",async origin=>{
    const request=post();if(origin===undefined)request.headers.delete("origin");else request.headers.set("origin",origin);
    const response=await POST(request,context());expect(response.status).toBe(403);privateResponse(response);expect(mocks.user).not.toHaveBeenCalled();expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("requires configured origin",async()=>{vi.stubEnv("APP_BASE_URL","");expect((await POST(post(),context())).status).toBe(403);});
  it.each([{workspaceId},{workspaceId,expectedVersionId},{...input,actorUserId:actorId},{...input,requestId:undefined},{...input,campaignId:uuid("8")},{...input,expectedVersionId:"bad"},{...input,expectedActorIncarnationId:""}])("rejects old or ambiguous request %# without generating server intent",async body=>{
    expect((await POST(post(body),context())).status).toBe(422);expect(mocks.activate).not.toHaveBeenCalled();expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each(["{",'{"workspaceId":"x","workspaceId":"y"}',JSON.stringify(input).replace('"requestId":','"requestId":"duplicate","requestId":'),JSON.stringify(input).replace('"workspaceId":','"workspaceId":"duplicate","work\\u0073paceId":')])("rejects malformed or duplicate JSON %#",async body=>{
    expect((await POST(post(body),context())).status).toBe(422);expect(mocks.user).not.toHaveBeenCalled();
  });
  it("bounds media type, declared bytes, streamed bytes and invalid UTF-8",async()=>{
    expect((await POST(post(input,{"content-type":"text/plain"}),context())).status).toBe(415);
    expect((await POST(post(input,{"content-length":"2049"}),context())).status).toBe(413);
    expect((await POST(post(" ".repeat(2049)),context())).status).toBe(413);
    const bad=new Request(endpoint,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:new Uint8Array([0xc3,0x28])});
    expect((await POST(bad,context())).status).toBe(422);expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects path and POST query ambiguity",async()=>{
    expect((await POST(post(),context("bad"))).status).toBe(422);
    expect((await POST(new Request(endpoint+"?workspaceId="+workspaceId,post()),context())).status).toBe(422);expect(mocks.user).not.toHaveBeenCalled();
  });
  it("separates preview and creator-private receipt reads without starting work",async()=>{
    const preview=await GET(get(),context());expect(preview.status).toBe(200);privateResponse(preview);expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(workspaceId,campaignId,actorId);
    const original=await GET(get(`workspaceId=${workspaceId}&requestId=${requestId}`),context());expect(await original.json()).toEqual({data:{kind:"accepted",receipt}});privateResponse(original);
    expect(mocks.getOutcome).toHaveBeenCalledExactlyOnceWith(workspaceId,campaignId,requestId,actorId);expect(mocks.activate).not.toHaveBeenCalled();
  });
  it.each(["",`workspaceId=${workspaceId}&workspaceId=${workspaceId}`,`workspaceId=${workspaceId}&requestId=`, `workspaceId=${workspaceId}&requestId=${requestId}&requestId=${requestId}`,`workspaceId=${workspaceId}&actorUserId=${actorId}`])("rejects unsafe GET %s",async query=>{
    const r=await GET(get(query),context());expect(r.status).toBe(422);privateResponse(r);expect(mocks.user).not.toHaveBeenCalled();
  });
  it("does not turn a missing receipt into a new activation",async()=>{mocks.getOutcome.mockResolvedValue(undefined);const r=await GET(get(`workspaceId=${workspaceId}&requestId=${requestId}`),context());expect(r.status).toBe(404);expect(JSON.stringify(await r.json())).toContain("earlier request may still finish");expect(mocks.activate).not.toHaveBeenCalled();});
  it.each([["access_denied",403],["request_conflict",409],["grant_changed",409],["preview_unavailable",503],["not_found",404]] as const)("maps fixed %s without persistence details",async(code,status)=>{
    mocks.activate.mockRejectedValue(new CampaignActivationError(code,"secret SQL token"));const r=await POST(post(),context());expect(r.status).toBe(status);privateResponse(r);expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
  it.each([["execution_paused",409],["control_unavailable",503],["campaign_version_changed",409],["draft_channel_preview_invalid",409]] as const)("preserves %s admission failure without raw issue text",async(code,status)=>{
    mocks.activate.mockRejectedValue(new CampaignValidationError([{code,message:"secret SQL token"}]));const r=await POST(post(),context());expect(r.status).toBe(status);expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
  it("requires authentication and never exposes unexpected persistence exceptions",async()=>{
    mocks.user.mockRejectedValueOnce(new AuthenticationError());expect((await POST(post(),context())).status).toBe(401);expect(mocks.activate).not.toHaveBeenCalled();
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});mocks.activate.mockRejectedValue(new Error("password token SQL"));const r=await POST(post(),context());expect(r.status).toBe(503);privateResponse(r);
    expect(JSON.stringify(await r.json())).not.toContain("password");expect(log).toHaveBeenCalledExactlyOnceWith("Campaign activation unavailable; request and persistence details were not logged.");
  });
  it("recognizes a retained repository validation error across route module reloads",async()=>{
    const retainedError=new CampaignValidationError([{code:"campaign_version_changed",message:"private stale-review detail"}]);
    // A distinct prototype models an older module instance kept by the shared DB bundle.
    Object.setPrototypeOf(retainedError,Error.prototype);expect(retainedError).not.toBeInstanceOf(CampaignValidationError);
    mocks.activate.mockRejectedValue(retainedError);const r=await POST(post(),context());expect(r.status).toBe(409);
    expect(await r.json()).toEqual({error:{code:"campaign_version_changed",message:"The published version changed. Check the original request, then review the current version."}});
  });
  it.each([{issues:[{code:"campaign_version_changed",message:"secret"}]},{[Symbol.for("@market-me/database/CampaignValidationError/v1")]:true,issues:null}])("does not recognize unbranded or malformed validation lookalikes %#",async value=>{
    vi.spyOn(console,"error").mockImplementation(()=>{});mocks.activate.mockRejectedValue(value);expect((await POST(post(),context())).status).toBe(503);
  });
  it("returns accepted or closed original outcomes from explicit closure without calling activation",async()=>{
    const accepted=await CLOSE(post(),context());expect(accepted.status).toBe(200);privateResponse(accepted);expect(await accepted.json()).toEqual({data:{kind:"accepted",receipt}});
    const closed={kind:"closed",receipt:{...input,closedAt:receipt.acceptedAt}};mocks.closeRequest.mockResolvedValue(closed);
    expect(await (await CLOSE(post(),context())).json()).toEqual({data:closed});expect(mocks.closeRequest).toHaveBeenCalledWith(input,actorId);expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("applies the same bounded origin, scope and actor boundary to closing",async()=>{
    const noOrigin=post();noOrigin.headers.delete("origin");expect((await CLOSE(noOrigin,context())).status).toBe(403);
    expect((await CLOSE(post({...input,campaignId:uuid("9")}),context())).status).toBe(422);
    expect((await CLOSE(post({...input,actorUserId:actorId}),context())).status).toBe(422);
    expect((await CLOSE(post(" ".repeat(2049)),context())).status).toBe(413);
    expect(mocks.closeRequest).not.toHaveBeenCalled();expect(mocks.user).not.toHaveBeenCalled();
  });
});
