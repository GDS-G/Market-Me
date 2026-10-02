"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceAiPolicyWrite } from "@market-me/database";
import { aiPolicyValues } from "./ai-policy-presentation";
import { makePolicySaveAttempt, persistPolicySaveAttempt, policySaveRequestFromValues, policySaveStorageKey, restorePolicySaveAttempt,
  runPolicySaveAttempt, type PolicySaveAttempt, type PolicySaveReceipt, type PolicySaveScope } from "./ai-policy-save-contract";
import styles from "./ai-policy-save.module.css";

type Props = PolicySaveScope & { policy: WorkspaceAiPolicyWrite; policyRevision: number; canEditPolicy: boolean; recoveryReady: boolean };
export function useAiPolicySaveRecovery(props: Props) {
  const [restored] = useState(() => {
    if (!props.canEditPolicy || !props.recoveryReady) return { raw: null, attempt: undefined, error: "" };
    // Keep the original raw bytes even when parsing fails: explicit clearing must compare them.
    let raw: string | null | undefined;
    try { raw = sessionStorage.getItem(policySaveStorageKey(props)); return { raw, attempt: restorePolicySaveAttempt(raw, props), error: "" }; }
    catch { return { raw, attempt: undefined, error: "Recovery data cannot be read safely. An earlier policy save may have succeeded. Restore browser storage or check current settings before clearing this local copy." }; }
  });
  const [values, setValues] = useState(() => aiPolicyValues(restored.attempt?.request ?? props.policy));
  const [attempt, setAttempt] = useState<PolicySaveAttempt | undefined>(restored.attempt);
  const [storageError, setStorageError] = useState(restored.error);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<PolicySaveReceipt | undefined>(), [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true), retained = useRef(restored.raw), exactRequest = useRef(restored.attempt);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const frozen = !props.recoveryReady || !props.canEditPolicy || pending || Boolean(attempt) || Boolean(storageError);

  async function run(lookup = false) {
    if (inFlight.current || !props.canEditPolicy || !props.recoveryReady || storageError) return;
    inFlight.current = true; setPending(true); setError(""); setResult(undefined); setConfirmed(false);
    try {
      let exact = exactRequest.current;
      if (!exact) {
        if (lookup) return;
        exact = makePolicySaveAttempt(props, policySaveRequestFromValues(props, props.policyRevision, crypto.randomUUID(), values));
      }
      try {
        // Synchronous storage verification and ref fence precede every network await.
        exact = persistPolicySaveAttempt(sessionStorage, props, exact);
        retained.current = JSON.stringify(exact); exactRequest.current = exact; setAttempt(exact); setValues(aiPolicyValues(exact.request));
      } catch {
        setStorageError("Recovery storage could not retain this request safely. Nothing was sent by this action. Reload to recover an earlier request or restore browser storage."); return;
      }
      const receipt = await runPolicySaveAttempt(sessionStorage, props, exact, lookup);
      if (mounted.current) setResult(receipt);
    } catch (failure) {
      if (mounted.current) setError(exactRequest.current
        ? `${failure instanceof Error && failure.message.length < 1_200 ? failure.message : "No confirmed result was received."} Your exact request is retained. Check its result or retry that same request.`
        : "Review the caps, currency and alert percentages. Caps must be positive with at most two decimal places; alerts must be one to five ascending, unique integers from 1 through 100. Nothing was sent.");
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }
  function reset() {
    if (!confirmed || inFlight.current || !props.canEditPolicy || !props.recoveryReady) return;
    try {
      const key = policySaveStorageKey(props), current = sessionStorage.getItem(key);
      // A failed initial read does not authorize deleting an unknown later-visible request.
      if (retained.current === undefined || current !== retained.current) throw new Error("Recovery data changed or was not read safely.");
      sessionStorage.removeItem(key);
      if (sessionStorage.getItem(key) !== null) throw new Error("Recovery storage was not cleared.");
      inFlight.current = true; setPending(true); window.location.reload();
    } catch { setStorageError("The saved request could not be cleared safely. Reload before trying again; no new request was sent."); }
  }
  return { values, setValues, attempt, storageError, pending, error, result, confirmed, setConfirmed, frozen, run, reset };
}
export function AiPolicySaveRecovery({ recovery }: { recovery: ReturnType<typeof useAiPolicySaveRecovery> }) {
  const { attempt, storageError, pending, error, result, confirmed, setConfirmed, run, reset } = recovery;
  return <div className={styles.recovery}>
    {(attempt || storageError) && <section className={styles.notice} aria-label="Saved AI policy request">
      <h3>Saved AI policy request</h3>
      <p>{attempt ? `Request ${attempt.request.requestId} · loaded policy revision ${attempt.request.expectedRevision}` : "Unreadable recovery data"}</p>
      <p>Editing is locked while this request is retained. A missing result does not prove the save failed. Checking is read-only; retrying reuses the exact identifier, settings and revision.</p>
      <div className={styles.actions}>
        <button type="button" disabled={pending || Boolean(storageError) || !attempt} onClick={() => void run(true)}>Check saved policy result</button>
        <button type="button" disabled={pending || Boolean(storageError) || !attempt} onClick={() => void run()}>Retry same policy request</button>
      </div>
      <label className={styles.consent}><input type="checkbox" disabled={pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I checked for earlier success and understand that clearing this local copy does not cancel a save that may still finish.</span></label>
      <button type="button" disabled={pending || !confirmed} onClick={reset}>Clear local policy request and reload settings</button>
    </section>}
    {storageError && <p role="alert" className="form-error">{storageError}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {pending && <p role="status">Checking your exact policy request…</p>}
    {result && <section className={styles.result} role="status"><h3>Confirmed original policy save</h3>
      <p>Saved revision {result.revision} · request {result.requestId}.</p>
      <p>This receipt confirms the retained settings shown above, not the current policy. Later edits may already exist. Saving policy does not run AI, authorize spending or open an execution window.</p>
      <a href="/ai-settings" className="button-secondary">Reload current policy and costs</a>
    </section>}
    <p className={styles.help}>The exact policy settings and identifier stay in this browser tab, scoped to this account and workspace. Closing the tab may lose the local copy. Server receipts remain unless the workspace is erased or a restore predates the request. No credentials are retained here.</p>
  </div>;
}
