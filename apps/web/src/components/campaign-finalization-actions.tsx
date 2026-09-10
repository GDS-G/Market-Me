"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { preparationUuid } from "./campaign-preparation-request";

export function finalizationVersionRequest(workspaceId: string, expectedVersionId: string): string {
  return JSON.stringify({ workspaceId: preparationUuid.parse(workspaceId), expectedVersionId: preparationUuid.parse(expectedVersionId) });
}
export function CampaignFinalizationActions({ workspaceId, campaignId, versionId, state }: {
  workspaceId: string; campaignId: string; versionId: string; state: "draft" | "published";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [activationSent, setActivationSent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false);
  async function run() {
    if (inFlight.current || (state === "published" && (!confirmed || activationSent))) return;
    inFlight.current = true; setPending(true); setError("");
    const action = state === "draft" ? "publish" : "activate";
    if (action === "activate") setActivationSent(true);
    try {
      // Deliberately no draft PATCH/save: finalized definitions are protected.
      const response = await fetch(`/api/v1/campaigns/${preparationUuid.parse(campaignId)}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: finalizationVersionRequest(workspaceId, versionId),
      });
      const body = await response.json();
      if (!response.ok) { setError(typeof body?.error?.message === "string" ? body.error.message : "The action could not be confirmed. Review the current campaign."); return; }
      if (action === "activate") {
        const id = preparationUuid.safeParse(body?.data?.id);
        if (!id.success) throw new Error("Uncertain activation result");
        router.push(`/campaign-instances/${id.data}`);
      } else router.refresh();
    } catch { setError(action === "activate" ? "Activation may have succeeded. Check existing runs before doing anything else; this page will not resend activation."
      : "Publication could not be confirmed. Refresh the campaign; retrying this exact version cannot publish a different draft."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <section className="form-section"><div><h2>{state === "draft" ? "Publish this campaign version" : "Start one workflow run"}</h2>
    <p>{state === "draft" ? "Publishing makes the protected definition current. It does not activate a run or send content."
      : "Activation queues a real workflow run using this exact version. Its publication step still requires approval; review requests in Approvals."}</p></div>
    {state === "published" && <label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={pending || activationSent} onChange={(event) => setConfirmed(event.target.checked)} />I want to activate this exact version and queue one workflow run.</label>}
    <button type="button" className="button-primary" disabled={pending || (state === "published" && (!confirmed || activationSent))} onClick={() => void run()}>{pending ? "Submitting…" : state === "draft" ? "Publish this version" : "Activate this version"}</button>
    {pending && <p role="status">Submitting this exact version only.</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {activationSent && <p role="status">An activation was attempted. <Link href="/campaigns">Check existing runs</Link> before considering another action.</p>}
  </section>;
}
