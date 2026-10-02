import { createElement,type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { CampaignActivationError } from "@market-me/database";
const mocks=vi.hoisted(()=>({user:vi.fn(),workspace:vi.fn(),campaign:vi.fn(),preview:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error("redirect:"+path);},notFound:()=>{throw new Error("not-found");}}));
vi.mock("@/server/auth",()=>({getAuthenticatedUser:mocks.user}));
vi.mock("@/server/active-workspace",()=>({getActiveWorkspace:mocks.workspace}));
vi.mock("@/server/database",()=>({getCampaignRepository:()=>({getCampaign:mocks.campaign}),getCampaignActivationRepository:()=>({preview:mocks.preview})}));
vi.mock("@/components/workspace-shell",()=>({WorkspaceShell:({children}:{children:ReactNode})=>createElement("main",{},children)}));
vi.mock("@/components/campaign-activation-panel",()=>({CampaignActivationPanel:(props:unknown)=>createElement("section",{"data-activation":true},JSON.stringify(props))}));
import Page from "../app/campaigns/[id]/activate/page";
const uuid=(n:string)=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const workspaceId=uuid("1"),userId=uuid("2"),campaignId=uuid("3"),versionId=uuid("4");
const input=(query:Record<string,string|string[]|undefined>={workspaceId,expectedVersionId:versionId},id=campaignId)=>({params:Promise.resolve({id}),searchParams:Promise.resolve(query)});
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:userId,displayName:"Synthetic writer"});mocks.workspace.mockResolvedValue({workspaceId,workspaceName:"Synthetic workspace",role:"editor"});mocks.campaign.mockResolvedValue({id:campaignId,name:"Reviewed <script>not markup</script>"});mocks.preview.mockResolvedValue({workspaceId,campaignId,versionId,canActivate:true,actorIncarnationId:uuid("5")});});
describe("current-workspace activation review page",()=>{
  it("loads only the scoped campaign and preview with authenticated actor",async()=>{
    const html=renderToStaticMarkup(await Page(input()));expect(mocks.campaign).toHaveBeenCalledExactlyOnceWith(workspaceId,campaignId);expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(workspaceId,campaignId,userId);
    expect(html).toContain('data-activation="true"');expect(html).toContain("&quot;expectedVersionId&quot;:&quot;"+versionId);expect(html).not.toContain("<script>");
  });
  it("requires authentication and an actual current workspace",async()=>{
    mocks.user.mockResolvedValue(undefined);await expect(Page(input())).rejects.toThrow("redirect:/login");mocks.user.mockResolvedValue({id:userId});mocks.workspace.mockResolvedValue(undefined);await expect(Page(input())).rejects.toThrow("redirect:/login");expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([{}, {workspaceId:"bad"},{workspaceId:uuid("9")},{workspaceId:[workspaceId]},{workspaceId,expectedVersionId:[versionId]},{workspaceId,expectedVersionId:"bad"},{workspaceId,userId}])("rejects ambiguous or foreign hints %# before repository reads",async query=>{
    await expect(Page(input(query))).rejects.toThrow("not-found");expect(mocks.campaign).not.toHaveBeenCalled();expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("rejects malformed and foreign campaign paths",async()=>{
    await expect(Page(input({workspaceId},"bad"))).rejects.toThrow("not-found");mocks.campaign.mockResolvedValue(undefined);await expect(Page(input())).rejects.toThrow("not-found");expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("retains a stale expected-version pin instead of replacing it with current state",async()=>{
    const html=renderToStaticMarkup(await Page(input({workspaceId,expectedVersionId:uuid("9")})));expect(html).toContain("&quot;expectedVersionId&quot;:&quot;"+uuid("9"));expect(html).toContain("&quot;versionId&quot;:&quot;"+versionId);
  });
  it.each([undefined,new CampaignActivationError("preview_unavailable","Too large")])("preserves the recovery surface when current published review is unavailable %#",async value=>{
    if(value instanceof Error)mocks.preview.mockRejectedValue(value);else mocks.preview.mockResolvedValue(value);
    expect(renderToStaticMarkup(await Page(input()))).toContain('data-activation="true"');
  });
  it("does not hide authorization or database failures as missing publication",async()=>{
    mocks.preview.mockRejectedValue(new CampaignActivationError("access_denied","Revoked"));await expect(Page(input())).rejects.toMatchObject({code:"access_denied"});
  });
});
