"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import type { CampaignFinalizationTiming, ExactTextPreviewSelection } from "@market-me/database";
import { ExactPreviewDisplay } from "./exact-preview-display";
import { createFinalizationAttempt, finalizationResultPath, finalizationStorageKey, restoreFinalizationAttempt,
  selectedFinalizationInput, sendFinalizationAttempt, utcFormInstant, type FinalizationAttempt,
  type FinalizationPreviewChoice, type FinalizationScope } from "./campaign-finalization-request";
import styles from "./campaign-preparation-form.module.css";

export interface CampaignFinalizationFormProps extends FinalizationScope {
  planningVersionId: string; generationId: string; choices: readonly FinalizationPreviewChoice[];
}
const subscribeHydration = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;
export function CampaignFinalizationForm(props: CampaignFinalizationFormProps) {
  const hydrated = useSyncExternalStore(subscribeHydration, browserSnapshot, serverSnapshot);
  return hydrated ? <FinalizationEditor key={finalizationStorageKey(props)} {...props} /> : <p role="status">Loading saved finalization attempts…</p>;
}

function FinalizationEditor(props: CampaignFinalizationFormProps) {
  const router = useRouter();
  const storageKey = finalizationStorageKey(props);
  const [restored] = useState(() => {
    try { return { attempt: restoreFinalizationAttempt(sessionStorage.getItem(storageKey), props), error: "" }; }
    catch { return { attempt: undefined, error: "The saved request could not be read safely. Check this campaign's result before clearing it; an earlier request may have succeeded." }; }
  });
  const [attempt, setAttempt] = useState<FinalizationAttempt | undefined>(restored.attempt);
  const [storageError, setStorageError] = useState(restored.error);
  const [choiceId, setChoiceId] = useState("");
  const [selected, setSelected] = useState<ExactTextPreviewSelection>();
  const [timingType, setTimingType] = useState<CampaignFinalizationTiming["type"]>("immediate");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [existingId, setExistingId] = useState<string>();
  const inFlight = useRef(false);
  const selectionSequence = useRef(0);

  async function choose(id: string) {
    const sequence = ++selectionSequence.current;
    setChoiceId(id); setSelected(undefined); setConfirmed(false); setError(""); setMessage("");
    if (!id) { setSelecting(false); return; }
    setSelecting(true);
    try {
      const response = await fetch(`/api/v1/campaign-preparations/${props.preparationId}/preview-selection?workspaceId=${encodeURIComponent(props.workspaceId)}&previewId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json();
      if (sequence !== selectionSequence.current) return;
      if (!response.ok) throw new Error(typeof body?.error?.message === "string" ? body.error.message : "This preview is no longer available. Review the draft and recreate its preview.");
      const choice = props.choices.find((item) => item.id === id);
      if (!choice) throw new Error("Select an available preview.");
      selectedFinalizationInput(props, props.planningVersionId, props.generationId, choice, body.data, { type: "immediate" });
      setSelected(body.data);
    } catch (failure) {
      if (sequence === selectionSequence.current) setError(failure instanceof Error ? failure.message : "Could not read the exact preview. Select it again to retry.");
    } finally { if (sequence === selectionSequence.current) setSelecting(false); }
  }

  function reset() {
    if (!resetConfirmed || inFlight.current) return;
    try {
      sessionStorage.removeItem(storageKey); setAttempt(undefined); setStorageError(""); setError(""); setMessage(""); setExistingId(undefined);
      setChoiceId(""); setSelected(undefined); setConfirmed(false); setResetConfirmed(false);
    } catch { setStorageError("Browser storage is unavailable. No new finalization was sent."); }
  }

  async function run(checkOnly: boolean) {
    if (inFlight.current || storageError) return;
    inFlight.current = true; setPending(true); setError(""); setMessage(""); setExistingId(undefined);
    let exact = attempt;
    try {
      if (!exact) {
        if (checkOnly) return;
        const choice = props.choices.find((item) => item.id === choiceId);
        if (!selected || !choice || !confirmed) throw new Error("Review and confirm one exact preview first.");
        const timing: CampaignFinalizationTiming = timingType === "immediate" ? { type: "immediate" }
          : timingType === "exact_time" ? { type: "exact_time", scheduledAt: utcFormInstant(start) }
          : { type: "preferred_window", start: utcFormInstant(start), end: utcFormInstant(end) };
        exact = createFinalizationAttempt(props, selectedFinalizationInput(props, props.planningVersionId, props.generationId, choice, selected, timing), crypto.randomUUID());
        try { sessionStorage.setItem(storageKey, JSON.stringify(exact)); }
        catch { setStorageError("Browser storage is unavailable. No request was sent. Restore storage access before finalizing."); return; }
        setAttempt(exact);
      }
      const response = checkOnly ? await fetch(`/api/v1/campaign-finalizations?workspaceId=${encodeURIComponent(props.workspaceId)}&idempotencyKey=${encodeURIComponent(exact.idempotencyKey)}`, { cache: "no-store" })
        : await sendFinalizationAttempt(exact, props, sessionStorage);
      const body = await response.json().catch(() => undefined);
      if (response.ok && body?.data?.workspaceId === props.workspaceId && body.data.preparationId === props.preparationId && typeof body.data.id === "string") {
        router.push(finalizationResultPath(body.data.id, props.workspaceId)); return;
      }
      if (checkOnly && response.status === 404) { setMessage("No completed finalization was found yet. An earlier request may still finish. Check again or retry this same saved request."); return; }
      const fields = Array.isArray(body?.error?.fields) ? body.error.fields.flatMap((field: { field?: unknown; message?: unknown } | null) => field && typeof field.message === "string" ? [field.message] : []) : [];
      setError(`${typeof body?.error?.message === "string" ? body.error.message : "The result is uncertain. Check or retry the same saved request."}${fields.length ? ` ${fields.join(" ")}` : ""}`);
      if (typeof body?.error?.existingFinalizationId === "string") {
        try { finalizationResultPath(body.error.existingFinalizationId, props.workspaceId); setExistingId(body.error.existingFinalizationId); } catch { /* An untrusted response cannot supply a navigation URL. */ }
      }
    } catch (failure) {
      setError(exact ? "The result is uncertain. Your exact key, preview fingerprint, and timing are saved in this tab. Check the result or retry the same request."
        : failure instanceof Error ? failure.message : "Check the preview and UTC timing fields. No request was sent.");
    } finally { inFlight.current = false; setPending(false); }
  }

  return <form className="resource-form" onSubmit={(event) => { event.preventDefault(); void run(false); }}>
    {(attempt || storageError) && <section className={styles.notice}>
      <h2>Saved finalization attempt</h2><p>This attempt is frozen. Retry uses the same selected version, fingerprint, timing, and key—not a newly recreated preview.</p>
      {attempt && <><p>Preview {attempt.input.previewId}</p><p style={{ overflowWrap: "anywhere" }}>Fingerprint {attempt.input.expectedPreviewFingerprint}</p><FinalizationTimingSummary timing={attempt.input.timing} /></>}
      <p>A reloaded tab retains request identifiers and timing, not a fresh preview review. Check its result before changing choices. Completed results are also discoverable through the campaign.</p>
      <button type="button" disabled={pending || Boolean(storageError)} onClick={() => void run(true)}>Check saved result</button>
      <label className="checkbox-row"><input type="checkbox" checked={resetConfirmed} disabled={pending} onChange={(event) => setResetConfirmed(event.target.checked)} />I checked for an existing result and understand an earlier request may still complete.</label>
      <button type="button" disabled={!resetConfirmed || pending} onClick={reset}>Clear attempt and review again</button>
    </section>}
    {!attempt && <fieldset className={styles.fieldset} disabled={pending || Boolean(storageError)}>
      <legend className="sr-only">Finalization settings</legend>
      <section className="form-section"><div><h2>1. Choose one approved text preview</h2><p>Only one audience variant is selected for this executable draft. Other prepared drafts remain available for review; they are not added automatically.</p></div>
        <label className="field"><span>Approved preview and account</span><select required value={choiceId} onChange={(event) => void choose(event.target.value)}><option value="">Choose an account and audience preview</option>{props.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
        {!props.choices.length && <p>No current approved text-only previews are listed. Open a prepared draft, obtain its approval, and create a Discord, Slack, or Mastodon preview on an explicitly selected account.</p>}
        <p className="form-help">The list is a navigation aid. Selecting a preview checks current approval, exact account identity, rendering, and Destination on the server. Email, attachments, and fallback methods are not supported here.</p>
        {selecting && <p role="status">Loading the exact preview and fingerprint…</p>}
        {selected && <><ExactPreviewDisplay snapshot={selected.snapshot} fingerprint={selected.token} connectionName={selected.connectionName} />
          <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed this exact text and account. Use this one preview.</label></>}
      </section>
      <section className="form-section"><div><h2>2. Set timing</h2><p>These are execution bounds after separate publication, activation, and required approvals—not a promise of a provider delivery time.</p></div>
        <label className="field"><span>Timing</span><select value={timingType} onChange={(event) => setTimingType(event.target.value as CampaignFinalizationTiming["type"])}><option value="immediate">When activated and approved</option><option value="exact_time">At or after an exact UTC time</option><option value="preferred_window">Preferred request-start window</option></select></label>
        {timingType !== "immediate" && <label className="field"><span>{timingType === "exact_time" ? "Scheduled time (UTC)" : "Window start (UTC, inclusive)"}</span><input type="datetime-local" step="0.001" required value={start} onChange={(event) => setStart(event.target.value)} /></label>}
        {timingType === "preferred_window" && <label className="field"><span>Window end (UTC, exclusive)</span><input type="datetime-local" step="0.001" required value={end} onChange={(event) => setEnd(event.target.value)} /></label>}
        <p className="form-help">Enter UTC, independent of your browser timezone. Exact time is a not-before bound; it can run later. A preferred window bounds new provider request starts. An expired window requires attention, and cannot guarantee external completion before its end.</p>
      </section>
      <section className={styles.notice}><h2>3. Create a protected executable draft</h2><p>Finalization creates one draft version of this same campaign. It does not publish, activate, approve, or send anything. Advanced campaign edits will be blocked to preserve the exact preview proof. Prepare a separate campaign if you need different copy or timing after finalization.</p></section>
    </fieldset>}
    <div className="form-actions"><button type="submit" className="button-primary" disabled={pending || selecting || Boolean(storageError) || (!attempt && (!selected || !confirmed))}>{pending ? "Checking finalization…" : attempt ? "Retry same finalization" : "Create executable draft"}</button><Link href="/campaigns">View campaigns and existing results</Link></div>
    {storageError && <p role="alert" className="form-error">{storageError}</p>}
    {error && <div role="alert" className="form-error"><p>{error}</p>{existingId && <Link href={finalizationResultPath(existingId, props.workspaceId)}>Open existing finalization result</Link>}</div>}
    {message && <p role="status">{message}</p>}{pending && <p role="status">Checking this exact request. Do not start another attempt while it is pending.</p>}
    <p className="form-help">The recovery copy stores only user/workspace/preparation IDs, the exact request, and its attempt key in this tab. No credentials are stored. Closing the tab removes this copy, not a completed server receipt.</p>
  </form>;
}

export function FinalizationTimingSummary({ timing }: { timing: CampaignFinalizationTiming }) {
  return <p>{timing.type === "immediate" ? "Timing: when activated and approved."
    : timing.type === "exact_time" ? `Not before ${timing.scheduledAt} (UTC); later execution is possible.`
    : `Preferred request-start window: ${timing.start} inclusive → ${timing.end} exclusive (UTC). Expiry requires attention.`}</p>;
}
