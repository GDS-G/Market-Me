import { describe, expect, it } from "vitest";
import { normalizePreparationPresetRequest, PreparationPresetError, isPreparationPresetError } from "./preparation-preset-models";

const workspaceId="11111111-1111-4111-8111-111111111111",requestId="22222222-2222-4222-8222-222222222222",presetId="33333333-3333-4333-8333-333333333333";
const input={operation:"create",workspaceId,requestId,title:"  Weekly\n update ",configuration:{name:"Update"}};
describe("preparation preset mutation contract",()=>{
  it("normalizes canonical settings and labels without including authority",()=>{
    const request=normalizePreparationPresetRequest(input);
    expect(request).toEqual({operation:"create",workspaceId,requestId,title:"Weekly update",notes:"",configuration:{
      templateKey:"general_announcement",templateVersion:1,name:"Update",description:"",audienceProfileVersionIds:[],informationDepth:"contextual",promotionalStrength:"informational",timezone:"UTC"}});
    const reordered={configuration:{name:"Update"},title:"Weekly update",requestId,workspaceId,operation:"create",notes:""};
    expect(JSON.stringify(request)).toBe(JSON.stringify(normalizePreparationPresetRequest(reordered)));
    expect(Object.isFrozen(request)).toBe(true);
  });
  it.each(["actorUserId","createdBy","id","approvalId","enabled","contentPackageId"])("rejects added %s",field=>{
    expect(()=>normalizePreparationPresetRequest({...input,[field]:"unsafe"})).toThrow();
  });
  it("requires exact revision/version selection and refuses irrelevant operation fields",()=>{
    expect(normalizePreparationPresetRequest({operation:"clone",workspaceId,requestId,presetId,expectedRevision:2,versionNumber:1,title:"Copy"}))
      .toEqual({operation:"clone",workspaceId,requestId,presetId,expectedRevision:2,versionNumber:1,title:"Copy"});
    for(const expectedRevision of [undefined,0,-1,2_147_483_648,1.2,"1"]){
      expect(()=>normalizePreparationPresetRequest({operation:"archive",workspaceId,requestId,presetId,expectedRevision})).toThrow();
    }
    expect(()=>normalizePreparationPresetRequest({operation:"restore",workspaceId,requestId,presetId,expectedRevision:1,configuration:{}})).toThrow();
  });
  it("does not call object coercion, inherited getters, or toJSON",()=>{
    let called=false;
    for(const unsafe of [{...input,operation:{toString(){called=true;return "create";}}},{...input,get title(){called=true;return "x";}},
      {...input,toJSON(){called=true;return input;}},Object.create(input)])expect(()=>normalizePreparationPresetRequest(unsafe)).toThrow();
    expect(called).toBe(false);
  });
  it.each([null,"", "x".repeat(121),"Title\u0000"])("rejects invalid title %j",title=>{
    expect(()=>normalizePreparationPresetRequest({...input,title})).toThrow();
  });
  it("bounds notes, UTF-8 bytes, nested audiences and unknown configuration fields",()=>{
    expect(()=>normalizePreparationPresetRequest({...input,notes:null})).toThrow();
    expect(()=>normalizePreparationPresetRequest({...input,notes:"x".repeat(2001)})).toThrow();
    expect(()=>normalizePreparationPresetRequest({...input,configuration:{name:"x",description:"\"".repeat(5000),audienceProfileVersionIds:Array(21).fill(presetId)}})).toThrow();
    expect(()=>normalizePreparationPresetRequest({...input,configuration:{expectedReviewFingerprint:"private"}})).toThrow();
  });
  it("brands only server-authored errors across retained module copies",()=>{
    const error=new PreparationPresetError("revision_conflict","Reload");Object.setPrototypeOf(error,Error.prototype);
    expect(isPreparationPresetError(error)).toBe(true);
    expect(isPreparationPresetError(Object.assign(new Error("private"),{name:"PreparationPresetError",code:"revision_conflict"}))).toBe(false);
  });
});
