"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import {
  createPreparationAttempt, preparationRequest, preparationResultPath, preparationStorageKey,
  restorePreparationAttempt, type PreparationAttempt, type PreparationFormInput, type PreparationScope,
} from "./campaign-preparation-request";
import styles from "./campaign-preparation-form.module.css";
import { ApprovedPackageReviewPicker } from "./approved-package-review-picker";
import { presetErrorMessage,presetPayloadData,presetVersionSchema,readPresetResponse } from "./preparation-preset-contract";
import { CampaignPreparationPreview } from "./campaign-preparation-preview";
import { requestPreparationPreview, type PreparationPreview } from "./campaign-preparation-preview-contract";

export interface PreparationPackageChoice { id: string; title: string; version: number }
export interface PreparationProfileChoice { id: string; name: string; versionNumber: number }
export interface PreparationFormProps extends PreparationScope {
  packages: readonly PreparationPackageChoice[];
  selectedPackageId?: string;
  brands: readonly PreparationProfileChoice[];
  audiences: readonly PreparationProfileChoice[];
  destinations: readonly { id: string; title: string }[];
  preset?: { id: string; title: string; revision: number; versionNumber: number; archived: boolean };
}
const subscribeHydration = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

export function initialPreparationInput(workspaceId: string, selected?: PreparationPackageChoice): PreparationFormInput {
  return {
    workspaceId, contentPackageId: selected?.id ?? "", expectedPackageVersion: selected?.version ?? 1,
    templateKey: "general_announcement", templateVersion: 1, name: "General announcement", description: "",
    audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "informational", timezone: "UTC",
  };
}

export function CampaignPreparationForm(props: PreparationFormProps) {
  // Storage is browser-only. Mount the editor after hydration, not with a competing server attempt key.
  const hydrated = useSyncExternalStore(subscribeHydration, browserSnapshot, serverSnapshot);
  return hydrated ? <PreparationEditor key={`${props.userId}:${props.workspaceId}`} {...props} />
    : <p role="status">Loading saved preparation attempts…</p>;
}

