import { describe, expect, it, vi } from "vitest";
import { aiPolicySaveUuid, aiPolicySaveValues, normalizeAiPolicySaveRequest, AI_POLICY_SAVE_LIMITS, AiPolicySaveError, isAiPolicySaveError } from "./ai-policy-save-models";
const workspaceId="11111111-1111-4111-8111-111111111111", requestId="22222222-2222-4222-8222-222222222222";
const request = { workspaceId, requestId, expectedRevision:0, mode:"recommended", maximumPrivacyClass:"cloud",
  failoverMode:"ask_before_switching", capBehavior:"require_approval", currency:"USD", alertThresholdPercentages:[50,80,100] };
describe("exact AI policy request contracts", () => {
  it("normalizes closed values into stable immutable canonical order without changing money", () => {
    const input={...request,dailyBudgetMinor:1,campaignBudgetMinor:12345,monthlyBudgetMinor:1_000_000_000}, original=structuredClone(input);
    const parsed=normalizeAiPolicySaveRequest(input), reordered=normalizeAiPolicySaveRequest(Object.fromEntries(Object.entries(input).reverse()));
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(reordered)); expect(input).toEqual(original);
    expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.alertThresholdPercentages)).toBe(true);
    expect(parsed.alertThresholdPercentages).not.toBe(input.alertThresholdPercentages);
    const {requestId:_requestId,expectedRevision:_expectedRevision,...policy}=request;
    expect(aiPolicySaveValues(parsed)).toStrictEqual({...policy,dailyBudgetMinor:1,campaignBudgetMinor:12345,monthlyBudgetMinor:1_000_000_000});
    expect(aiPolicySaveValues(parsed)).not.toHaveProperty("requestId");expect(aiPolicySaveValues(parsed)).not.toHaveProperty("expectedRevision");
  });
  it.each([-1,1.5,NaN,Infinity,2147483648,"0",undefined,null])("rejects invalid loaded revision %s", expectedRevision => {
    expect(()=>normalizeAiPolicySaveRequest({...request,expectedRevision})).toThrow(AiPolicySaveError);
  });
  it.each([0,1,2147483647])("accepts bounded revision %s for subsequent repository comparison", expectedRevision => {
    expect(normalizeAiPolicySaveRequest({...request,expectedRevision}).expectedRevision).toBe(expectedRevision);
  });
  it.each([{mode:"unknown"},{maximumPrivacyClass:"any"},{failoverMode:"unsafe"},{capBehavior:"ignore"},{currency:"usd"},{currency:"USDD"},
    {dailyBudgetMinor:0},{dailyBudgetMinor:0.5},{dailyBudgetMinor:undefined},{monthlyBudgetMinor:1_000_000_001},{campaignBudgetMinor:null},
    {actorUserId:workspaceId},{execute:true},{alertThresholdPercentages:[]},{alertThresholdPercentages:[80,50]},
    {alertThresholdPercentages:[50,50]},{alertThresholdPercentages:[1,2,3,4,5,6]},{alertThresholdPercentages:["50"]},
    {alertThresholdPercentages:[0]},{alertThresholdPercentages:[101]},{alertThresholdPercentages:[50.5]}])("rejects malformed or broadened policy %j", patch => {
    expect(()=>normalizeAiPolicySaveRequest({...request,...patch})).toThrow(AiPolicySaveError);
  });
  it("rejects inherited, hidden, accessor, sparse and subclassed inputs without invoking getters", () => {
    const getter=vi.fn(()=>"recommended");
    const accessor={...request}; Object.defineProperty(accessor,"mode",{get:getter,enumerable:true});
    const hidden={...request}; Object.defineProperty(hidden,"secret",{value:"x"});
    const array=[50]; Object.defineProperty(array,"0",{get:getter,enumerable:true});
    class CustomArray extends Array<number> {}
    for (const input of [Object.create(request),Object.assign(Object.create(null),request),accessor,hidden,
      {...request,[Symbol("extra")]:true},{...request,alertThresholdPercentages:new Array(1)},
      {...request,alertThresholdPercentages:array},{...request,alertThresholdPercentages:new CustomArray(50)}]) {
      expect(()=>normalizeAiPolicySaveRequest(input)).toThrow(AiPolicySaveError);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("normalizes UUID casing and refuses invalid scope identities", () => {
    expect(aiPolicySaveUuid(` ${requestId.toUpperCase()} `)).toBe(requestId);
    for (const bad of ["",null,{},"bad","00000000-0000-0000-0000-000000000000"]) expect(()=>aiPolicySaveUuid(bad)).toThrow();
  });
  it("uses branded errors and explicit bounds", () => {
    expect(isAiPolicySaveError(new AiPolicySaveError("access_denied","denied"))).toBe(true);
    expect(isAiPolicySaveError({name:"AiPolicySaveError",code:"access_denied"})).toBe(false);
    expect(AI_POLICY_SAVE_LIMITS).toEqual({requestBytes:4096,maxRevision:2147483647});
  });
});
