import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVATION_BROWSER_LIMITS, activationStorageKey, createActivationGate, forgetResolvedActivation, loadActivationAttempt, loadActivationPreview,
  makeActivationAttempt, parseActivationAttempt, parseActivationOutcome, parseActivationPreview, readActivationResponse, retainActivationAttempt, runActivationAttempt,
  type ActivationPreview, type ActivationStorage } from "./campaign-activation-contract";
const uuid=(n:string)=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const scope={userId:uuid("1"),workspaceId:uuid("2"),campaignId:uuid("3")};
const preview:ActivationPreview={workspaceId:scope.workspaceId,campaignId:scope.campaignId,versionId:uuid("4"),versionNumber:2,campaignName:"Reviewed café",autonomyMode:"approval_required",timezone:"UTC",observedAt:"2026-10-02T00:00:00.000Z",steps:[{stepKey:"wait",name:"Wait",operationType:"wait",scheduleType:"immediate",approvalRequired:false}],canActivate:true,actorIncarnationId:uuid("5")};
const original=makeActivationAttempt(scope,preview,uuid("6"));
const receipt={...original.request,instanceId:uuid("7"),initialStatus:"scheduled" as const,acceptedAt:preview.observedAt};
const accepted={kind:"accepted" as const,receipt},closed={kind:"closed" as const,receipt:{...original.request,closedAt:preview.observedAt}};
const response=(data:unknown,status=200)=>Response.json(data,{status});
function storage(){const map=new Map<string,string>();const port:ActivationStorage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);},removeItem:key=>{map.delete(key);}};return{map,port};}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe("activation browser scope and durable recovery",()=>{
  it("freezes exact identifiers without retaining authoritative preview or credentials",()=>{
    expect(original).toEqual({schemaVersion:1,userId:scope.userId,request:{workspaceId:scope.workspaceId,campaignId:scope.campaignId,requestId:uuid("6"),expectedVersionId:preview.versionId,expectedActorIncarnationId:uuid("5")}});
    expect(Object.isFrozen(original)).toBe(true);expect(Object.isFrozen(original.request)).toBe(true);expect(Object.isFrozen(ACTIVATION_BROWSER_LIMITS)).toBe(true);
    expect(parseActivationOutcome(accepted,original,scope)).toEqual(accepted);expect(parseActivationOutcome(closed,original,scope)).toEqual(closed);
  });
  it.each([{workspaceId:uuid("8")},{campaignId:uuid("8")},{steps:[]},{steps:[...preview.steps,...preview.steps]},{versionNumber:0},{actorUserId:scope.userId},{actorIncarnationId:"bad"},{steps:Array.from({length:101},(_,i)=>({...preview.steps[0],stepKey:String(i)}))}])("rejects unsafe review %#",patch=>{expect(()=>parseActivationPreview({...preview,...patch},scope)).toThrow();});
  it("keeps reader review minimized and never makes a new intent from it",()=>{
    const {actorIncarnationId:unused,...view}=preview as Extract<ActivationPreview,{canActivate:true}>;void unused;
    const reader={...view,canActivate:false as const};expect(parseActivationPreview(reader,scope)).toEqual(reader);
    expect(()=>makeActivationAttempt(scope,reader,uuid("6"))).toThrow();expect(()=>parseActivationPreview({...reader,actorIncarnationId:uuid("5")},scope)).toThrow();
  });
  it.each(["workspaceId","campaignId","requestId","expectedVersionId","expectedActorIncarnationId"])("binds accepted and closed outcomes to original %s",key=>{
    for(const result of [accepted,closed])expect(()=>parseActivationOutcome({...result,receipt:{...result.receipt,[key]:uuid("9")}},original,scope)).toThrow();
  });
  it.each([{kind:"closed",receipt},{kind:"accepted",receipt:closed.receipt},{...accepted,secret:"extra"},{...accepted,receipt:{...receipt,initialStatus:"active"}},{...closed,receipt:{...closed.receipt,closedAt:"yesterday"}}])("rejects ambiguous outcome %#",value=>{expect(()=>parseActivationOutcome(value,original,scope)).toThrow();});
  it("retains, restores and only explicitly forgets an exactly resolved scoped attempt",()=>{
    const s=storage();expect(loadActivationAttempt(s.port,scope)).toBeUndefined();expect(retainActivationAttempt(s.port,scope,original)).toEqual(original);
    expect(loadActivationAttempt(s.port,scope)).toEqual(original);expect(s.map.size).toBe(1);
    expect(()=>retainActivationAttempt(s.port,scope,makeActivationAttempt(scope,preview,uuid("9")))).toThrow();
    forgetResolvedActivation(s.port,scope,original,closed);expect(s.map.size).toBe(0);
  });
  it("rejects a foreign or corrupt retained attempt instead of silently replacing it",()=>{
    for(const changed of [{...original,userId:uuid("9")},{...original,schemaVersion:2},{...original,request:{...original.request,workspaceId:uuid("9")}},[],null])expect(()=>parseActivationAttempt(changed,scope)).toThrow();
    const s=storage();s.map.set(activationStorageKey(scope),"{");expect(()=>loadActivationAttempt(s.port,scope)).toThrow();
    s.map.set(activationStorageKey(scope),"x".repeat(4097));expect(()=>loadActivationAttempt(s.port,scope)).toThrow();
  });
  it("fails closed for throwing or no-op browser storage and does not clear a different request",()=>{
    const s=storage();expect(()=>retainActivationAttempt({...s.port,setItem(){throw new Error("quota");}},scope,original)).toThrow();
    expect(()=>retainActivationAttempt({...s.port,setItem(){}},scope,original)).toThrow();retainActivationAttempt(s.port,scope,original);
    expect(()=>forgetResolvedActivation({...s.port,removeItem(){}},scope,original,accepted)).toThrow();
    s.map.set(activationStorageKey(scope),JSON.stringify(makeActivationAttempt(scope,preview,uuid("9"))));expect(()=>forgetResolvedActivation(s.port,scope,original,accepted)).toThrow();expect(s.map.size).toBe(1);
  });
  it("allows copied-tab same-key requests but never retargets a current retained request",()=>{
    const a=storage(),b=storage();retainActivationAttempt(a.port,scope,original);b.map.set(activationStorageKey(scope),a.map.get(activationStorageKey(scope))!);
    expect(loadActivationAttempt(b.port,scope)).toEqual(original);expect(activationStorageKey({...scope,userId:uuid("9")})).not.toBe(activationStorageKey(scope));
    expect(()=>retainActivationAttempt(b.port,scope,makeActivationAttempt(scope,preview,uuid("8")))).toThrow();
  });
});
describe("bounded activation transport and request gate",()=>{
  it("loads a fresh review by GET without client actor hints or caching",async()=>{
    const send=vi.fn().mockResolvedValue(response({data:preview})),signal=new AbortController().signal;
    expect(await loadActivationPreview(scope,signal,send)).toEqual(preview);
    expect(send).toHaveBeenCalledExactlyOnceWith(`/api/v1/campaigns/${scope.campaignId}/activate?workspaceId=${scope.workspaceId}`,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal});
  });
  it.each([false,true])("binds accepted status to replay=%s",async replayed=>{
    const send=vi.fn().mockResolvedValue(response({data:receipt,meta:{replayed}},replayed?200:202)),signal=new AbortController().signal;
    expect(await runActivationAttempt(original,scope,"activate",signal,send)).toEqual(accepted);
    expect(send).toHaveBeenCalledExactlyOnceWith(`/api/v1/campaigns/${scope.campaignId}/activate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(original.request),credentials:"same-origin",cache:"no-store",redirect:"error",signal});
  });
  it.each(["lookup","close"] as const)("returns either original outcome for explicit %s without retrying activation",async action=>{
    for(const value of [accepted,closed]){const send=vi.fn().mockResolvedValue(response({data:value}));expect(await runActivationAttempt(original,scope,action,new AbortController().signal,send)).toEqual(value);
      expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]![0]).toBe(`/api/v1/campaigns/${scope.campaignId}/activate`+(action==="close"?"/close":`?workspaceId=${scope.workspaceId}&requestId=${original.request.requestId}`));
      expect(send.mock.calls[0]![1].method).toBe(action==="lookup"?"GET":"POST");}
  });
  it.each([401,403,404,409,500,503])("treats HTTP %s as uncertain or denied, never resends or displays raw text",async status=>{
    const send=vi.fn().mockResolvedValue(response({error:{message:"secret SQL payload"}},status));await expect(runActivationAttempt(original,scope,"lookup",new AbortController().signal,send)).rejects.not.toThrow("secret");expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([[202,true],[200,false],[201,false]] as const)("rejects mismatched success status %s replay %s",async(status,replayed)=>{
    const send=vi.fn().mockResolvedValue(response({data:receipt,meta:{replayed}},status));await expect(runActivationAttempt(original,scope,"activate",new AbortController().signal,send)).rejects.toThrow();
  });
  it("rejects unexpected successful fields, wrong receipt scope, oversized data, media type and UTF-8",async()=>{
    const send=vi.fn().mockResolvedValue(response({data:{...receipt,requestId:uuid("9")},meta:{replayed:false}},202));await expect(runActivationAttempt(original,scope,"activate",new AbortController().signal,send)).rejects.toThrow();
    for(const value of [new Response("<html>"),new Response(new Uint8Array([0xc3,0x28]),{headers:{"content-type":"application/json"}}),response("x".repeat(65536)),new Response("{}",{headers:{"content-type":"application/json","content-length":"65537"}})])await expect(readActivationResponse(value)).rejects.toThrow();
  });
  it("never fetches for a foreign attempt or an already aborted signal",async()=>{
    const send=vi.fn(),controller=new AbortController();await expect(runActivationAttempt({...original,userId:uuid("9")},scope,"activate",controller.signal,send)).rejects.toThrow();
    controller.abort();await expect(runActivationAttempt(original,scope,"close",controller.signal,send)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
  });
  it("rejects a response that completes after cancellation",async()=>{
    const controller=new AbortController(),send=vi.fn().mockImplementation(()=>{controller.abort();return Promise.resolve(response({data:accepted}));});
    await expect(runActivationAttempt(original,scope,"lookup",controller.signal,send)).rejects.toThrow();expect(send).toHaveBeenCalledTimes(1);
  });
  it("serializes browser operations, times out, and prevents stale finish from clearing a newer operation",()=>{
    vi.useFakeTimers();const gate=createActivationGate(),first=gate.begin()!;expect(gate.begin()).toBeUndefined();vi.advanceTimersByTime(15000);expect(first.current()).toBe(false);first.finish();
    const second=gate.begin()!;first.finish();expect(second.current()).toBe(true);gate.cancel();expect(second.signal.aborted).toBe(true);expect(gate.begin()).toBeDefined();gate.cancel();
  });
});
