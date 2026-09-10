"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredCampaignInstance } from "@market-me/database";
import { campaignInstanceControls } from "./campaign-instance-controls";

export function CampaignInstanceActions({ workspaceId, instance }: { workspaceId: string; instance: StoredCampaignInstance }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const controls = campaignInstanceControls(instance);
  async function post(url: string, body: Record<string, unknown>) {
    setPending(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) setError(payload?.error?.message ?? "Workflow command failed.");
      router.refresh();
    } catch { setError("The workflow command could not be confirmed. Refresh the run before trying again."); }
    finally { setPending(false); }
  }
  return <div className="review-actions">
    <div><span>Workflow controls</span>
      {controls.canResume && <button className="button-primary" disabled={pending} onClick={() => post(`/api/v1/campaign-instances/${instance.id}/commands`, { workspaceId, command: "resume" })}>Resume</button>}
      {controls.canPause && <button className="button-secondary" disabled={pending} onClick={() => post(`/api/v1/campaign-instances/${instance.id}/commands`, { workspaceId, command: "pause" })}>Pause</button>}
      <button className="button-secondary" disabled={pending || !controls.canCancel} onClick={() => post(`/api/v1/campaign-instances/${instance.id}/commands`, { workspaceId, command: "cancel" })}>Cancel</button>
    </div>
    {controls.scheduleBlocked && <p className="form-error" role="alert">Scheduling blocked: a permitted window was missed. Resume and manual completion cannot bypass it. Cancel this run, then publish and review a revised plan for remaining work.</p>}
    {controls.manualRuns.map((run) => <div key={run.id}>
      <label><span>Complete {run.stepName ?? run.stepKey}</span><input value={outputs[run.id] ?? "{}"} onChange={(event) => setOutputs((current) => ({ ...current, [run.id]: event.target.value }))} /></label>
      <button className="button-primary" disabled={pending} onClick={() => {
        try {
          const output: unknown = JSON.parse(outputs[run.id] ?? "{}");
          if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("not an object");
          void post(`/api/v1/campaign-instances/${instance.id}/steps/${encodeURIComponent(run.stepKey!)}/complete`, { workspaceId, output });
        } catch { setError("Manual step output must be a JSON object."); }
      }}>Record completion</button>
    </div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