function PreparationEditor(props: PreparationFormProps) {
  const router = useRouter();
  const storageKey = preparationStorageKey(props);
  const [restored] = useState(() => {
    try { return { attempt: restorePreparationAttempt(sessionStorage.getItem(storageKey), props), error: "" }; }
    catch { return { attempt: undefined, error: "The saved attempt could not be read safely. Check existing campaigns before clearing it; do not assume an earlier request failed." }; }
  });
  const [attempt, setAttempt] = useState<PreparationAttempt | undefined>(restored.attempt);
  const [values, setValues] = useState<PreparationFormInput>(() => restored.attempt?.input
    ?? initialPreparationInput(props.workspaceId, props.packages.find((item) => item.id === props.selectedPackageId)));
  const [storageError, setStorageError] = useState(restored.error);
  const [reviewFingerprint, setReviewFingerprint] = useState(restored.attempt?.version === 2 ? restored.attempt.expectedReviewFingerprint : "");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [existingId, setExistingId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const copySelectionKey = JSON.stringify(props.preset ?? null);
  const [copyAcknowledgement, setCopyAcknowledgement] = useState("");
  const copyConfirmed = copyAcknowledgement === copySelectionKey;
  const inFlight = useRef(false);
  const previewAbort = useRef<AbortController | undefined>(undefined);
  const previewSequence = useRef(0);
  const [previewPending, setPreviewPending] = useState(false);
  const [preview, setPreview] = useState<{ identity: string; data: PreparationPreview }>();
  const previewIdentity = JSON.stringify({ values, reviewFingerprint });
  useEffect(() => () => { previewSequence.current += 1; previewAbort.current?.abort(); }, []);

  function invalidatePreview() {
    setPreview(undefined);
    // A review refresh or input replacement can arrive after a request started.
    // Cancel that generation even if the form later returns to identical values.
    if (previewAbort.current) {
      previewSequence.current += 1; previewAbort.current.abort(); previewAbort.current = undefined;
      inFlight.current = false; setPending(false); setPreviewPending(false);
    }
  }

  async function previewPreparation() {
    if (inFlight.current || attempt || storageError || !reviewFingerprint) return;
    inFlight.current = true; setPending(true); setPreviewPending(true); setPreview(undefined); setError(""); setMessage(""); setFieldErrors([]);
    const sequence = ++previewSequence.current, controller = new AbortController(); previewAbort.current = controller;
    try {
      const data = await requestPreparationPreview(values, reviewFingerprint, controller);
      if (previewSequence.current === sequence) setPreview({ identity: previewIdentity, data });
    } catch {
      if (previewSequence.current === sequence) setError("No verified preview was received. Nothing was prepared or sent. Reload the exact approved package review, check current profile settings, and try previewing again.");
    } finally {
      if (previewSequence.current === sequence) { inFlight.current = false; previewAbort.current = undefined; setPending(false); setPreviewPending(false); }
    }
  }

  async function copyPreset() {
    if (!props.preset || props.preset.archived || !copyConfirmed || inFlight.current || attempt || storageError) return;
    inFlight.current = true; setPending(true); setCopyPending(true); setPreview(undefined); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/preparation-presets/${props.preset.id}/copy-settings`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: props.workspaceId, expectedRevision: props.preset.revision, versionNumber: props.preset.versionNumber }) });
      const payload = await readPresetResponse(response);
      if (!response.ok) { setError(presetErrorMessage(payload, "The preset is unavailable. Reload and review its current version.")); return; }
      const copied = presetVersionSchema.parse(presetPayloadData(payload));
      if (copied.workspaceId !== props.workspaceId || copied.presetId !== props.preset.id || copied.versionNumber !== props.preset.versionNumber) throw new Error("Mismatched preset copy.");
      // Rebuild settings, not a spread over old optional references: absence in
      // the preset must clear the old Brand/Destination and audience selections.
      setValues(previous => ({ workspaceId: props.workspaceId, contentPackageId: previous.contentPackageId,
        expectedPackageVersion: previous.expectedPackageVersion, ...copied.configuration }));
      setCopyAcknowledgement("");
      setMessage(`Copied “${copied.title}” v${copied.versionNumber}. Review the editable settings before preparing. Package selection and its exact review are unchanged; no preparation request was sent.`);
    } catch { setError("No validated preset settings were copied. Your current preparation settings were preserved."); }
    finally { inFlight.current = false; setPending(false); setCopyPending(false); }
  }

  function reset() {
    if (!resetConfirmed || inFlight.current) return;
    try {
      sessionStorage.removeItem(storageKey);
      setAttempt(undefined); setStorageError(""); setError(""); setFieldErrors([]); setExistingId(undefined);
      setMessage("Ready for a new attempt. Review the package revision and choices before preparing.");
      setResetConfirmed(false);
      setReviewFingerprint("");
      setPreview(undefined);
      const selected = props.packages.find((item) => item.id === values.contentPackageId);
      setValues((previous) => ({ ...previous, contentPackageId: selected?.id ?? "", expectedPackageVersion: selected?.version ?? 1 }));
    } catch { setStorageError("Browser storage is unavailable. No new request was sent; restore storage access before preparing."); }
  }

  async function run(checkOnly: boolean) {
    if (inFlight.current || storageError) return;
    inFlight.current = true; setPending(true); setPreview(undefined); setError(""); setFieldErrors([]); setMessage(""); setExistingId(undefined);
    let exact = attempt;
    try {
      if (!exact) {
        if (checkOnly) return;
        if (!reviewFingerprint) { setError("Load and inspect the exact approved package review before preparing new work."); return; }
        exact = createPreparationAttempt(props, values, crypto.randomUUID(), reviewFingerprint);
        // A failed persistence write must never be followed by a POST that cannot be recovered.
        try { sessionStorage.setItem(storageKey, JSON.stringify(exact)); }
        catch { setStorageError("Browser storage is unavailable. No request was sent; restore storage access before preparing."); return; }
        setAttempt(exact);
      }
      const response = await fetch(checkOnly
        ? `/api/v1/campaign-preparations?workspaceId=${encodeURIComponent(exact.input.workspaceId)}&idempotencyKey=${encodeURIComponent(exact.idempotencyKey)}`
        : "/api/v1/campaign-preparations", checkOnly ? { cache: "no-store" } : {
          method: "POST", headers: { "content-type": "application/json" }, body: preparationRequest(exact),
        });
      const payload = await response.json().catch(() => undefined);
      if (response.ok && payload?.data?.workspaceId === props.workspaceId && typeof payload.data.id === "string") {
        router.push(preparationResultPath(payload.data.id, props.workspaceId));
        return;
      }
      if (checkOnly && response.status === 404) {
        setMessage("No completed preparation was found yet. An earlier request may still finish. Check again or retry this same saved request.");
        return;
      }
      setError(typeof payload?.error?.message === "string" ? payload.error.message : "The result is uncertain. Check for a completed preparation or retry the same saved request.");
      if (Array.isArray(payload?.error?.fields)) {
        setFieldErrors(payload.error.fields.flatMap((field: { field?: unknown; message?: unknown } | null) => field && typeof field.message === "string"
          ? [`${typeof field.field === "string" ? `${field.field}: ` : ""}${field.message}`] : []));
      }
      if (typeof payload?.error?.existingPreparationId === "string") {
        try { preparationResultPath(payload.error.existingPreparationId, props.workspaceId); setExistingId(payload.error.existingPreparationId); } catch { /* Never navigate to an unvalidated response path. */ }
      }
    } catch {
      setError(exact ? "The result is uncertain. Your exact attempt key and settings are saved in this tab. Check the result or retry the same request."
        : "Check the required package, name, and copy controls. No request was sent.");
    } finally { inFlight.current = false; setPending(false); }
  }

  return <form className="resource-form" onSubmit={(event) => { event.preventDefault(); void run(false); }}>
    {props.preset && <section className={styles.notice} aria-label="Copy preparation preset">
      <h2>Selected preset: {props.preset.title} · v{props.preset.versionNumber}</h2>
      <p>Copying replaces the unsaved reusable settings below, but never a saved recovery attempt, package selection, package approval, Campaign or source binding. Later preset changes do not follow these copied values.</p>
      {props.preset.archived ? <p>This preset is archived; restore it before making a new copy.</p> : <>
        <label className="checkbox-row"><input type="checkbox" checked={copyConfirmed} disabled={pending || Boolean(attempt) || Boolean(storageError)} onChange={event => setCopyAcknowledgement(event.target.checked ? copySelectionKey : "")} />Replace my unsaved reusable preparation settings with this saved preset version.</label>
        <button type="button" disabled={pending || Boolean(attempt) || Boolean(storageError) || !copyConfirmed} onClick={() => void copyPreset()}>Copy preset settings into this form</button>
      </>}
      <Link href="/campaigns/presets">Review preset library</Link>
    </section>}
    {(attempt || storageError) && <section className={styles.notice} aria-labelledby="saved-preparation-heading">
      <h2 id="saved-preparation-heading">Saved preparation attempt</h2>
      <p>The choices below are frozen for this attempt, including package revision {attempt?.input.expectedPackageVersion ?? "unknown"}. Retrying reuses the same key and settings; it does not request another campaign.</p>
      {attempt?.version === 2 ? <p style={{ overflowWrap: "anywhere" }}>Saved original package review fingerprint: <code>{attempt.expectedReviewFingerprint}</code></p>
        : <p>This legacy attempt has no original review fingerprint. Only an already completed legacy receipt can be recovered; creating new work requires a new exact approved review.</p>}
      {attempt && <p><small>Attempt {attempt.idempotencyKey}</small></p>}
      <div className={styles.actions}>
        <button type="button" disabled={pending || Boolean(storageError)} onClick={() => void run(true)}>Check saved result</button>
        <Link href="/campaigns">View campaigns</Link>
        {attempt && <Link href={`/content-packages/${attempt.input.contentPackageId}`}>Review current package</Link>}
      </div>
      <label className="checkbox-row"><input type="checkbox" checked={resetConfirmed} disabled={pending} onChange={(event) => setResetConfirmed(event.target.checked)} />I understand a previous attempt may have succeeded. I want a separate new preparation or corrected settings.</label>
      <button type="button" disabled={pending || !resetConfirmed} onClick={reset}>Prepare another / change settings</button>
    </section>}
    <fieldset className={styles.fieldset} disabled={pending || Boolean(attempt) || Boolean(storageError)}>
      <legend className="sr-only">Campaign preparation settings</legend>
      <PreparationFields {...props} values={values} onChange={(next) => { invalidatePreview(); if (next.contentPackageId !== values.contentPackageId) setReviewFingerprint(""); setValues(next); }} />
    </fieldset>
    {!attempt && !storageError && <ApprovedPackageReviewPicker key={`${props.workspaceId}:${values.contentPackageId}`} workspaceId={props.workspaceId} packageId={values.contentPackageId} disabled={pending}
      onReview={(review) => { invalidatePreview(); setReviewFingerprint(review?.reviewFingerprint ?? ""); if (review) setValues((previous) => ({ ...previous, expectedPackageVersion: review.version })); }} />}
    {!attempt && !storageError && preview?.identity === previewIdentity && <CampaignPreparationPreview preview={preview.data} />}
    <div className="form-actions">
      {!attempt && <button type="button" className="button-secondary" disabled={pending || Boolean(storageError) || !reviewFingerprint || !props.packages.some(item => item.id === values.contentPackageId)} onClick={() => void previewPreparation()}>
        {previewPending ? "Building unsaved preview…" : "Preview campaign and drafts"}
      </button>}
      <button type="submit" className="button-primary" disabled={pending || Boolean(storageError) || (!attempt && (!reviewFingerprint || !props.packages.some((item) => item.id === values.contentPackageId)))}>
        {previewPending ? "Previewing only…" : copyPending ? "Copying preset settings…" : pending ? "Checking preparation…" : attempt ? "Retry same preparation" : "Prepare campaign and drafts"}
      </button>
      <Link href="/content-packages">Review packages</Link>
    </div>
    {storageError && <p className="form-error" role="alert">{storageError}</p>}
    {error && <div className="form-error" role="alert"><p>{error}</p>{fieldErrors.length > 0 && <ul>{fieldErrors.map((field) => <li key={field}>{field}</li>)}</ul>}{existingId && <Link href={preparationResultPath(existingId, props.workspaceId)}>Open existing preparation</Link>}</div>}
    {message && <p className="form-help" role="status">{message}</p>}
    {pending && <p className="form-help" role="status">{previewPending ? "Reading approved evidence and building an unsaved preview. No campaign, draft or spending record is created." : copyPending ? "Validating and copying reusable settings only. No campaign preparation request is being sent." : "Checking your saved preparation request. Do not start another attempt while this request is pending."}</p>}
    <p className="form-help">Only preparation choices and an attempt ID are saved in this browser tab, scoped to your user and workspace. No credentials are stored. Closing the tab clears its recovery copy; the server receipt remains available.</p>
  </form>;
}

export function PreparationFields({ values, onChange, packages, brands, audiences, destinations }: PreparationFormProps & {
  values: PreparationFormInput; onChange: (value: PreparationFormInput) => void;
}) {
  const selected = packages.find((item) => item.id === values.contentPackageId);
  return <section className="form-section"><div><h2>General Announcement · template v1</h2><p>Creates an awareness campaign and one draft per selected audience. No account, attachment, approval, or execution is selected.</p></div>
    <div className="field-grid">
      <label className="field field-wide"><span>Approved Content Package</span><select required value={values.contentPackageId} onChange={(event) => { const next = packages.find((item) => item.id === event.target.value); onChange({ ...values, contentPackageId: next?.id ?? "", expectedPackageVersion: next?.version ?? 1 }); }}>
        <option value="">Choose an approved package</option>
        {values.contentPackageId && !selected && <option value={values.contentPackageId}>Previously selected package · saved revision {values.expectedPackageVersion}</option>}
        {packages.map((item) => <option key={item.id} value={item.id}>{item.id === values.contentPackageId && item.version !== values.expectedPackageVersion ? `Saved package · v${values.expectedPackageVersion}` : `${item.title} · v${item.version}`}</option>)}
      </select>{values.contentPackageId && <small>Preparing saved revision {values.expectedPackageVersion}.{selected && selected.version !== values.expectedPackageVersion ? ` The current package is revision ${selected.version} (${selected.title}); this saved request still uses revision ${values.expectedPackageVersion}.` : ""} A changed package requires a new reviewed choice.</small>}</label>
      <label className="field"><span>Campaign name</span><input required maxLength={200} value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} /></label>
      <label className="field"><span>Timezone</span><input required maxLength={100} value={values.timezone} onChange={(event) => onChange({ ...values, timezone: event.target.value })} aria-describedby="preparation-timezone-help" /><small id="preparation-timezone-help">For example UTC or America/Chicago. This does not schedule a run.</small></label>
      <label className="field field-wide"><span>Description (optional)</span><textarea maxLength={5_000} value={values.description} onChange={(event) => onChange({ ...values, description: event.target.value })} /></label>
      <label className="field"><span>Published Brand Profile version (optional)</span><select value={values.brandProfileVersionId ?? ""} onChange={(event) => { const next = { ...values }; delete next.brandProfileVersionId; onChange(event.target.value ? { ...next, brandProfileVersionId: event.target.value } : next); }}>
        <option value="">No Brand Profile</option>
        {values.brandProfileVersionId && !brands.some((item) => item.id === values.brandProfileVersionId) && <option value={values.brandProfileVersionId}>Saved Brand version is no longer current</option>}
        {brands.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.versionNumber}</option>)}
      </select></label>
      <label className="field"><span>Published Destination (optional)</span><select value={values.destinationId ?? ""} onChange={(event) => { const next = { ...values }; delete next.destinationId; onChange(event.target.value ? { ...next, destinationId: event.target.value } : next); }}>
        <option value="">No Destination</option>
        {values.destinationId && !destinations.some((item) => item.id === values.destinationId) && <option value={values.destinationId}>Saved Destination is unavailable</option>}
        {destinations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select><small>Captured as historical context; linking or publishing still requires a later approved preview.</small></label>
      <fieldset className={`${styles.audiences} field-wide`}><legend>Published Audience Profile versions (optional)</legend>
        <p>No selection produces one General audience draft. Selected audiences retain selection order.</p>
        {values.audienceProfileVersionIds.filter((id) => !audiences.some((item) => item.id === id)).map((id) => <label key={id}><input type="checkbox" checked onChange={() => onChange({ ...values, audienceProfileVersionIds: values.audienceProfileVersionIds.filter((value) => value !== id) })} />Saved Audience version is no longer current ({id})</label>)}
        {audiences.map((item) => <label key={item.id}><input type="checkbox" checked={values.audienceProfileVersionIds.includes(item.id)} onChange={(event) => onChange({ ...values, audienceProfileVersionIds: event.target.checked ? [...values.audienceProfileVersionIds, item.id] : values.audienceProfileVersionIds.filter((id) => id !== item.id) })} />{item.name} · v{item.versionNumber}</label>)}
        {!audiences.length && <Link href="/audience">Manage published profiles</Link>}
      </fieldset>
      <label className="field"><span>Information depth</span><select value={values.informationDepth} onChange={(event) => onChange({ ...values, informationDepth: event.target.value as PreparationFormInput["informationDepth"] })}>{INFORMATION_DEPTHS.filter((value) => value !== "custom").map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="field"><span>Promotional strength</span><select value={values.promotionalStrength} onChange={(event) => onChange({ ...values, promotionalStrength: event.target.value as PreparationFormInput["promotionalStrength"] })}>{PROMOTIONAL_STRENGTHS.filter((value) => value !== "custom").map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><small>Published profile ceilings still apply; preparation never overrides them.</small></label>
    </div>
  </section>;
}
