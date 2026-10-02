"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivationClientError, createActivationGate, forgetResolvedActivation, loadActivationAttempt, loadActivationPreview, makeActivationAttempt,
  parseActivationPreview, retainActivationAttempt, runActivationAttempt, type ActivationAttempt, type ActivationOutcome, type ActivationPreview, type ActivationScope } from "./campaign-activation-contract";
import styles from "./campaign-activation-panel.module.css";

export type CampaignActivationPanelProps = ActivationScope & { initial?: ActivationPreview; expectedVersionId?: string };
const subscribeHydration = () => () => {};
const clientHydrated = () => true, serverHydrated = () => false;
export function CampaignActivationPanel(props: CampaignActivationPanelProps) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  if (!hydrated) return <p role="status">Checking this tab’s retained activation request…</p>;
  return <ActivationEditor key={JSON.stringify([props.userId,props.workspaceId,props.campaignId,props.expectedVersionId,
    props.initial?.canActivate,props.initial?.canActivate?props.initial.actorIncarnationId:null])} {...props} />;
}
function ActivationEditor({ userId,workspaceId,campaignId,initial,expectedVersionId }: CampaignActivationPanelProps) {
  const scope={userId,workspaceId,campaignId};
  const [restored]=useState(()=>{try{return{attempt:loadActivationAttempt(window.sessionStorage,scope),ready:true};}
    catch{return{attempt:undefined,ready:false};}});
  const storageReady=restored.ready;
  const [current,setCurrent]=useState<ActivationPreview|undefined>(()=>initial?parseActivationPreview(initial,scope):undefined);
  const [review,setReview]=useState<ActivationPreview>(),[confirmed,setConfirmed]=useState(false),[closeConfirmed,setCloseConfirmed]=useState(false);
  const [attempt,setAttempt]=useState<ActivationAttempt|undefined>(restored.attempt),[result,setResult]=useState<ActivationOutcome>();
  const [pending,setPending]=useState(false),[error,setError]=useState(restored.ready?"":"Local recovery data is unavailable or invalid. No new activation will be sent. Keep this tab and inspect existing campaign runs before changing browser storage.");
  const [gate]=useState(createActivationGate),mounted=useRef(true),retained=useRef<ActivationAttempt|undefined>(restored.attempt);
  const reviewHeading=useRef<HTMLHeadingElement>(null),resultHeading=useRef<HTMLHeadingElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;gate.cancel();};},[gate]);
  useEffect(()=>{if(review&&!attempt)reviewHeading.current?.focus();},[review,attempt]);
  useEffect(()=>{if(result)resultHeading.current?.focus();},[result]);
  useEffect(()=>{if(!review&&!attempt&&restoreTriggerFocus.current){restoreTriggerFocus.current=false;trigger.current?.focus();}},[review,attempt]);
  const versionMismatch=Boolean(expectedVersionId&&current&&expectedVersionId!==current.versionId);
  async function beginReview(){
    if(!storageReady||(retained.current&&!result))return;
    const operation=gate.begin();if(!operation)return;setPending(true);setError("");
    try{const next=await loadActivationPreview(scope,operation.signal);if(!mounted.current||!operation.current())return;setCurrent(next);
      if(!next.canActivate)throw new ActivationClientError("Current writer access is required for a new run. Original lookup and closure remain available to current members.");
      if(expectedVersionId&&next.versionId!==expectedVersionId)throw new ActivationClientError("The linked published version changed. Follow the current-version review link explicitly; this page will not switch your selection silently.");
      if(retained.current){if(!result)throw new ActivationClientError("Resolve the original request first.");forgetResolvedActivation(window.sessionStorage,scope,retained.current,result);}
      retained.current=undefined;setAttempt(undefined);setResult(undefined);setReview(next);setConfirmed(false);setCloseConfirmed(false);
    }catch(failure){if(mounted.current)setError(failure instanceof ActivationClientError?failure.message:"The current review could not be loaded. No new activation was sent.");}
    finally{operation.finish();if(mounted.current)setPending(false);}
  }
  async function run(action:"activate"|"lookup"|"close"){
    if(!storageReady)return;
    if(action==="activate"&&(retained.current||!review?.canActivate||!confirmed))return;
    if(action!=="activate"&&!retained.current)return;
    if(action==="close"&&(!closeConfirmed||result))return;
    const operation=gate.begin();if(!operation)return;setPending(true);setError("");
    try{
      let exact=retained.current;
      if(action==="activate"){
        // Retain and verify durable tab correlation before the very first POST.
        exact=makeActivationAttempt(scope,review!,crypto.randomUUID());
        exact=retainActivationAttempt(window.sessionStorage,scope,exact);retained.current=exact;setAttempt(exact);setReview(undefined);setConfirmed(false);
      }
      if(!exact)throw new ActivationClientError("No exact original request is retained.");
      const outcome=await runActivationAttempt(exact,scope,action,operation.signal);
      if(mounted.current&&operation.current()){setResult(outcome);setCloseConfirmed(false);}
    }catch(failure){if(mounted.current)setError(failure instanceof ActivationClientError?failure.message:
      retained.current?"No confirmed original result was received. Keep this exact request, check it, or explicitly close it. No automatic retry or replacement was sent.":"Recovery data could not be retained. No activation was sent.");}
    finally{operation.finish();if(mounted.current)setPending(false);}
  }
  function cancelReview(){if(pending||retained.current)return;restoreTriggerFocus.current=true;setReview(undefined);setConfirmed(false);}
  return <div className={styles.panel}>
    <section className={styles.card}><h2>One reviewed request, one original result</h2>
      <p>Activation queues a real workflow run. Eligible steps may execute immediately under their existing policies. Unsaved draft edits are excluded. Approval, rights, budget, scheduling and workspace execution controls still apply.</p>
      {current?<p>Currently observed: <strong>{current.campaignName}</strong>, published version {current.versionNumber}. This observation is not a reservation or approval.</p>:<p>No current published review is available. A retained original request can still be checked or closed.</p>}
      {current&&!current.canActivate&&<p>Writer access is required for new runs. Current members can still recover or close their own original request.</p>}
      {versionMismatch&&<p>The linked version is no longer current. <Link prefetch={false} href={`/campaigns/${campaignId}/activate?${new URLSearchParams({workspaceId,expectedVersionId:current!.versionId})}`}>Review the currently published version instead</Link>. Any retained original request remains separate.</p>}
      {!review&&(!attempt||result)&&<div className={styles.actions}><button ref={trigger} type="button" disabled={!storageReady||pending||!current?.canActivate||versionMismatch} onClick={()=>void beginReview()}>{result?"Review another deliberate run":"Review one new run"}</button></div>}
      <p>Recovery identifiers are retained in this tab before submission. Reloading never resends. Closing the tab or clearing its storage may lose the local reference, but not server history. <Link href="/campaigns">Inspect campaign runs</Link>.</p>
    </section>
    {review&&!attempt&&<section className={styles.card} aria-labelledby="activation-review-heading"><h3 id="activation-review-heading" ref={reviewHeading} tabIndex={-1}>Review published version {review.versionNumber}</h3>
      <p>{review.campaignName} · {review.autonomyMode.replaceAll("_"," ")} · {review.timezone}</p>
      <p className={styles.identity}>Version {review.versionId}</p>
      <ul>{review.steps.map(step=><li key={step.stepKey}>{step.name} — {step.operationType.replaceAll("_"," ")}, {step.scheduleType.replaceAll("_"," ")}{step.approvalRequired?", explicit step approval required":""}</li>)}</ul>
      <p>These are step summaries, not the full content or current eligibility proof. Review the published campaign and exact channel previews before queuing real work.</p>
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={pending} onChange={event=>setConfirmed(event.target.checked)}/>I want to queue one real run of this exact published version.</label>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={pending||!confirmed} onClick={()=>void run("activate")}>Activate this reviewed version</button><button type="button" disabled={pending} onClick={cancelReview}>Cancel review</button></div>
    </section>}
    {attempt&&!result&&<section className={styles.card}><h3>Original request retained</h3><p className={styles.identity}>Request {attempt.request.requestId}</p>
      <p>No confirmed outcome is displayed yet. Lookup is read-only. An empty lookup does not prove the original request cannot still finish.</p>
      <div className={styles.actions}><button type="button" disabled={pending} onClick={()=>void run("lookup")}>Check original request</button></div>
      <label className={styles.check}><input type="checkbox" checked={closeConfirmed} disabled={pending} onChange={event=>setCloseConfirmed(event.target.checked)}/>Close this original request if it has not created a run. If activation already succeeded, show its receipt; do not cancel that run.</label>
      <div className={styles.actions}><button type="button" disabled={pending||!closeConfirmed} onClick={()=>void run("close")}>Resolve and close original request</button></div>
    </section>}
    {result&&<section className={styles.card} aria-labelledby="activation-result-heading"><h3 id="activation-result-heading" ref={resultHeading} tabIndex={-1}>{result.kind==="accepted"?"Original run confirmed":"Original request closed"}</h3>
      <p className={styles.identity}>Request {result.receipt.requestId}</p>
      {result.kind==="accepted"?<><p>Originally accepted as {result.receipt.initialStatus.replaceAll("_"," ")} at {result.receipt.acceptedAt}. This receipt is historical; current progress is shown on the run page. Closing a request does not cancel an accepted run.</p><div className={styles.actions}><Link prefetch={false} href={`/campaign-instances/${result.receipt.instanceId}`}>View original run</Link></div></>:<p>Closed at {result.receipt.closedAt}. This request did not create a run and cannot create one later. No other campaign run was canceled.</p>}
      <p>Another run requires the separate fresh-review button above. Nothing restarts automatically.</p>
    </section>}
    {pending&&<p role="status">Checking one exact request or published review…</p>}{error&&<p role="alert" className="form-error">{error}</p>}
  </div>;
}
