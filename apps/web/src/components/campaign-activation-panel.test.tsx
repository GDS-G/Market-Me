import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({load:vi.fn(),run:vi.fn(),hydrated:true,states:[] as unknown[],refs:[] as {current:unknown}[],cursor:0,refCursor:0,effectCursor:0,
  effects:[] as {deps?:readonly unknown[];cleanup?:()=>void}[],pendingEffects:[] as (()=>void)[]}));
vi.mock("./campaign-activation-panel.module.css",()=>({default:{}}));
vi.mock("./campaign-activation-contract",async original=>({...await original<typeof import("./campaign-activation-contract")>(),loadActivationPreview:mocks.load,runActivationAttempt:mocks.run}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useSyncExternalStore:()=>mocks.hydrated,
  useState(initial:unknown){const index=mocks.cursor++;if(!(index in mocks.states))mocks.states[index]=typeof initial==="function"?initial():initial;
    return[mocks.states[index],(value:unknown)=>{mocks.states[index]=typeof value==="function"?value(mocks.states[index]):value;}];},
  useRef(initial:unknown){const index=mocks.refCursor++;return mocks.refs[index]??(mocks.refs[index]={current:initial});},
  useEffect(effect:()=>void|(()=>void),deps?:readonly unknown[]){const index=mocks.effectCursor++,prior=mocks.effects[index];if(!prior||!deps||deps.some((v,i)=>!Object.is(v,prior.deps?.[i])))mocks.pendingEffects.push(()=>{
    prior?.cleanup?.();const cleanup=effect();mocks.effects[index]={deps,cleanup:typeof cleanup==="function"?cleanup:undefined};});},
}));
import { CampaignActivationPanel, type CampaignActivationPanelProps } from "./campaign-activation-panel";
import { activationStorageKey, loadActivationAttempt, makeActivationAttempt, retainActivationAttempt, type ActivationPreview } from "./campaign-activation-contract";
const uuid=(n:string)=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const scope={userId:uuid("1"),workspaceId:uuid("2"),campaignId:uuid("3")};
const preview:ActivationPreview={workspaceId:scope.workspaceId,campaignId:scope.campaignId,versionId:uuid("4"),versionNumber:2,campaignName:"Synthetic reviewed wait",autonomyMode:"approval_required",timezone:"UTC",observedAt:"2026-10-02T00:00:00.000Z",steps:[{stepKey:"wait",name:"Wait",operationType:"wait",scheduleType:"immediate",approvalRequired:false}],canActivate:true,actorIncarnationId:uuid("5")};
let props:CampaignActivationPanelProps,memory:Map<string,string>,port:{getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void;removeItem:(k:string)=>void};
let mountedDomRefs:{current:unknown}[]=[];
function attachDomRefs(node:ReactNode){
  if(Array.isArray(node)){node.forEach(attachDomRefs);return;}
  if(!isValidElement<{children?:ReactNode;ref?:{current:unknown}}>(node))return;
  if(typeof node.type==="string"&&node.props.ref){node.props.ref.current={focus:vi.fn()};mountedDomRefs.push(node.props.ref);}
  attachDomRefs(node.props.children);
}
function remount(){for(const effect of mocks.effects)effect?.cleanup?.();mocks.states=[];mocks.refs=[];mocks.effects=[];mocks.pendingEffects=[];}
function render(){mocks.cursor=0;mocks.refCursor=0;mocks.effectCursor=0;const element=CampaignActivationPanel(props);
  if(!isValidElement<CampaignActivationPanelProps>(element)||typeof element.type!=="function")return element;
  const Editor=element.type as (props:CampaignActivationPanelProps)=>ReactNode;
  const tree=Editor(element.props);for(const ref of mountedDomRefs)ref.current=null;mountedDomRefs=[];attachDomRefs(tree);
  const effects=mocks.pendingEffects.splice(0);for(const effect of effects)effect();return tree;
}
function text(node:ReactNode):string{if(node===null||node===undefined||typeof node==="boolean")return"";if(typeof node==="string"||typeof node==="number")return String(node);if(Array.isArray(node))return node.map(text).join("");if(isValidElement<{children?:ReactNode}>(node))return text(node.props.children);return"";}
function find(node:ReactNode,type:string,label?:string):{props:Record<string,unknown>}[]{
  if(Array.isArray(node))return node.flatMap(n=>find(n,type,label));if(!isValidElement<{children?:ReactNode}>(node))return[];
  return [...(node.type===type&&(label===undefined||text(node)===label)?[node as unknown as {props:Record<string,unknown>}]:[]),...find(node.props.children,type,label)];
}
async function click(label:string,tree=render()){const button=find(tree,"button",label)[0];if(!button)throw new Error("Missing button "+label);await (button.props.onClick as ()=>unknown)();await Promise.resolve();}
function check(index=0){const input=find(render(),"input")[index];if(!input)throw new Error("Missing checkbox");(input.props.onChange as (e:unknown)=>void)({target:{checked:true}});}
async function review(){await click("Review one new run");check();}
beforeEach(()=>{vi.resetAllMocks();remount();mocks.hydrated=true;memory=new Map();port={getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v);},removeItem:k=>{memory.delete(k);}};
  vi.stubGlobal("window",{sessionStorage:port});vi.spyOn(crypto,"randomUUID").mockReturnValue(uuid("6") as `${string}-${string}-${string}-${string}-${string}`);
  props={...scope,initial:preview,expectedVersionId:preview.versionId};mocks.load.mockResolvedValue(preview);
  mocks.run.mockImplementation(async attempt=>({kind:"accepted",receipt:{...attempt.request,instanceId:uuid("7"),initialStatus:"scheduled",acceptedAt:preview.observedAt}}));
});
afterEach(()=>{remount();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("activation review and recovery interaction",()=>{
  it("waits for scoped storage hydration and performs no automatic request",()=>{
    mocks.hydrated=false;const first=render();expect(text(first)).toContain("Checking this tab");expect(find(first,"button")).toHaveLength(0);
    mocks.hydrated=true;expect(find(render(),"button","Review one new run")[0]!.props.disabled).toBe(false);expect(mocks.load).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires fresh review plus confirmation before retaining and sending exactly once",async()=>{
    render();await click("Review one new run");expect(mocks.load).toHaveBeenCalledTimes(1);expect(find(render(),"button","Activate this reviewed version")[0]!.props.disabled).toBe(true);
    await click("Activate this reviewed version");expect(mocks.run).not.toHaveBeenCalled();check();await click("Activate this reviewed version");
    const saved=loadActivationAttempt(port,scope)!;expect(saved.request.expectedVersionId).toBe(preview.versionId);expect(mocks.run).toHaveBeenCalledWith(saved,scope,"activate",expect.any(AbortSignal));
    expect(text(render())).toContain("Original run confirmed");expect(memory.size).toBe(1);
  });
  it("suppresses a second handler invocation before a React rerender",async()=>{
    render();await review();let resolve!:(v:unknown)=>void;mocks.run.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const tree=render();await click("Activate this reviewed version",tree);await click("Activate this reviewed version",tree);expect(mocks.run).toHaveBeenCalledTimes(1);
    const saved=loadActivationAttempt(port,scope)!;resolve({kind:"closed",receipt:{...saved.request,closedAt:preview.observedAt}});await Promise.resolve();
  });
  it("retains unknown activation through reload and offers GET recovery without resending",async()=>{
    render();await review();mocks.run.mockRejectedValueOnce(new Error("lost response"));await click("Activate this reviewed version");const saved=loadActivationAttempt(port,scope)!;expect(text(render())).toContain("Original request retained");
    remount();render();expect(text(render())).toContain(saved.request.requestId);expect(mocks.run).toHaveBeenCalledTimes(1);
    await click("Check original request");expect(mocks.run).toHaveBeenLastCalledWith(saved,scope,"lookup",expect.any(AbortSignal));expect(mocks.run.mock.calls.filter(c=>c[2]==="activate")).toHaveLength(1);
  });
  it("never unlocks a replacement request after an absent original lookup",async()=>{
    retainActivationAttempt(port,scope,makeActivationAttempt(scope,preview,uuid("6")));render();mocks.run.mockRejectedValueOnce(new Error("404 observed"));await click("Check original request");
    expect(find(render(),"button","Review one new run")).toHaveLength(0);expect(memory.size).toBe(1);expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("requires separate close confirmation and keeps the original identity",async()=>{
    const saved=retainActivationAttempt(port,scope,makeActivationAttempt(scope,preview,uuid("6")));render();await click("Resolve and close original request");expect(mocks.run).not.toHaveBeenCalled();
    check();mocks.run.mockResolvedValue({kind:"closed",receipt:{...saved.request,closedAt:preview.observedAt}});await click("Resolve and close original request");
    expect(mocks.run).toHaveBeenCalledWith(saved,scope,"close",expect.any(AbortSignal));expect(text(render())).toContain("Original request closed");expect(memory.size).toBe(1);
    await click("Review another deliberate run");expect(memory.size).toBe(0);expect(text(render())).toContain("Review published version 2");expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("does not claim cancellation if closure discovers an accepted run",async()=>{
    retainActivationAttempt(port,scope,makeActivationAttempt(scope,preview,uuid("6")));render();check();await click("Resolve and close original request");
    expect(text(render())).toContain("Original run confirmed");expect(text(render())).not.toContain("Original request closed");expect(text(render())).toContain("does not cancel an accepted run");
  });
  it("retains the same request after an interrupted closure",async()=>{
    const saved=retainActivationAttempt(port,scope,makeActivationAttempt(scope,preview,uuid("6")));render();check();mocks.run.mockRejectedValueOnce(new Error("lost close response"));await click("Resolve and close original request");
    expect(loadActivationAttempt(port,scope)).toEqual(saved);expect(text(render())).toContain("Original request retained");expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("sends nothing when storage write fails or stored data is corrupt",async()=>{
    render();await review();vi.spyOn(port,"setItem").mockImplementation(()=>{throw new Error("quota");});await click("Activate this reviewed version");expect(mocks.run).not.toHaveBeenCalled();expect(text(render())).toContain("No activation was sent");
    remount();memory.set(activationStorageKey(scope),"{");render();expect(find(render(),"button","Review one new run")[0]!.props.disabled).toBe(true);expect(mocks.run).not.toHaveBeenCalled();
  });
  it("does not silently review a different published version or clear earlier history",async()=>{
    render();mocks.load.mockResolvedValue({...preview,versionId:uuid("9")});await click("Review one new run");expect(text(render())).toContain("linked version is no longer current");expect(find(render(),"button","Activate this reviewed version")).toHaveLength(0);expect(mocks.run).not.toHaveBeenCalled();
  });
  it("keeps recovery available to a downgraded member without enabling new activation",async()=>{
    retainActivationAttempt(port,scope,makeActivationAttempt(scope,preview,uuid("6")));const {actorIncarnationId:unused,...view}=preview as Extract<ActivationPreview,{canActivate:true}>;void unused;
    props={...props,initial:{...view,canActivate:false}};render();expect(text(render())).toContain("Writer access is required");await click("Check original request");expect(mocks.run.mock.calls[0]![2]).toBe("lookup");
    expect(find(render(),"button","Review another deliberate run")[0]!.props.disabled).toBe(true);
  });
  it("cancels review without generating request identifiers or mutating storage",async()=>{
    render();await click("Review one new run");await click("Cancel review");expect(find(render(),"button","Activate this reviewed version")).toHaveLength(0);expect(crypto.randomUUID).not.toHaveBeenCalled();expect(memory.size).toBe(0);expect(mocks.run).not.toHaveBeenCalled();
  });
  it("restores keyboard focus only after the canceled review trigger remounts",async()=>{
    render();await click("Review one new run");const reviewTree=render();
    const heading=find(reviewTree,"h3","Review published version 2")[0]!;
    expect((heading.props.ref as {current:{focus:ReturnType<typeof vi.fn>}}).current.focus).toHaveBeenCalledOnce();
    await click("Cancel review",reviewTree);const restoredTree=render();
    const trigger=find(restoredTree,"button","Review one new run")[0]!;
    expect((trigger.props.ref as {current:{focus:ReturnType<typeof vi.fn>}}).current.focus).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();expect(memory.size).toBe(0);
  });
  it("aborts on unmount and never accepts its late outcome",async()=>{
    render();await review();let resolve!:(v:unknown)=>void;mocks.run.mockImplementation(()=>new Promise(r=>{resolve=r;}));await click("Activate this reviewed version");const signal=mocks.run.mock.calls[0]![3] as AbortSignal;
    const saved=loadActivationAttempt(port,scope)!;remount();expect(signal.aborted).toBe(true);resolve({kind:"accepted",receipt:{...saved.request,instanceId:uuid("7"),initialStatus:"scheduled",acceptedAt:preview.observedAt}});await Promise.resolve();render();expect(text(render())).toContain("Original request retained");
  });
});
