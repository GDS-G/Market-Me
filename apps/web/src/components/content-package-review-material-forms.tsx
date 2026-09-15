"use client";

import { useState } from "react";
import { CONTENT_ASSET_RIGHTS_CHANNELS } from "@market-me/domain";
import type { ContentPackageReviewSnapshotV1 } from "@market-me/database";
import styles from "./content-package-review.module.css";

type Asset = ContentPackageReviewSnapshotV1["assets"][number];
type Mutation = (path: string, method: "POST" | "PATCH" | "PUT", changes: Record<string, unknown>) => Promise<void>;
interface Choice { id: string; name: string; status: string }
export interface PackageRightsChoices { channelConnections: readonly (Choice & { provider: string })[]; campaigns: readonly Choice[]; brandProfiles: readonly Choice[] }

export function initialPackageRightsInput(asset: Asset) {
  const rights = asset.rights;
  return { status: rights.status === "cleared" ? "cleared" as const : "restricted" as const, owner: rights.owner ?? "", licenseOwner: rights.licenseOwner ?? "",
    sourceReference: rights.sourceReference ?? "", proofReference: rights.proofReference ?? "", commercialUseAllowed: rights.commercialUseAllowed ?? false,
    derivativeUseAllowed: rights.derivativeUseAllowed ?? false, worldwideUseAllowed: rights.worldwideUseAllowed ?? false,
    permittedChannels: [...rights.permittedChannels], permittedChannelConnectionIds: [...rights.permittedChannelConnectionIds],
    permittedCampaignIds: [...rights.permittedCampaignIds], permittedBrandProfileIds: [...rights.permittedBrandProfileIds],
    validFrom: rights.validFromUtcMicros ?? "", expiresAt: rights.expiresAtUtcMicros ?? "", attributionRequirement: rights.attributionRequirement ?? "",
    watermarkRequirement: rights.watermarkRequirement ?? "", disclaimerRequirement: rights.disclaimerRequirement ?? "", reviewNote: rights.reviewNote ?? "" };
}
type RightsInput = ReturnType<typeof initialPackageRightsInput>;
export function packageRightsRequest(values: RightsInput): Record<string, unknown> {
  return { ...values, licenseOwner: values.licenseOwner || undefined, validFrom: values.validFrom || undefined, expiresAt: values.expiresAt || undefined,
    attributionRequirement: values.attributionRequirement || undefined, watermarkRequirement: values.watermarkRequirement || undefined, disclaimerRequirement: values.disclaimerRequirement || undefined };
}
function toggle(items: readonly string[], id: string, selected: boolean) { return selected ? [...new Set([...items, id])] : items.filter((value) => value !== id); }

