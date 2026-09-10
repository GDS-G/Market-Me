"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DRAFT_FORMATS, type DraftFormat } from "@market-me/domain";

export function DraftGenerationForm({ workspaceId, campaigns }: { workspaceId: string; campaigns: readonly { id: string; name: string; packages: readonly { id: string; title: string }[] }[] }) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const packages = useMemo(() => campaigns.find((item) => item.id === campaignId)?.packages ?? [], [campaignId, campaigns]);
  const [packageId, setPackageId] = useState(campaigns[0]?.packages[0]?.id ?? "");
  const [draftFormat, setDraftFormat] = useState<DraftFormat>("channel_neutral");
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function generate() {
    setPending(true); setError("");
    const response = await fetch("/api/v1/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, campaignId, contentPackageId: packageId, draftFormat }) });
    const payload = await response.json().catch(() => ({})); setPending(false);
    if (!response.ok) setError(payload?.error?.message ?? "Draft generation failed.");
    else { const first = payload.data?.[0]; if (first?.id) router.push(`/drafts/${first.id}`); else router.refresh(); }
  }
  return <div className="draft-generate"><label className="field"><span>Published Campaign</span><select value={campaignId} onChange={(event) => { const next = event.target.value; setCampaignId(next); setPackageId(campaigns.find((item) => item.id === next)?.packages[0]?.id ?? ""); }}>{campaigns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Approved Content Package</span><select value={packageId} onChange={(event) => setPackageId(event.target.value)}>{packages.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label className="field"><span>Draft format</span><select value={draftFormat} onChange={(event) => setDraftFormat(event.target.value as DraftFormat)}>{DRAFT_FORMATS.map((format) => <option value={format} key={format}>{format.replaceAll("_", " ")}</option>)}</select></label><button className="button-primary" disabled={pending || !campaignId || !packageId} onClick={generate}>{pending ? "Generating…" : "Generate governed drafts"}</button>{error && <p className="form-error">{error}</p>}</div>;
}
