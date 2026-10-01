"use client";

import Link from "next/link";
import { useRef,useState,useSyncExternalStore } from "react";
import { INFORMATION_DEPTHS,PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import { makePresetAttempt,parsePresetReceipt,presetDetailPath,presetErrorMessage,presetPayloadData,presetStorageKey,
  readPresetResponse,restorePresetAttempt,type PresetAttempt,type PresetRequest,type PresetScope,type PresetSettings } from "./preparation-preset-contract";
import styles from "./preparation-preset.module.css";

export interface PresetChoices{
  brands:readonly{id:string;name:string;versionNumber:number}[];
  audiences:readonly{id:string;name:string;versionNumber:number}[];
  destinations:readonly{id:string;title:string}[];
}
export interface PresetEditorValue{presetId:string;revision:number;versionNumber:number;latestVersionNumber:number;archived:boolean;
  title:string;notes:string;configuration:PresetSettings}
export interface PresetFormProps extends PresetScope,PresetChoices{saved?:PresetEditorValue}
const subscribe=()=>()=>{};
const browser=()=>true;
const server=()=>false;
export const defaultPresetSettings:PresetSettings={templateKey:"general_announcement",templateVersion:1,name:"General announcement",description:"",audienceProfileVersionIds:[],informationDepth:"contextual",promotionalStrength:"informational",timezone:"UTC"};

export function PreparationPresetForm(props:PresetFormProps){
  return useSyncExternalStore(subscribe,browser,server)?<PresetEditor key={`${props.userId}:${props.workspaceId}:${props.saved?.presetId??"new"}:${props.saved?.revision??0}:${props.saved?.versionNumber??0}`} {...props}/>:<p role="status">Loading saved preset requests…</p>;
}
function PresetEditor(props:PresetFormProps){
  const storageKey=presetStorageKey(props);
  const [restored]=useState(()=>{try{return {attempt:restorePresetAttempt(sessionStorage.getItem(storageKey),props),error:""};}
    catch{return{attempt:undefined,error:"The saved request cannot be read safely. Inspect the library before clearing it; an earlier save may have succeeded."};}});
  const [attempt,setAttempt]=useState<PresetAttempt|undefined>(restored.attempt),[storageError,setStorageError]=useState(restored.error);
  const initial=restored.attempt&&"configuration" in restored.attempt.request?restored.attempt.request:props.saved;
  const [title,setTitle]=useState(initial?.title??""),[notes,setNotes]=useState(initial?.notes??"");
  const [configuration,setConfiguration]=useState<PresetSettings>(initial?.configuration??defaultPresetSettings);
  const [cloneTitle,setCloneTitle]=useState(`${props.saved?.title??"Preset"} copy`.slice(0,120));
  const [pending,setPending]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[resultLink,setResultLink]=useState("");
  const [confirmed,setConfirmed]=useState(false);const inFlight=useRef(false);
  const frozen=pending||Boolean(attempt)||Boolean(storageError);

  async function run(operation?:PresetRequest["operation"],checkOnly=false){
    if(inFlight.current||storageError)return;
    inFlight.current=true;setPending(true);setError("");setMessage("");setResultLink("");
    let exact=attempt;
    try{
      if(!exact){
        if(checkOnly||!operation)return;
        const scope={workspaceId:props.workspaceId,requestId:crypto.randomUUID()};
        let request:PresetRequest;
        if(operation==="create")request={operation,...scope,title,notes,configuration};
        else{
          if(!props.saved)throw new Error("Choose a saved preset.");
          const saved={...scope,presetId:props.saved.presetId,expectedRevision:props.saved.revision};
          request=operation==="revise"?{operation,...saved,title,notes,configuration}
            :operation==="clone"?{operation,...saved,versionNumber:props.saved.versionNumber,title:cloneTitle}:{operation,...saved};
        }
        exact=makePresetAttempt(props,request);
        // Persistence precedes network so a lost response is always recoverable.
        try{sessionStorage.setItem(storageKey,JSON.stringify(exact));}catch{setStorageError("Browser storage is unavailable. No save was sent; restore storage before trying again.");return;}
        setAttempt(exact);
      }
      const response=await fetch(checkOnly?`/api/v1/preparation-presets?workspaceId=${encodeURIComponent(exact.request.workspaceId)}&requestId=${encodeURIComponent(exact.request.requestId)}`:"/api/v1/preparation-presets",
        checkOnly?{cache:"no-store"}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(exact.request)});
      const payload=await readPresetResponse(response);
      if(!response.ok){setError(presetErrorMessage(payload,"No confirmed result was received. Check or retry the same saved request."));return;}
      const result=parsePresetReceipt(presetPayloadData(payload),exact);
      setMessage(`Saved ${result.operation}: “${result.title}”, version ${result.versionNumber}, library revision ${result.revision}. This is the original request result, not a claim that it is still the latest state.`);
      setResultLink(presetDetailPath(result.workspaceId,result.presetId,result.versionNumber));
    }catch{setError(exact?"The result is uncertain. Your exact request is saved in this tab. Check the result or retry that same request.":"Review the required title, configuration and limits. No request was sent.");}
    finally{inFlight.current=false;setPending(false);}
  }
  function reset(){
    if(!confirmed||inFlight.current)return;
    try{sessionStorage.removeItem(storageKey);setAttempt(undefined);setStorageError("");setError("");setResultLink("");setConfirmed(false);
      setTitle(props.saved?.title??"");setNotes(props.saved?.notes??"");setConfiguration(props.saved?.configuration??defaultPresetSettings);
      setMessage("Ready for a different request. Reload the current preset before editing if another save may have changed it.");}
    catch{setStorageError("The saved request could not be cleared. No new request was sent.");}
  }
  return <div className={styles.editor}>
    {(attempt||storageError)&&<section className={styles.notice} aria-label="Saved preset request">
      <h2>Saved preset request</h2><p>{attempt?`${attempt.request.operation} · request ${attempt.request.requestId}`:"Unreadable recovery data"}</p>
      <p>These actions recover the exact original request—even if you are now viewing another version or preset. Existing fields are frozen until you explicitly start a different request.</p>
      <div className={styles.actions}><button type="button" disabled={pending||Boolean(storageError)||!attempt} onClick={()=>void run(undefined,true)}>Check saved result</button>
        <button type="button" disabled={pending||Boolean(storageError)||!attempt} onClick={()=>void run()}>Retry same request</button></div>
      <label className="checkbox-row"><input type="checkbox" disabled={pending} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked for earlier success and want to start a separate request.</label>
      <button type="button" disabled={pending||!confirmed} onClick={reset}>Start a different request</button>
    </section>}
    <form className="resource-form" onSubmit={e=>{e.preventDefault();void run(props.saved?"revise":"create");}}>
      <fieldset disabled={frozen||props.saved?.archived} className={styles.fieldset}><legend><h2>{props.saved?`New version from saved v${props.saved.versionNumber}`:"New preparation preset"}</h2></legend>
        <p>Only reusable settings are saved. No package, Campaign, draft, source binding, approval, activation or external send is created.</p>
        <div className="field-grid"><label className="field"><span>Preset title</span><input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
          <label className="field field-wide"><span>Library notes (optional)</span><textarea maxLength={2_000} value={notes} onChange={e=>setNotes(e.target.value)}/></label></div>
        <PresetSettingsFields {...props} value={configuration} onChange={setConfiguration}/>
        <button type="submit" className="button-primary">{props.saved?"Save new immutable version":"Save preset"}</button>
      </fieldset>
    </form>
    {props.saved&&<section className={styles.notice} aria-label="Preset lifecycle"><h2>Library actions</h2>
      <p>Latest saved version: {props.saved.latestVersionNumber}. Library revision: {props.saved.revision}. Earlier versions and copied preparation settings do not change.</p>
      <div className={styles.actions}>
        <label>Clone title<input maxLength={120} value={cloneTitle} disabled={frozen||props.saved.archived} onChange={e=>setCloneTitle(e.target.value)}/></label>
        <button type="button" disabled={frozen||props.saved.archived||!cloneTitle.trim()} onClick={()=>void run("clone")}>Clone saved v{props.saved.versionNumber}</button>
        <button type="button" disabled={frozen} onClick={()=>void run(props.saved!.archived?"restore":"archive")}>{props.saved.archived?"Restore preset":"Archive preset"}</button>
      </div><p>Cloning uses that saved version, not unsaved edits above. Archiving stops new copies without deleting history or changing existing Campaigns. Restoring does not make stale profile references current.</p>
    </section>}
    {storageError&&<p role="alert" className="form-error">{storageError}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
    {message&&<p role="status">{message}</p>}{resultLink&&<Link className="button-secondary resource-button" href={resultLink}>Open saved result and current library state</Link>}
    {pending&&<p role="status">Checking your exact preset request…</p>}
    <p className="form-help">The exact settings and request ID are retained in this browser tab for your user/workspace. Closing the tab clears that local recovery copy; immutable server versions and receipts remain. No credentials are stored.</p>
  </div>;
}

export function PresetSettingsFields({value,onChange,brands,audiences,destinations}:PresetChoices&{value:PresetSettings;onChange:(value:PresetSettings)=>void}){
  return <section><h3>General Announcement · compiler v1</h3><p>Draft-only awareness preparation with one draft per selected audience, or one General draft. Package selection and exact approval review happen later.</p>
    <div className="field-grid">
      <label className="field"><span>Campaign name</span><input required maxLength={200} value={value.name} onChange={e=>onChange({...value,name:e.target.value})}/></label>
      <label className="field"><span>Timezone</span><input required maxLength={100} value={value.timezone} onChange={e=>onChange({...value,timezone:e.target.value})}/><small>For example UTC or America/Chicago; no schedule is created.</small></label>
      <label className="field field-wide"><span>Campaign description (optional)</span><textarea maxLength={5_000} value={value.description} onChange={e=>onChange({...value,description:e.target.value})}/></label>
      <label className="field"><span>Published Brand Profile version (optional)</span><select value={value.brandProfileVersionId??""} onChange={e=>{const next={...value};delete next.brandProfileVersionId;onChange(e.target.value?{...next,brandProfileVersionId:e.target.value}:next);}}><option value="">No Brand Profile</option>
        {value.brandProfileVersionId&&!brands.some(b=>b.id===value.brandProfileVersionId)&&<option value={value.brandProfileVersionId}>Saved Brand version is no longer current</option>}{brands.map(b=><option key={b.id} value={b.id}>{b.name} · v{b.versionNumber}</option>)}</select></label>
      <label className="field"><span>Published Destination (optional)</span><select value={value.destinationId??""} onChange={e=>{const next={...value};delete next.destinationId;onChange(e.target.value?{...next,destinationId:e.target.value}:next);}}><option value="">No Destination</option>
        {value.destinationId&&!destinations.some(d=>d.id===value.destinationId)&&<option value={value.destinationId}>Saved Destination is unavailable</option>}{destinations.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      <fieldset className={`field-wide ${styles.audiences}`}><legend>Published Audience Profile versions (optional)</legend><p>Selection order determines draft order. No selections produce one General draft.</p>
        {value.audienceProfileVersionIds.filter(id=>!audiences.some(a=>a.id===id)).map(id=><label key={id}><input type="checkbox" checked onChange={()=>onChange({...value,audienceProfileVersionIds:value.audienceProfileVersionIds.filter(v=>v!==id)})}/>Saved Audience version is no longer current</label>)}
        {audiences.map(a=><label key={a.id}><input type="checkbox" checked={value.audienceProfileVersionIds.includes(a.id)} onChange={e=>onChange({...value,audienceProfileVersionIds:e.target.checked?[...value.audienceProfileVersionIds,a.id]:value.audienceProfileVersionIds.filter(id=>id!==a.id)})}/>{a.name} · v{a.versionNumber}</label>)}
        {!audiences.length&&<p>No current published Audiences. <Link href="/audience">Manage profiles</Link></p>}
      </fieldset>
      <label className="field"><span>Information depth</span><select value={value.informationDepth} onChange={e=>onChange({...value,informationDepth:e.target.value as PresetSettings["informationDepth"]})}>{INFORMATION_DEPTHS.filter(v=>v!=="custom"||value.informationDepth==="custom").map(v=><option key={v} value={v}>{v.replaceAll("_"," ")}</option>)}</select></label>
      <label className="field"><span>Promotional strength</span><select value={value.promotionalStrength} onChange={e=>onChange({...value,promotionalStrength:e.target.value as PresetSettings["promotionalStrength"]})}>{PROMOTIONAL_STRENGTHS.filter(v=>v!=="custom"||value.promotionalStrength==="custom").map(v=><option key={v} value={v}>{v.replaceAll("_"," ")}</option>)}</select></label>
    </div><p>Published profile ceilings remain authoritative. Older unavailable selections must be corrected before saving or copying; reading historical settings does not make them current.</p>
  </section>;
}
