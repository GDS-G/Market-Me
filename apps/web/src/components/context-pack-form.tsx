"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContextFactStatus, ContextSourceKind } from "@market-me/domain";
import type { StoredContextPack } from "@market-me/database";

type SourceDraft = {
  clientKey: string;
  kind: ContextSourceKind;
  sourceItemId: string;
  label: string;
  sourceReference: string;
  selectedSections: string;
  authorityRank: number;
  contentText: string;
};

type FactDraft = {
  factKey: string;
  valueText: string;
  sourceClientKey: string;
  confidence: string;
  status: ContextFactStatus;
  notes: string;
};

type RuleDraft = {
  factKey: string;
  preferredSourceId: string;
  resolution: "prefer_authority" | "require_review";
};

function sourceDraft(clientKey = crypto.randomUUID()): SourceDraft {
  return {
    clientKey,
    kind: "manual_text",
    sourceItemId: "",
    label: "",
    sourceReference: `manual:${clientKey}`,
    selectedSections: "",
    authorityRank: 50,
    contentText: "",
  };
}

function derivedUuid(seed: string, index: number): string {
  const compact = seed.replaceAll("-", "");
  const suffix = (BigInt(`0x${compact.slice(-12)}`) + BigInt(index)).toString(16).padStart(12, "0").slice(-12);
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${suffix}`;
}

function initialValues(pack: StoredContextPack | undefined, sourceIdSeed: string) {
  const version = pack?.draftVersion ?? pack?.currentVersion;
  const cloningPublished = Boolean(pack?.currentVersion && !pack.draftVersion);
  const sourceIdMap = new Map<string, string>();
  const sources = version?.sources.map((source, index) => {
    const clientKey = cloningPublished ? derivedUuid(sourceIdSeed, index) : source.id;
    sourceIdMap.set(source.id, clientKey);
    return {
      clientKey,
      kind: source.kind,
      sourceItemId: source.sourceItemId ?? "",
      label: source.label,
      sourceReference: source.sourceReference,
      selectedSections: source.selectedSections.join("\n"),
      authorityRank: source.authorityRank,
      contentText: source.contentText ?? "",
    } satisfies SourceDraft;
  }) ?? [sourceDraft(sourceIdSeed)];
  return {
    name: pack?.name ?? "",
    description: pack?.description ?? "",
    instructions: version?.instructions ?? "",
    sources,
    facts: version?.facts.map((fact) => ({
      factKey: fact.factKey,
      valueText: JSON.stringify(fact.value, null, 2),
      sourceClientKey: fact.sourceId ? sourceIdMap.get(fact.sourceId) ?? "" : "",
      confidence: fact.confidence === undefined ? "" : String(fact.confidence),
      status: fact.status,
      notes: fact.notes ?? "",
    } satisfies FactDraft)) ?? [],
    rules: version?.authorityRules.map((rule) => ({
      factKey: rule.factKey,
      preferredSourceId: sourceIdMap.get(rule.preferredSourceIds[0] ?? "") ?? "",
      resolution: rule.resolution,
    } satisfies RuleDraft)) ?? [],
  };
}

export function ContextPackForm({ workspaceId, sourceIdSeed, pack }: { workspaceId: string; sourceIdSeed: string; pack?: StoredContextPack }) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(pack, sourceIdSeed));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function updateSource(index: number, patch: Partial<SourceDraft>) {
    setValues((current) => ({ ...current, sources: current.sources.map((source, position) => position === index ? { ...source, ...patch } : source) }));
  }

  function updateFact(index: number, patch: Partial<FactDraft>) {
    setValues((current) => ({ ...current, facts: current.facts.map((fact, position) => position === index ? { ...fact, ...patch } : fact) }));
  }

  function updateRule(index: number, patch: Partial<RuleDraft>) {
    setValues((current) => ({ ...current, rules: current.rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule) }));
  }

  function requestBody() {
    return {
      workspaceId,
      name: values.name,
      description: values.description,
      instructions: values.instructions,
      sources: values.sources.map((source) => ({
        clientKey: source.clientKey,
        kind: source.kind,
        sourceItemId: source.kind === "source_item" ? source.sourceItemId : undefined,
        label: source.label,
        sourceReference: source.sourceReference,
        selectedSections: source.selectedSections.split("\n").map((value) => value.trim()).filter(Boolean),
        authorityRank: source.authorityRank,
        contentText: source.kind === "manual_text" ? source.contentText : undefined,
      })),
      facts: values.facts.map((fact) => ({
        factKey: fact.factKey,
        value: JSON.parse(fact.valueText),
        sourceClientKey: fact.sourceClientKey || undefined,
        confidence: fact.confidence === "" ? undefined : Number(fact.confidence),
        status: fact.status,
        notes: fact.notes || undefined,
      })),
      authorityRules: values.rules.map((rule) => ({
        factKey: rule.factKey,
        preferredSourceIds: [rule.preferredSourceId],
        resolution: rule.resolution,
      })),
    };
  }

  async function save(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    let body: ReturnType<typeof requestBody>;
    try {
      body = requestBody();
    } catch {
      setError("Every fact value must be valid JSON, such as a quoted string, number, array, or object.");
      setPending(false);
      return undefined;
    }
    const response = await fetch(pack ? `/api/v1/context-packs/${pack.id}` : "/api/v1/context-packs", {
      method: pack ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fields = payload?.error?.fields ? Object.values(payload.error.fields).flat().join(" ") : "";
      setError(fields || payload?.error?.message || "Could not save the Context Pack.");
      setPending(false);
      return undefined;
    }
    setMessage(pack ? "Draft saved." : "Context Pack created.");
    setPending(false);
    if (!pack) router.push(`/context-packs/${payload.data.id}/edit`);
    router.refresh();
    return payload.data as StoredContextPack;
  }

  async function publish() {
    const saved = await save();
    if (!saved || !pack) return;
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/context-packs/${pack.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload?.error?.message || "Could not publish the Context Pack.");
    else setMessage(`Published version ${payload.data.currentVersion.versionNumber}.`);
    setPending(false);
    router.refresh();
  }

  return (
    <form className="resource-form" onSubmit={save}>
      <section className="form-section">
        <div><h2>Purpose</h2><p>Name the approved knowledge set and explain where it should guide content.</p></div>
        <div className="field-grid">
          <label className="field"><span>Name</span><input required minLength={2} value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field field-wide"><span>Description</span><textarea value={values.description} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="field field-wide"><span>Instructions</span><textarea value={values.instructions} onChange={(event) => setValues((current) => ({ ...current, instructions: event.target.value }))} placeholder="State approved terminology, constraints, and how this context should be applied." /></label>
        </div>
      </section>

      <section className="form-section">
        <div><h2>Sources</h2><p>References are versioned. Selected sections and authority rank help reviewers understand intended use.</p></div>
        <div className="field-grid">
          {values.sources.map((source, index) => <div className="form-subsection field-wide" key={source.clientKey}>
            <label className="field"><span>Source type</span><select value={source.kind} onChange={(event) => updateSource(index, { kind: event.target.value as ContextSourceKind })}><option value="manual_text">Approved text</option><option value="url">HTTPS reference</option><option value="source_item">Ingested source item</option></select></label>
            <label className="field"><span>Label</span><input required value={source.label} onChange={(event) => updateSource(index, { label: event.target.value })} /></label>
            <label className="field field-wide"><span>Reference</span><input required value={source.sourceReference} onChange={(event) => updateSource(index, { sourceReference: event.target.value })} placeholder={source.kind === "url" ? "https://…" : "Stable reference"} /></label>
            {source.kind === "source_item" && <label className="field"><span>Source item UUID</span><input required value={source.sourceItemId} onChange={(event) => updateSource(index, { sourceItemId: event.target.value })} /></label>}
            {source.kind === "manual_text" && <label className="field field-wide"><span>Approved source text</span><textarea required value={source.contentText} onChange={(event) => updateSource(index, { contentText: event.target.value })} /></label>}
            <label className="field"><span>Authority rank</span><input type="number" min={0} max={100} value={source.authorityRank} onChange={(event) => updateSource(index, { authorityRank: Number(event.target.value) })} /></label>
            <label className="field"><span>Selected sections, one per line</span><textarea value={source.selectedSections} onChange={(event) => updateSource(index, { selectedSections: event.target.value })} /></label>
            {values.sources.length > 1 && <button className="button-secondary" type="button" onClick={() => setValues((current) => ({ ...current, sources: current.sources.filter((_, position) => position !== index) }))}>Remove source</button>}
          </div>)}
          <button className="button-secondary" type="button" onClick={() => setValues((current) => ({ ...current, sources: [...current.sources, sourceDraft()] }))}>Add source</button>
        </div>
      </section>

      <section className="form-section">
        <div><h2>Structured facts</h2><p>Facts remain tied to their source. Conflicts require review unless an explicit authority rule selects a source.</p></div>
        <div className="field-grid">
          {values.facts.map((fact, index) => <div className="form-subsection field-wide" key={`${fact.factKey}-${index}`}>
            <label className="field"><span>Fact key</span><input value={fact.factKey} onChange={(event) => updateFact(index, { factKey: event.target.value })} placeholder="launch.date" /></label>
            <label className="field"><span>Source</span><select value={fact.sourceClientKey} onChange={(event) => updateFact(index, { sourceClientKey: event.target.value })}><option value="">Unresolved / no source</option>{values.sources.map((source) => <option value={source.clientKey} key={source.clientKey}>{source.label || "Untitled source"}</option>)}</select></label>
            <label className="field field-wide"><span>JSON value</span><textarea value={fact.valueText} onChange={(event) => updateFact(index, { valueText: event.target.value })} placeholder='"September 1, 2026"' /></label>
            <label className="field"><span>Status</span><select value={fact.status} onChange={(event) => updateFact(index, { status: event.target.value as ContextFactStatus })}><option value="proposed">Proposed</option><option value="accepted">Accepted</option><option value="conflicted">Conflicted</option><option value="unresolved">Unresolved</option></select></label>
            <label className="field"><span>Confidence</span><input type="number" min={0} max={1} step="0.01" value={fact.confidence} onChange={(event) => updateFact(index, { confidence: event.target.value })} /></label>
            <button className="button-secondary" type="button" onClick={() => setValues((current) => ({ ...current, facts: current.facts.filter((_, position) => position !== index) }))}>Remove fact</button>
          </div>)}
          <button className="button-secondary" type="button" onClick={() => setValues((current) => ({ ...current, facts: [...current.facts, { factKey: "", valueText: '""', sourceClientKey: "", confidence: "", status: "proposed", notes: "" }] }))}>Add fact</button>
        </div>
      </section>

      <section className="form-section">
        <div><h2>Authority rules</h2><p>Rules are explicit exceptions for named fact keys. Without one, disagreement stays in review.</p></div>
        <div className="field-grid">
          {values.rules.map((rule, index) => <div className="form-subsection field-wide" key={`${rule.factKey}-${index}`}>
            <label className="field"><span>Fact key</span><input value={rule.factKey} onChange={(event) => updateRule(index, { factKey: event.target.value })} /></label>
            <label className="field"><span>Preferred source</span><select value={rule.preferredSourceId} onChange={(event) => updateRule(index, { preferredSourceId: event.target.value })}><option value="">Choose a source</option>{values.sources.map((source) => <option value={source.clientKey} key={source.clientKey}>{source.label || "Untitled source"}</option>)}</select></label>
            <label className="field"><span>Resolution</span><select value={rule.resolution} onChange={(event) => updateRule(index, { resolution: event.target.value as RuleDraft["resolution"] })}><option value="prefer_authority">Prefer named authority</option><option value="require_review">Always require review</option></select></label>
            <button className="button-secondary" type="button" onClick={() => setValues((current) => ({ ...current, rules: current.rules.filter((_, position) => position !== index) }))}>Remove rule</button>
          </div>)}
          <button className="button-secondary" type="button" onClick={() => setValues((current) => ({ ...current, rules: [...current.rules, { factKey: "", preferredSourceId: current.sources[0]?.clientKey ?? "", resolution: "prefer_authority" }] }))}>Add authority rule</button>
        </div>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="form-actions">
        <button className="button-primary" disabled={pending} type="submit">{pending ? "Saving…" : "Save draft"}</button>
        {pack && <button className="button-secondary" disabled={pending || values.sources.length === 0} type="button" onClick={publish}>Publish version</button>}
      </div>
    </form>
  );
}
