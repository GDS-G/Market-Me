"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { preparationUuid } from "./campaign-preparation-request";

export function finalizationVersionRequest(workspaceId: string, expectedVersionId: string): string {
  return JSON.stringify({ workspaceId: preparationUuid.parse(workspaceId), expectedVersionId: preparationUuid.parse(expectedVersionId) });
}
type Props = { workspaceId: string; campaignId: string; versionId: string; state: "draft" | "published" };
export function CampaignFinalizationActions(props: Props) {
  if (props.state === "published") {
    const query = new URLSearchParams({ workspaceId: preparationUuid.parse(props.workspaceId), expectedVersionId: preparationUuid.parse(props.versionId) });
    return <section className="form-section"><div><h2>Start one workflow run</h2>
      <p>Review this exact published version before you queue one workflow run. Its publication step still requires approval; activation does not approve it.</p></div>
      <div className="form-actions"><Link className="button-primary" prefetch={false} href={`/campaigns/${preparationUuid.parse(props.campaignId)}/activate?${query}`}>Review activation and recovery</Link></div>
    </section>;
  }
  return <PublishFinalizedVersion {...props}/>;
}
function PublishFinalizedVersion({workspaceId,campaignId,versionId}:Props) {
  const router=useRouter(),inFlight=useRef(false);
  const [pending,setPending]=useState(false),[error,setError]=useState("");
  async function publish(){
    if(inFlight.current)return;inFlight.current=true;setPending(true);setError("");
    try{
      // Deliberately no draft PATCH/save: finalized definitions are protected.
      const response=await fetch(`/api/v1/campaigns/${preparationUuid.parse(campaignId)}/publish`,{
        method:"POST",headers:{"content-type":"application/json"},body:finalizationVersionRequest(workspaceId,versionId),
      });
      if(!response.ok){setError("Publication could not be confirmed. Review the current campaign; the exact version was not changed by this page.");return;}
      router.refresh();
    }catch{setError("Publication could not be confirmed. Refresh the campaign; retrying this exact version cannot publish a different draft.");}
    finally{inFlight.current=false;setPending(false);}
  }
  return <section className="form-section"><div><h2>Publish this campaign version</h2>
    <p>Publishing makes the protected definition current. It does not activate a run or send content.</p></div>
    <div><div className="form-actions" style={{marginTop:16}}><button type="button" className="button-primary" disabled={pending} onClick={()=>void publish()}>{pending?"Submitting…":"Publish this version"}</button></div>
      {pending&&<p role="status">Submitting this exact version only.</p>}{error&&<p role="alert" className="form-error">{error}</p>}
    </div>
  </section>;
}
