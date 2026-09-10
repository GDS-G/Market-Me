"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredDestination } from "@market-me/database";

export function DestinationForm({ workspaceId, destination }: { workspaceId: string; destination?: StoredDestination }) {
  const router = useRouter();
  const [values, setValues] = useState({
    provider: destination?.provider ?? "manual", canonicalUrl: destination?.canonicalUrl ?? "",
    title: destination?.title ?? "", description: destination?.description ?? "",
    contentType: destination?.contentType ?? "web_page", status: destination?.status ?? "draft",
    externalId: destination?.externalId ?? "", language: destination?.language ?? "",
    topics: destination?.topics.join(", ") ?? "", audiences: destination?.audiences.join(", ") ?? "",
    geography: destination?.geography.join(", ") ?? "", identifiers: JSON.stringify(destination?.identifiers ?? {}, null, 2),
  });
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    let identifiers: Record<string, string>;
    try { identifiers = JSON.parse(values.identifiers); } catch { setError("Identifiers must be valid JSON."); setPending(false); return; }
    const body = { workspaceId, provider: values.provider, canonicalUrl: values.canonicalUrl, title: values.title,
      description: values.description, contentType: values.contentType, status: values.status,
      externalId: values.externalId || undefined, language: values.language || undefined, identifiers,
      knownRedirects: [], tracking: {}, topics: split(values.topics), audiences: split(values.audiences), geography: split(values.geography) };
    const response = await fetch(destination ? `/api/v1/destinations/${destination.id}` : "/api/v1/destinations", { method: destination ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})); setPending(false);
    if (!response.ok) { setError(payload?.error?.message ?? "Could not save the destination."); return; }
    router.push("/destinations"); router.refresh();
  }
  return <form className="resource-form" onSubmit={submit}><section className="form-section"><div><h2>Canonical identity</h2><p>Keep the stable destination separate from campaign tracking links.</p></div><div className="field-grid">
    <label className="field"><span>Title</span><input required value={values.title} onChange={(event) => set("title", event.target.value)} /></label>
    <label className="field"><span>Provider</span><input required value={values.provider} onChange={(event) => set("provider", event.target.value)} /></label>
    <label className="field field-wide"><span>HTTPS canonical URL</span><input required type="url" value={values.canonicalUrl} onChange={(event) => set("canonicalUrl", event.target.value)} /></label>
    <label className="field"><span>External ID</span><input value={values.externalId} onChange={(event) => set("externalId", event.target.value)} /></label>
    <label className="field"><span>Content type</span><input value={values.contentType} onChange={(event) => set("contentType", event.target.value)} /></label>
    <label className="field"><span>Status</span><select value={values.status} onChange={(event) => set("status", event.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="unavailable">Unavailable</option><option value="expired">Expired</option><option value="archived">Archived</option></select></label>
    <label className="field"><span>Language</span><input value={values.language} onChange={(event) => set("language", event.target.value)} placeholder="en" /></label>
    <label className="field field-wide"><span>Description</span><textarea value={values.description} onChange={(event) => set("description", event.target.value)} /></label>
    <label className="field"><span>Topics, comma separated</span><input value={values.topics} onChange={(event) => set("topics", event.target.value)} /></label>
    <label className="field"><span>Audiences, comma separated</span><input value={values.audiences} onChange={(event) => set("audiences", event.target.value)} /></label>
    <label className="field"><span>Geography, comma separated</span><input value={values.geography} onChange={(event) => set("geography", event.target.value)} /></label>
    <label className="field field-wide"><span>Business identifiers (JSON)</span><textarea value={values.identifiers} onChange={(event) => set("identifiers", event.target.value)} /></label>
  </div></section><div className="form-actions"><button className="button-primary" disabled={pending}>{pending ? "Saving…" : "Save destination"}</button>{error && <p className="form-error" role="alert">{error}</p>}</div></form>;
}

function split(value: string): string[] { return value.split(",").map((entry) => entry.trim()).filter(Boolean); }
