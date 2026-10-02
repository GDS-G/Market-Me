import { describe, expect, it, vi } from "vitest";
import { AI_POLICY_BROWSER_LIMITS, makePolicySaveAttempt, parsePolicySaveReceipt, persistPolicySaveAttempt, policySaveLookupPath,
  policySaveRequestFromValues, policySaveStorageKey, readPolicySaveResponse, restorePolicySaveAttempt, runPolicySaveAttempt } from "./ai-policy-save-contract";
import { aiPolicyValues } from "./ai-policy-presentation";
const scope = { userId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222" };
const requestId = "33333333-3333-4333-8333-333333333333";
const policy = { workspaceId: scope.workspaceId, mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching",
  capBehavior: "require_approval", currency: "USD", dailyBudgetMinor: 123, monthlyBudgetMinor: 89012, alertThresholdPercentages: [50,80,100] } as const;
const request = policySaveRequestFromValues(scope, 0, requestId, aiPolicyValues(policy)), attempt = makePolicySaveAttempt(scope, request);
const receipt = { workspaceId: scope.workspaceId, requestId, revision: 1, policy, createdAt: "2026-10-01T00:00:00.000Z" };
function memory() {
  const entries = new Map<string,string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string,value: string) => { entries.set(key,value); }, removeItem: (key: string) => { entries.delete(key); } };
}
const success = () => Response.json({data:receipt,meta:{replayed:false}},{status:201});
describe("AI policy browser request and recovery contract", () => {
  it("round-trips existing hundredths without silently rewriting money or optional caps", () => {
    expect(request).toMatchObject({...policy,requestId,expectedRevision:0});expect(request).not.toHaveProperty("campaignBudgetMinor");
    expect(policySaveRequestFromValues(scope,0,requestId,{...aiPolicyValues(policy),dailyBudget:"0.01",monthlyBudget:"10000000.00"})).toMatchObject({dailyBudgetMinor:1,monthlyBudgetMinor:1_000_000_000});
    expect(AI_POLICY_BROWSER_LIMITS).toEqual({requestBytes:4096,recoveryBytes:8192,responseBytes:8192,timeoutMs:20000});
  });
  it.each(["0", "-1", "1.001", "1e2", "NaN", "Infinity", "10000000.01", "nonsense"])("rejects invalid nonempty cap %s instead of removing the bound", dailyBudget => {
    expect(()=>policySaveRequestFromValues(scope,0,requestId,{...aiPolicyValues(policy),dailyBudget})).toThrow();
  });
  it.each(["", "50,", ",50", "80,50", "50,50", "0", "101", "1.5", "1e2", "1,2,3,4,5,6"])("rejects invalid alert list %s without filtering bad entries", alerts => {
    expect(()=>policySaveRequestFromValues(scope,0,requestId,{...aiPolicyValues(policy),alerts})).toThrow();
  });
  it("scopes recovery to both account and workspace, clones and freezes it", () => {
    const restored = restorePolicySaveAttempt(JSON.stringify(attempt),scope)!;
    expect(restored).toEqual(attempt);expect(Object.isFrozen(restored)).toBe(true);expect(Object.isFrozen(restored.request.alertThresholdPercentages)).toBe(true);
    expect(restored.request.alertThresholdPercentages).not.toBe(attempt.request.alertThresholdPercentages);
    expect(policySaveStorageKey(scope)).not.toBe(policySaveStorageKey({...scope,userId:requestId}));
    expect(policySaveStorageKey(scope)).not.toBe(policySaveStorageKey({...scope,workspaceId:requestId}));
    expect(()=>restorePolicySaveAttempt(JSON.stringify(attempt),{...scope,userId:requestId})).toThrow();
    expect(()=>restorePolicySaveAttempt(JSON.stringify(attempt),{...scope,workspaceId:requestId})).toThrow();
    expect(restorePolicySaveAttempt(null,scope)).toBeUndefined();
  });
  it.each(["{", "x".repeat(8193), JSON.stringify({...attempt,version:2}), JSON.stringify({...attempt,actorUserId:scope.userId}),
    JSON.stringify({...attempt,request:{...request,executionAllowed:true}})])("fails closed for malformed or expanded recovery %s", raw => {
    expect(()=>restorePolicySaveAttempt(raw,scope)).toThrow();
  });
  it("normalizes key order, never overwrites a distinct request and verifies storage readback", () => {
    const storage=memory();persistPolicySaveAttempt(storage,scope,attempt);const prior=storage.getItem(policySaveStorageKey(scope));
    const reordered=makePolicySaveAttempt(scope,Object.fromEntries(Object.entries(request).reverse()) as typeof request);
    persistPolicySaveAttempt(storage,scope,reordered);expect(storage.getItem(policySaveStorageKey(scope))).toBe(prior);
    expect(()=>persistPolicySaveAttempt(storage,scope,makePolicySaveAttempt(scope,{...request,requestId:scope.userId}))).toThrow();
    expect(storage.getItem(policySaveStorageKey(scope))).toBe(prior);
    expect(()=>persistPolicySaveAttempt({getItem:()=>null,setItem:()=>undefined,removeItem:()=>undefined},scope,attempt)).toThrow();
  });
  it("matches the entire original receipt, not just the request identifier", () => {
    expect(parsePolicySaveReceipt(receipt,attempt)).toEqual(receipt);
    for (const bad of [{...receipt,workspaceId:requestId},{...receipt,requestId:scope.userId},{...receipt,revision:2},
      {...receipt,policy:{...policy,mode:"faster"}},{...receipt,policy:{...policy,dailyBudgetMinor:124}},
      {...receipt,policy:{...policy,campaignBudgetMinor:1}},{...receipt,policy:{...policy,alertThresholdPercentages:[50,90,100]}},
      {...receipt,createdAt:"bad"},{...receipt,execution:true}]) expect(()=>parsePolicySaveReceipt(bad,attempt)).toThrow();
  });
  it("persists before network I/O, bounds its lifetime and accepts only a verified original result", async () => {
    const storage=memory(),send=vi.fn(async()=>{expect(storage.getItem(policySaveStorageKey(scope))).toBe(JSON.stringify(attempt));return success();});
    expect(await runPolicySaveAttempt(storage,scope,attempt,false,send)).toEqual(receipt);
    expect(send).toHaveBeenCalledWith("/api/v1/ai-policy/saves",expect.objectContaining({method:"POST",cache:"no-store",body:JSON.stringify(request),signal:expect.any(AbortSignal)}));
    expect(storage.entries.size).toBe(1);
  });
  it("looks up without a mutation and retries identical bytes after an unknown outcome", async () => {
    const storage=memory(),send=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Synthetic lost response"))
      .mockResolvedValueOnce(Response.json({data:receipt})).mockResolvedValueOnce(Response.json({data:receipt,meta:{replayed:true}}));
    await expect(runPolicySaveAttempt(storage,scope,attempt,false,send)).rejects.toThrow("Synthetic lost response");
    expect(await runPolicySaveAttempt(storage,scope,attempt,true,send)).toEqual(receipt);
    expect(send.mock.calls[1]).toEqual([policySaveLookupPath(attempt),expect.objectContaining({method:"GET",cache:"no-store"})]);
    expect(send.mock.calls[1]![1]).not.toHaveProperty("body");
    expect(await runPolicySaveAttempt(storage,scope,attempt,false,send)).toEqual(receipt);
    expect(send.mock.calls[0]![1]!.body).toBe(send.mock.calls[2]![1]!.body);expect(storage.entries.size).toBe(1);
  });
  it.each(["storage_throw", "storage_discard", "different_request", "corrupt_recovery"])("does not send when recovery fails: %s", async kind => {
    const storage=memory(),send=vi.fn();
    if(kind==="storage_throw") storage.setItem=()=>{throw new Error("Synthetic denied storage");};
    if(kind==="storage_discard") storage.setItem=()=>undefined;
    if(kind==="different_request") storage.setItem(policySaveStorageKey(scope),JSON.stringify({...attempt,request:{...request,requestId:scope.userId}}));
    if(kind==="corrupt_recovery") storage.setItem(policySaveStorageKey(scope),"{");
    await expect(runPolicySaveAttempt(storage,scope,attempt,false,send)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
  });
  it.each(["wrong_type", "invalid_json", "invalid_utf8", "advertised_oversize", "streamed_oversize", "empty"])("rejects unbounded or malformed transport: %s", async kind => {
    let response:Response;
    if(kind==="wrong_type") response=new Response("{}");
    else if(kind==="invalid_json") response=new Response("{",{headers:{"content-type":"application/json"}});
    else if(kind==="invalid_utf8") response=new Response(new Uint8Array([0xc3,0x28]),{headers:{"content-type":"application/json"}});
    else if(kind==="advertised_oversize") response=new Response("{}",{headers:{"content-type":"application/json","content-length":"8193"}});
    else if(kind==="streamed_oversize") response=new Response("x".repeat(8193),{headers:{"content-type":"application/json"}});
    else response=new Response(null,{headers:{"content-type":"application/json"}});
    await expect(readPolicySaveResponse(response)).rejects.toThrow();
  });
  it.each(["missing_meta", "wrong_status", "wrong_replay", "wrong_receipt", "extra_output", "invalid_json"])("never confirms an invalid successful response: %s", async kind => {
    const storage=memory();let response:Response;
    if(kind==="missing_meta") response=Response.json({data:receipt});
    else if(kind==="wrong_status") response=Response.json({data:receipt,meta:{replayed:false}},{status:202});
    else if(kind==="wrong_replay") response=Response.json({data:receipt,meta:{replayed:false}});
    else if(kind==="wrong_receipt") response=Response.json({data:{...receipt,revision:2},meta:{replayed:false}},{status:201});
    else if(kind==="extra_output") response=Response.json({data:receipt,meta:{replayed:false},execution:true},{status:201});
    else response=new Response("not-json",{headers:{"content-type":"application/json"}});
    await expect(runPolicySaveAttempt(storage,scope,attempt,false,vi.fn().mockResolvedValue(response))).rejects.toThrow();expect(storage.entries.size).toBe(1);
  });
  it("retains not-found, revision-conflict and access-denied attempts without exposing arbitrary server text", async () => {
    for(const [code,status] of [["not_found",404],["revision_conflict",409],["access_denied",403],["toString",500]] as const) {
      const storage=memory(),send=vi.fn().mockResolvedValue(Response.json({error:{code,message:"private SQL"}},{status}));
      await expect(runPolicySaveAttempt(storage,scope,attempt,true,send)).rejects.not.toThrow("private SQL");
      expect(storage.entries.size).toBe(1);expect(send).toHaveBeenCalledOnce();
    }
  });
});