export function PackageReviewMaterialForms({ snapshot, canEdit, canApprove, disabled, mutate, ...choices }: PackageRightsChoices & {
  snapshot: ContentPackageReviewSnapshotV1; canEdit: boolean; canApprove: boolean; disabled: boolean; mutate: Mutation;
}) {
  return <section className={styles.sections} aria-label="Package review changes"><h2>Resolve or update this captured review</h2>
    <p>Every save compares the exact displayed revision and fingerprint, clears current approval, and resets all edit fields. No change is retried automatically.</p>
    {canApprove && snapshot.conflicts.filter((item) => item.status === "open").map((conflict) => <fieldset key={conflict.id} className={styles.fieldset} disabled={disabled}>
      <legend>Resolve conflict: {conflict.factKey}</legend><p>Select one exact active, resolved fact. Unresolved candidates must be corrected first.</p>
      <div className="form-actions">{conflict.candidateEvidenceIds.map((id) => {
        const evidence = snapshot.evidence.find((item) => item.id === id);
        return <button key={id} type="button" className="button-secondary" disabled={!evidence || Boolean(evidence.supersededByEvidenceId) || evidence.provenance === "unresolved"}
          onClick={() => void mutate(`conflicts/${conflict.id}/resolve`, "POST", { evidenceId: id })}>Use {evidence?.claim ?? `unavailable evidence ${id}`}</button>;
      })}</div>
    </fieldset>)}
    {canApprove && snapshot.evidence.filter((item) => item.provenance === "unresolved" && !item.supersededByEvidenceId).map((item) => <Correction key={item.id} evidence={item} disabled={disabled} mutate={mutate} />)}
    {canEdit && snapshot.assets.filter((asset) => asset.role === "original" && asset.mimeType.startsWith("image/")).map((asset) => <div className={styles.sections} key={asset.id}>
      <Accessibility asset={asset} disabled={disabled} mutate={mutate} /><Rights asset={asset} disabled={disabled} mutate={mutate} {...choices} />
    </div>)}
  </section>;
}
function Correction({ evidence, disabled, mutate }: { evidence: ContentPackageReviewSnapshotV1["evidence"][number]; disabled: boolean; mutate: Mutation }) {
  const [claim, setClaim] = useState(""), [note, setNote] = useState("");
  return <fieldset className={styles.fieldset} disabled={disabled}><legend>Correct unresolved fact: {evidence.factKey ?? evidence.id}</legend>
    <p>Captured claim: {evidence.claim}</p><p>A correction creates a new authoritative fact. Affected conflicts reopen and require a new explicit decision.</p>
    <label className="field"><span>Reviewed correction</span><textarea maxLength={5000} value={claim} onChange={(event) => setClaim(event.target.value)} /></label>
    <label className="field"><span>Correction note (optional)</span><textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="form-actions"><button type="button" className="button-secondary" disabled={!claim.trim()} onClick={() => void mutate(`evidence/${evidence.id}/resolve`, "POST", { correctedClaim: claim, note: note || undefined })}>Record correction</button></div>
  </fieldset>;
}
function Accessibility({ asset, disabled, mutate }: { asset: Asset; disabled: boolean; mutate: Mutation }) {
  const [altText, setAltText] = useState(asset.accessibility.altText ?? ""), [notes, setNotes] = useState(asset.accessibility.notes ?? "");
  const [decorative, setDecorative] = useState(asset.accessibility.status === "decorative");
  return <fieldset className={styles.fieldset} disabled={disabled}><legend>Accessibility: {asset.fileName}</legend>
    <label className="field"><span>Alternative text for {asset.fileName}</span><textarea maxLength={2000} disabled={decorative} value={altText} onChange={(event) => setAltText(event.target.value)} /></label>
    <label className="check-row"><input type="checkbox" checked={decorative} onChange={(event) => setDecorative(event.target.checked)} />This image is decorative</label>
    <label className="field"><span>Accessibility notes</span><textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="form-actions"><button type="button" className="button-secondary" disabled={!decorative && !altText.trim()} onClick={() => void mutate(`assets/${asset.id}`, "PATCH", { altText, decorative, notes: notes || undefined })}>Save accessibility review</button></div>
  </fieldset>;
}
const textFields = [
  ["owner", "Rights owner", 200], ["licenseOwner", "Licensed owner (optional)", 200], ["sourceReference", "Rights source reference", 1000],
  ["proofReference", "Permission proof reference", 1000], ["validFrom", "Valid from (absolute ISO time, optional)", 40], ["expiresAt", "Expires (absolute ISO time, optional)", 40],
  ["attributionRequirement", "Attribution obligation (must remain restricted)", 1000], ["watermarkRequirement", "Watermark obligation (must remain restricted)", 1000],
  ["disclaimerRequirement", "Disclaimer obligation (must remain restricted)", 1000],
] as const;
const booleanFields = [["commercialUseAllowed", "Commercial use allowed"], ["derivativeUseAllowed", "Derivative use allowed"], ["worldwideUseAllowed", "Worldwide use allowed"]] as const;
function Rights({ asset, disabled, mutate, channelConnections, campaigns, brandProfiles }: PackageRightsChoices & { asset: Asset; disabled: boolean; mutate: Mutation }) {
  const [value, setValue] = useState(() => initialPackageRightsInput(asset));
  function set<K extends keyof RightsInput>(key: K, next: RightsInput[K]) { setValue((previous) => ({ ...previous, [key]: next })); }
  return <fieldset className={styles.fieldset} disabled={disabled}><legend>Publication rights: {asset.fileName}</legend>
    <p>Editing raw original-asset permission, revision {asset.rights.revision}. Dates retain captured microseconds; use a complete value such as 2026-10-01T15:30:42.654321Z or an explicit UTC offset. Current-time eligibility is checked by the database.</p>
    <div className="field-grid"><label className="field"><span>Review outcome</span><select value={value.status} onChange={(event) => set("status", event.target.value as RightsInput["status"])}><option value="restricted">Restricted</option><option value="cleared">Cleared</option></select></label>
      {textFields.map(([key, label, maxLength]) => <label className="field" key={key}><span>{label}</span><input maxLength={maxLength} value={value[key]} onChange={(event) => set(key, event.target.value)} /></label>)}
    </div>
    <div className={styles.checks}>{booleanFields.map(([key, label]) => <label key={key}><input type="checkbox" checked={value[key]} onChange={(event) => set(key, event.target.checked)} />{label}</label>)}</div>
    <fieldset className={styles.fieldset}><legend>Permitted providers</legend><div className={styles.checks}>
      {[...new Set([...CONTENT_ASSET_RIGHTS_CHANNELS, ...value.permittedChannels])].map((provider) => <label key={provider}><input type="checkbox" checked={value.permittedChannels.includes(provider)} onChange={(event) => set("permittedChannels", toggle(value.permittedChannels, provider, event.target.checked))} />{provider.replaceAll("_", " ")}{!(CONTENT_ASSET_RIGHTS_CHANNELS as readonly string[]).includes(provider) ? " — unsupported stored scope; remove explicitly before saving" : ""}</label>)}
    </div></fieldset>
    <p>Labels below are current workspace choices, not part of the captured review. Exact selected IDs remain authoritative. Unavailable stored IDs are retained until explicitly removed.</p>
    <ScopeChoices label="Exact publishing accounts" selected={value.permittedChannelConnectionIds} choices={channelConnections.map((item) => ({ ...item, name: `${item.name} · ${item.provider}` }))} onChange={(next) => set("permittedChannelConnectionIds", next)} />
    <ScopeChoices label="Permitted Campaigns" selected={value.permittedCampaignIds} choices={campaigns} onChange={(next) => set("permittedCampaignIds", next)} />
    <ScopeChoices label="Permitted Brand Profiles" selected={value.permittedBrandProfileIds} choices={brandProfiles} onChange={(next) => set("permittedBrandProfileIds", next)} />
    <label className="field"><span>Required rights review note</span><textarea maxLength={2000} value={value.reviewNote} onChange={(event) => set("reviewNote", event.target.value)} /></label>
    <p>Clearance requires supported provider/account permission with no unverified obligations. Attachments also require a permitted exact Campaign and Brand Profile at preview and execution time.</p>
    <div className="form-actions"><button type="button" className="button-secondary" disabled={!value.owner.trim() || value.sourceReference.trim().length < 3 || value.proofReference.trim().length < 3 || value.reviewNote.trim().length < 3}
      onClick={() => void mutate(`assets/${asset.id}`, "PUT", packageRightsRequest(value))}>Save rights review</button></div>
  </fieldset>;
}
function ScopeChoices({ label, selected, choices, onChange }: { label: string; selected: readonly string[]; choices: readonly Choice[]; onChange: (next: string[]) => void }) {
  const all = [...choices, ...selected.filter((id) => !choices.some((item) => item.id === id)).map((id) => ({ id, name: "Unavailable captured scope", status: "unavailable" }))];
  return <fieldset className={styles.fieldset}><legend>{label}</legend><div className={styles.checks}>
    {all.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={item.status === "revoked" && !selected.includes(item.id)} onChange={(event) => onChange(toggle(selected, item.id, event.target.checked))} />{item.name} ({item.status}) · {item.id}</label>)}
    {!all.length && <p>No current choices are available. No scope is inferred.</p>}
  </div></fieldset>;
}
