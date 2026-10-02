import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_PROFILE_LIMITS, AccountProfileError, accountProfileUuid, isAccountProfileError, normalizeAccountProfileRequest } from "./account-profile-models";
const accountId="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",requestId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request=()=>({accountId,requestId,expectedRevision:1,displayName:"  Cafe\u0301   Reader  "});
describe("self-service account display-name request",()=>{
  it("normalizes Unicode,ordinary spacing and UUID case into a frozen canonical intent",()=>{
    const value=normalizeAccountProfileRequest(request());expect(value).toEqual({accountId:accountId.toLowerCase(),requestId,expectedRevision:1,displayName:"Café Reader"});expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(ACCOUNT_PROFILE_LIMITS)).toBe(true);
    expect(JSON.stringify(value)).toBe(JSON.stringify(normalizeAccountProfileRequest({...request(),displayName:"Café Reader"})));
  });
  it.each([undefined,null,[],"name",Object.create({displayName:"Inherited"})])("rejects a nonordinary request %j",input=>expect(()=>normalizeAccountProfileRequest(input)).toThrow(AccountProfileError));
  it.each(["email","normalizedEmail","issuer","subject","actorUserId","role","workspaceId","revision"])("rejects extra identity/authority field %s",key=>expect(()=>normalizeAccountProfileRequest({...request(),[key]:"injected"})).toThrow("cannot change identity"));
  it.each(["", " ", "x".repeat(121), "x".repeat(4097), "a\nb", "a\tb", "a\u200bb", "a\u202eb", "a\ud800", "a\udfff", null, 7])("rejects invalid display name %j",displayName=>expect(()=>normalizeAccountProfileRequest({...request(),displayName})).toThrow(AccountProfileError));
  it.each([0,-1,1.2,2_147_483_648,Number.NaN,"1",null])("rejects invalid revision %j",expectedRevision=>expect(()=>normalizeAccountProfileRequest({...request(),expectedRevision})).toThrow(AccountProfileError));
  it.each(["bad","00000000-0000-0000-0000-000000000000",` ${requestId}`,[requestId],null])("rejects invalid identifier %j",id=>expect(()=>accountProfileUuid(id)).toThrow(AccountProfileError));
  it("rejects accessors,nonenumerable and symbol fields before invoking a supplied getter",()=>{
    const getter=vi.fn(()=>"stolen");const accessor={...request()};Object.defineProperty(accessor,"displayName",{get:getter,enumerable:true});expect(()=>normalizeAccountProfileRequest(accessor)).toThrow("hidden fields or accessors");expect(getter).not.toHaveBeenCalled();
    const hidden={...request()};Object.defineProperty(hidden,"secret",{value:true});expect(()=>normalizeAccountProfileRequest(hidden)).toThrow("hidden fields or accessors");expect(()=>normalizeAccountProfileRequest({...request(),[Symbol("hidden")]:true})).toThrow("hidden fields or accessors");
  });
  it("recognizes only branded errors without treating arbitrary public error-shaped data as trusted",()=>{
    expect(isAccountProfileError(new AccountProfileError("revision_conflict","changed"))).toBe(true);expect(isAccountProfileError(new Error("changed"))).toBe(false);expect(isAccountProfileError({code:"access_denied"})).toBe(false);
  });
});
