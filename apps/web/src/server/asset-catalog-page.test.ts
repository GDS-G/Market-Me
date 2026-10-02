import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAssetCatalogCursor, type AssetCatalogSnapshot } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getPage: vi.fn() }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getAssetCatalogRepository: () => mocks }));
vi.mock("@/server/asset-catalog-view", () => import("./asset-catalog-view"));
vi.mock("@/server/content-catalog-view", () => import("./content-catalog-view"));
vi.mock("@/server/dashboard-data", () => import("./dashboard-data"));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children, activePath }: { children: ReactNode; activePath: string }) => createElement("main", { "data-active-path": activePath }, children) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("redirect:" + url); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }: { href: string; prefetch?: boolean; children: ReactNode }) => createElement("a", { ...props, href, "data-prefetch": prefetch === false ? "false" : undefined }, children) }));
vi.mock("../app/content-packages/catalog.module.css", () => ({ default: {} }));
import AssetsPage from "../app/assets/page";
const userId="11111111-1111-4111-8111-111111111111",workspaceId="22222222-2222-4222-8222-222222222222",assetId="33333333-3333-4333-8333-333333333333",time="2026-10-02T05:00:00.123456Z";
function snapshot():AssetCatalogSnapshot{return{schemaVersion:1,workspaceId,observedAt:time,filters:{query:"",role:null},totalAssets:"1",totalMatches:"1",nextCursor:null,items:[{id:assetId,packageId:userId,packageTitle:"Synthetic package",fileName:"Synthetic.txt",mimeType:"text/plain",role:"original",byteSize:null,createdAt:time,extractionStatus:"completed",mediaStatus:"unsupported",scanStatus:"not_configured",rightsStatus:"unchecked"}]};}
const page=(query:Record<string,string|string[]|undefined>={})=>AssetsPage({searchParams:Promise.resolve(query)});
beforeEach(()=>{vi.resetAllMocks();mocks.user.mockResolvedValue({id:userId,displayName:"Synthetic"});mocks.workspace.mockResolvedValue({workspaceId,workspaceName:"Synthetic workspace",role:"viewer"});mocks.getPage.mockResolvedValue(snapshot());});
describe("metadata-only asset inventory page",()=>{
  it("reads only scoped metadata and does not embed thumbnails,download endpoints or write forms",async()=>{
    const html=renderToStaticMarkup(await page());expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith(workspaceId,userId,{query:""});expect(html).toContain('data-active-path="/assets"');expect(html).toContain('method="get"');expect(html).toContain('action="/assets"');expect(html).toContain('name="workspaceId" value="'+workspaceId+'"');expect(html).toContain('maxLength="120"');expect(html).toContain('href="/content-packages/'+userId+'"');expect(html).toContain('data-prefetch="false"');expect(html).not.toMatch(/<img|<video|<audio|download=|\/api\/|method="post"/);expect(html).toContain("do not prove current safety");expect(html).toContain("Newest added first");expect(html).not.toContain("Newest updated first");
  });
  it.each(["owner","admin","editor","approver","analyst","viewer"])("offers the same read-only inventory to %s",async role=>{mocks.workspace.mockResolvedValue({workspaceId,workspaceName:"QA",role});const html=renderToStaticMarkup(await page());expect(html).toContain("Search assets");expect(html).not.toMatch(/Approve asset|Generate media|Publish now/);});
  it.each(["session","workspace"])("requires current %s before reading",async missing=>{if(missing==="session")mocks.user.mockResolvedValue(undefined);else mocks.workspace.mockResolvedValue(undefined);await expect(page()).rejects.toThrow("redirect:/login");expect(mocks.getPage).not.toHaveBeenCalled();});
  it.each([{workspaceId:assetId},{q:["a","b"]},{role:["original"]},{cursor:"bad"},{extra:"yes"}])("rejects malformed input %j",async query=>{await expect(page(query)).rejects.toThrow("not-found");expect(mocks.getPage).not.toHaveBeenCalled();});
  it.each([undefined,{...snapshot(),workspaceId:assetId},{...snapshot(),filters:{query:"foreign",role:null}},{...snapshot(),filters:{query:"",role:"derivative"}}])("rejects missing or inconsistent returned scope",async data=>{mocks.getPage.mockResolvedValue(data);await expect(page()).rejects.toThrow("not-found");});
  it("escapes filenames/labels and retains exact byte-size distinctions",async()=>{
    const data=snapshot();Object.assign(data.items[0],{fileName:'<script>file</script>',packageTitle:'A & B',mimeType:'image/<fake>',byteSize:"9007199254740995",scanStatus:"clean",rightsStatus:"cleared"});mocks.getPage.mockResolvedValue(data);const html=renderToStaticMarkup(await page());expect(html).toContain("&lt;script&gt;file&lt;/script&gt;");expect(html).not.toContain("<script>");expect(html).toContain("A &amp; B");expect(html).toContain("9,007,199,254,740,995 bytes");expect(html).toContain("Clean record");expect(html).toContain("Cleared record");
    Object.assign(data.items[0],{byteSize:"0",fileName:"",mimeType:"",packageTitle:""});expect(renderToStaticMarkup(await page())).toContain("0 bytes");expect(renderToStaticMarkup(await page())).toContain("Unnamed file record");expect(renderToStaticMarkup(await page())).toContain("Untitled package");
  });
  it.each([{totalAssets:"0",totalMatches:"0",expected:"No assets available"},{totalAssets:"3",totalMatches:"0",expected:"No matching assets"},{totalAssets:"3",totalMatches:"2",expected:"No more assets at this position"}])("distinguishes $expected",async state=>{mocks.getPage.mockResolvedValue({...snapshot(),...state,items:[]});expect(renderToStaticMarkup(await page())).toContain(state.expected);});
  it("retains selection in paging while the GET form drops cursor",async()=>{
    const selection={query:"café &",role:"original" as const},cursor=encodeAssetCatalogCursor(workspaceId,selection,{at:time,id:assetId});mocks.getPage.mockResolvedValue({...snapshot(),filters:selection,totalMatches:"9007199254740995",nextCursor:cursor});const html=renderToStaticMarkup(await page({q:selection.query,role:selection.role,cursor}));expect(html).toContain("1 of 9,007,199,254,740,995");expect(html).toContain("q=caf%C3%A9+%26&amp;role=original&amp;cursor=");expect(html).toContain("Newest results");expect(html.match(/<form[^>]*>[\s\S]*?<\/form>/)?.[0]).not.toContain('name="cursor"');
  });
  it("keys native controls by applied workspace,query and role",async()=>{
    function key(node:ReactNode):string|null{if(Array.isArray(node))return node.map(key).find(k=>k!==null)??null;if(!isValidElement<{children?:ReactNode}>(node))return null;return node.type==="form"?node.key:key(node.props.children);}
    expect(key(await page())).toBe(JSON.stringify([workspaceId,"",null]));mocks.getPage.mockResolvedValue({...snapshot(),filters:{query:"café",role:"supporting"}});expect(key(await page({q:"café",role:"supporting"}))).toBe(JSON.stringify([workspaceId,"café","supporting"]));mocks.workspace.mockResolvedValue({workspaceId:assetId,workspaceName:"Other",role:"viewer"});mocks.getPage.mockResolvedValue({...snapshot(),workspaceId:assetId});expect(key(await page())).toBe(JSON.stringify([assetId,"",null]));
  });
});
