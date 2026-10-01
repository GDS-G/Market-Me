import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it } from "vitest";
import { makePresetAttempt,restorePresetAttempt,parsePresetReceipt,presetDetailPath,presetVersionSchema,readPresetResponse,
  presetStorageKey,type PresetRequest } from "./preparation-preset-contract";
import { PresetSettingsFields,defaultPresetSettings } from "./preparation-preset-form";
const scope={workspaceId:"11111111-1111-4111-8111-111111111111",userId:"22222222-2222-4222-8222-222222222222"};
const requestId="33333333-3333-4333-8333-333333333333",presetId="44444444-4444-4444-8444-444444444444";
const request:PresetRequest={operation:"create",workspaceId:scope.workspaceId,requestId,title:"Weekly",notes:"Review",configuration:defaultPresetSettings};
describe("preset browser recovery contracts and settings rendering",()=>{
  it("round-trips exact user/workspace-scoped requests without adding execution authority",()=>{
    const attempt=makePresetAttempt(scope,request);expect(restorePresetAttempt(JSON.stringify(attempt),scope)).toEqual(attempt);
    expect(presetStorageKey(scope)).toContain(`${scope.userId}:${scope.workspaceId}`);
    expect(restorePresetAttempt(null,scope)).toBeUndefined();
    expect(()=>restorePresetAttempt(JSON.stringify(attempt),{...scope,userId:presetId})).toThrow();
    expect(()=>restorePresetAttempt(JSON.stringify(attempt),{...scope,workspaceId:presetId})).toThrow();
    expect(()=>makePresetAttempt({...scope,workspaceId:presetId},request)).toThrow();
    expect(()=>restorePresetAttempt("{"+" ".repeat(40_960),scope)).toThrow();
    expect(()=>restorePresetAttempt(JSON.stringify({...attempt,request:{...request,actorUserId:scope.userId}}),scope)).toThrow();
  });
  it("requires a receipt for the exact operation/workspace/request and selected root",()=>{
    const update={...request,operation:"revise" as const,presetId,expectedRevision:1};
    const attempt=makePresetAttempt(scope,update),receipt={workspaceId:scope.workspaceId,requestId,operation:"revise",presetId,versionNumber:2,revision:2,archived:false,title:"Weekly",createdAt:"2026-10-01T00:00:00.000Z"};
    expect(parsePresetReceipt(receipt,attempt)).toEqual(receipt);
    for(const patch of [{workspaceId:presetId},{requestId:presetId},{presetId:requestId},{operation:"create"},{canonicalRequest:"private"}])expect(()=>parsePresetReceipt({...receipt,...patch},attempt)).toThrow();
  });
  it("validates bounded copy responses and cannot navigate an unvalidated identity",()=>{
    const value={workspaceId:scope.workspaceId,presetId,versionNumber:1,title:"Weekly",notes:"",configuration:defaultPresetSettings,configurationHash:"a".repeat(64),createdAt:"2026-10-01T00:00:00.000Z",copiedFrom:null};
    expect(presetVersionSchema.parse(value)).toEqual(value);
    expect(()=>presetVersionSchema.parse({...value,configuration:{...defaultPresetSettings,contentPackageId:presetId}})).toThrow();
    expect(()=>presetDetailPath(scope.workspaceId,"javascript:alert(1)")).toThrow();
    expect(presetDetailPath(scope.workspaceId,presetId,2)).toBe(`/campaigns/presets/${presetId}?workspaceId=${scope.workspaceId}&version=2`);
  });
  it("bounds streaming reads before decoding/parsing, even with no declared size",async()=>{
    expect(await readPresetResponse(Response.json({data:{ok:true}}))).toEqual({data:{ok:true}});
    await expect(readPresetResponse(new Response("{}",{headers:{"content-length":"65537"}}))).rejects.toThrow();
    await expect(readPresetResponse(new Response(" ".repeat(65537)))).rejects.toThrow();
    await expect(readPresetResponse(new Response(new Uint8Array([0xc3,0x28])))).rejects.toThrow();
    await expect(readPresetResponse(new Response("{"))).rejects.toThrow();
  });
  it("renders reusable settings with explicit stale references and no package/account/activation controls",()=>{
    const html=renderToStaticMarkup(createElement(PresetSettingsFields,{brands:[],audiences:[],destinations:[],value:{...defaultPresetSettings,brandProfileVersionId:presetId,audienceProfileVersionIds:[requestId],destinationId:scope.userId},onChange:()=>{}}));
    expect(html).toContain("Saved Brand version is no longer current");expect(html).toContain("Saved Audience version is no longer current");expect(html).toContain("Saved Destination is unavailable");
    expect(html).toContain("no schedule is created");expect(html).toContain("Package selection and exact approval review happen later");
    expect(html).not.toContain("Approved Content Package</span>");expect(html).not.toContain("Activate campaign");
    expect(html).not.toContain('type="password"');
  });
});
