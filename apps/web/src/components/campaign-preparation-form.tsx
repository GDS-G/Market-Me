"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import {
  createPreparationAttempt, preparationRequest, preparationResultPath, preparationStorageKey,
  restorePreparationAttempt, type PreparationAttempt, type PreparationFormInput, type PreparationScope,
} from "./campaign-preparation-request";
import styles from "./campaign-preparation-form.module.css";

export interface PreparationPackageChoice { id: string; title: string; version: number }
export interface PreparationProfileChoice { id: string; name: string; versionNumber: number }
export interface PreparationFormProps extends PreparationScope {
  packages: readonly PreparationPackageChoice[];
  selectedPackageId?: string;
  brands: readonly PreparationProfileChoice[];
  audiences: readonly PreparationProfileChoice[];
  destinations: readonly { id: string; title: string }[];
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
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [existingId, setExistingId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const inFlight = useRef(false);

  function reset() {
    if (!resetConfirmed || inFlight.current) return;
    try {
      sessionStorage.removeItem(storageKey);
      setAttempt(undefined); setStorageError(""); setError(""); setFieldErrors([]); setExistingId(undefined);
      setMessage("Ready for a new attempt. Review the package revision and choices before preparing.");
      setResetConfirmed(false);
      const selected = props.packages.find((item) => item.id === values.contentPackageId);
      setValues((previous) => ({ ...previous, contentPackageId: selected?.id ?? "", expectedPackageVersion: selected?.version ?? 1 }));
    } catch { setStorageError("Browser storage is unavailable. No new request was sent; restore storage access before preparing."); }
  }

  async function run(checkOnly: boolean) {
    if (inFlight.current || storageError) return;
    inFlight.current = true; setPending(true); setError(""); setFieldErrors([]); setMessage(""); setExistingId(undefined);
    let exact = attempt;
    try {
      if (!exact) {
        if (checkOnly) return;
        exact = createPreparationAttempt(props, values, crypto.randomUUID());
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
    {(attempt || storageError) && <section className={styles.notice} aria-labelledby="saved-preparation-heading">
      <h2 id="saved-preparation-heading">Saved preparation attempt</h2>
      <p>The choices below are frozen for this attempt, including package revision {attempt?.input.expectedPackageVersion ?? "unknown"}. Retrying reuses the same key and settings; it does not request another campaign.</p>
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
      <PreparationFields {...props} values={values} onChange={setValues} />
    </fieldset>
    <div className="form-actions">
      <button type="submit" className="button-primary" disabled={pending || Boolean(storageError) || (!attempt && !props.packages.some((item) => item.id === values.contentPackageId))}>
        {pending ? "Checking preparation…" : attempt ? "Retry same preparation" : "Prepare campaign and drafts"}
      </button>
      <Link href="/content-packages">Review packages</Link>
    </div>
    {storageError && <p className="form-error" role="alert">{storageError}</p>}
    {error && <div className="form-error" role="alert"><p>{error}</p>{fieldErrors.length > 0 && <ul>{fieldErrors.map((field) => <li key={field}>{field}</li>)}</ul>}{existingId && <Link href={preparationResultPath(existingId, props.workspaceId)}>Open existing preparation</Link>}</div>}
    {message && <p className="form-help" role="status">{message}</p>}
    {pending && <p className="form-help" role="status">Checking your saved preparation request. Do not start another attempt while this request is pending.</p>}
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
