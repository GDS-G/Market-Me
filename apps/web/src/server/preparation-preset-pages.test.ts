import { createElement,type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({user:vi.fn(),workspace:vi.fn(),list:vi.fn(),get:vi.fn(),history:vi.fn(),brands:vi.fn(),audiences:vi.fn(),destinations:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`redirect:${path}`);},notFound:()=>{throw new Error("not-found");}}));
vi.mock("./auth",()=>({getAuthenticatedUser:mocks.user}));
vi.mock("./active-workspace",()=>({getActiveWorkspace:mocks.workspace}));
vi.mock("./database",()=>({getProfileRepository:()=>({listBrandProfiles:mocks.brands,listAudienceProfiles:mocks.audiences}),getCampaignRepository:()=>({listDestinations:mocks.destinations})}));
vi.mock("@/server/database",()=>({getPreparationPresetRepository:()=>mocks}));
vi.mock("@/server/preparation-preset-pages",()=>import("./preparation-preset-pages"));
vi.mock("@/components/preparation-preset-contract",()=>import("../components/preparation-preset-contract"));
vi.mock("@/components/preparation-preset.module.css",()=>({default:{}}));
vi.mock("@/components/preparation-preset-form",()=>({PreparationPresetForm:(props:unknown)=>createElement("form",{"data-preset":JSON.stringify(props)},"Preset editor")}));
vi.mock("@/components/workspace-shell",()=>({WorkspaceShell:({children}:{children:ReactNode})=>createElement("main",{},children)}));
import List from "../app/campaigns/presets/page";
import New from "../app/campaigns/presets/new/page";
import Detail from "../app/campaigns/presets/[id]/page";
import { presetPageNumber } from "./preparation-preset-pages";
const workspaceId="11111111-1111-4111-8111-111111111111",userId="22222222-2222-4222-8222-222222222222",id="33333333-3333-4333-8333-333333333333";
const configuration={templateKey:"general_announcement",templateVersion:1,name:"Weekly",description:"",audienceProfileVersionIds:[],informationDepth:"contextual",promotionalStrength:"informational",timezone:"UTC"};
const saved={root:{id,workspaceId,revision:3,latestVersionNumber:2,archived:false},version:{workspaceId,presetId:id,versionNumber:1,title:"Weekly updates",notes:"Saved",configuration,copiedFrom:null}};
const detail=(query:Record<string,string|string[]|undefined>={workspaceId})=>Detail({params:Promise.resolve({id}),searchParams:Promise.resolve(query)});
beforeEach(()=>{vi.resetAllMocks();mocks.user.mockResolvedValue({id:userId,displayName:"QA"});mocks.workspace.mockResolvedValue({workspaceId,workspaceName:"QA",role:"editor"});
  mocks.list.mockResolvedValue({items:[],more:false});mocks.get.mockResolvedValue(saved);mocks.history.mockResolvedValue({items:[{versionNumber:1,title:"Weekly updates",createdAt:"2026-10-01"}],more:false});mocks.brands.mockResolvedValue([]);mocks.audiences.mockResolvedValue([]);mocks.destinations.mockResolvedValue([]);});
describe("preset library page scope and writer controls",()=>{
  it("renders an honest empty library with one new-preset entry",async()=>{
    const html=renderToStaticMarkup(await List({searchParams:Promise.resolve({workspaceId})}));expect(html).toContain("No preparation presets yet");expect(html).toContain("New preset");expect(html).toContain("not executable workflows");expect(mocks.list).toHaveBeenCalledWith(workspaceId,userId,1);
  });
  it.each(["viewer","analyst","approver"])("lets %s read saved history without library writes or copy controls",async role=>{
    mocks.workspace.mockResolvedValue({workspaceId,workspaceName:"QA",role});
    const html=renderToStaticMarkup(await detail());expect(html).toContain("Weekly updates");expect(html).not.toContain("Preset editor");expect(html).not.toContain("Review and copy into preparation");
    expect(renderToStaticMarkup(await New({searchParams:Promise.resolve({workspaceId})}))).toContain("Writer access required");expect(mocks.brands).not.toHaveBeenCalled();
  });
  it("preserves selected historical version and current root revision in the explicit-copy link",async()=>{
    const html=renderToStaticMarkup(await detail({workspaceId,version:"1"}));expect(mocks.get).toHaveBeenCalledWith(workspaceId,id,userId,1);
    expect(html).toContain(`presetVersion=1&amp;presetRevision=3`);expect(html).toContain("not replace a saved recovery attempt, choose a package or grant an approval");expect(html).toContain("Preset editor");
  });
  it("keeps archived history readable but removes new-copy entry",async()=>{
    mocks.get.mockResolvedValue({...saved,root:{...saved.root,archived:true}});const html=renderToStaticMarkup(await detail());expect(html).toContain("Archived");expect(html).not.toContain("Review and copy into preparation");expect(html).toContain("Preset editor");
  });
  it("rejects foreign/duplicate workspace and malformed pagination before library reads",async()=>{
    for(const query of [{workspaceId:id},{workspaceId:[workspaceId,workspaceId]},{workspaceId,version:"1e2"},{workspaceId,version:"0"},{workspaceId,actorUserId:userId}])await expect(detail(query)).rejects.toThrow("not-found");
    expect(mocks.get).not.toHaveBeenCalled();expect(()=>presetPageNumber("2001",2000)).toThrow("not-found");
  });
  it("requires authentication and current workspace before displaying metadata",async()=>{
    mocks.user.mockResolvedValue(undefined);await expect(detail()).rejects.toThrow("redirect:/login");expect(mocks.get).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({id:userId});mocks.workspace.mockResolvedValue(undefined);await expect(detail()).rejects.toThrow("redirect:/login");
  });
  it("renders only current published choices in the writer's new-preset form",async()=>{
    mocks.brands.mockResolvedValue([{name:"Current",status:"published",currentVersion:{id,versionNumber:1,status:"published"}},{name:"Private draft",status:"draft",currentVersion:{id:userId,versionNumber:1,status:"draft"}}]);
    const html=renderToStaticMarkup(await New({searchParams:Promise.resolve({workspaceId})}));expect(html).toContain("Current");expect(html).not.toContain("Private draft");
  });
});
