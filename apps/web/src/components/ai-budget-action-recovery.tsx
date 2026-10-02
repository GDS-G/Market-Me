"use client";

import { useEffect, useRef, useState } from "react";
import { budgetActionResultText, budgetActionStorageKey, makeBudgetActionAttempt, persistBudgetActionAttempt,
  restoreBudgetActionAttempt, runBudgetActionAttempt, type BudgetAction, type BudgetActionAttempt,
  type BudgetActionScope, type BudgetActionState } from "./ai-budget-action-contract";
import styles from "./ai-policy-save.module.css";

type Props = BudgetActionScope & { recoveryReady: boolean; canAcknowledge: boolean; canRequest: boolean; canDecide: boolean };
export function useBudgetActionRecovery(props: Props) {
  const allowed = (kind: BudgetAction["kind"]) => kind === "acknowledge_alert" ? props.canAcknowledge : kind === "request_exception" ? props.canRequest : props.canDecide;
  const [restored] = useState(() => {
    let raw: string | null | undefined;
    if (!props.recoveryReady) return { raw, attempt: undefined, error: "" };
    try { raw = sessionStorage.getItem(budgetActionStorageKey(props)); return { raw, attempt: restoreBudgetActionAttempt(raw, props), error: "" }; }
    catch { return { raw, attempt: undefined, error: "Budget-action recovery data could not be read safely. An earlier action may have completed. Restore storage or review current records before clearing this local copy." }; }
  });
  const [attempt, setAttempt] = useState<BudgetActionAttempt | undefined>(restored.attempt);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [storageError, setStorageError] = useState(restored.error);
  const [result, setResult] = useState<BudgetActionState | undefined>(), [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false), exact = useRef(restored.attempt), retained = useRef(restored.raw), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const frozen = !props.recoveryReady || pending || Boolean(attempt) || Boolean(storageError);
  const recoveryAllowed = Boolean(attempt && allowed(attempt.action.kind));
  async function run(action?: BudgetAction) {
    if (!mounted.current || !props.recoveryReady || inFlight.current || storageError || (action && exact.current)) return;
    const candidate = action ?? exact.current?.action;
    if (!candidate || !allowed(candidate.kind)) return;
    inFlight.current = true; setPending(true); setError(""); setResult(undefined); setConfirmed(false);
    try {
      const next = action ? makeBudgetActionAttempt(props, action) : exact.current!;
      try {
        const saved = persistBudgetActionAttempt(sessionStorage, props, next);
        exact.current = saved; retained.current = JSON.stringify(saved); setAttempt(saved);
      } catch { setStorageError("This action was not sent because recovery storage could not retain it safely. Reload to recover any earlier action or restore browser storage."); return; }
      const state = await runBudgetActionAttempt(sessionStorage, props, exact.current!, !action);
      if (mounted.current) setResult(state);
    } catch {
      if (mounted.current) setError(exact.current
        ? "No confirmed result was received. Your action is retained and may have completed. Check its current saved result before continuing."
        : "Review the selected estimate and explanation. Nothing was sent.");
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }
  function reset() {
    if (!mounted.current || !confirmed || inFlight.current || !props.recoveryReady || (attempt && !allowed(attempt.action.kind))) return;
    try {
      const key = budgetActionStorageKey(props), current = sessionStorage.getItem(key);
      if (retained.current === undefined || current !== retained.current) throw new Error("Recovery copy changed.");
      sessionStorage.removeItem(key);
      if (sessionStorage.getItem(key) !== null) throw new Error("Recovery copy remains.");
      inFlight.current = true; setPending(true); window.location.reload();
    } catch { setStorageError("The local copy could not be cleared safely. Reload before trying again; no new action was sent."); }
  }
  return { attempt, pending, error, storageError, result, confirmed, setConfirmed, frozen, recoveryAllowed, run, reset };
}
export function BudgetActionRecovery({ recovery }: { recovery: ReturnType<typeof useBudgetActionRecovery> }) {
  const { attempt, pending, error, storageError, result, confirmed, setConfirmed, recoveryAllowed, run, reset } = recovery;
  return <div className={styles.recovery}>
    {(attempt || storageError) && <section className={styles.notice} aria-label="Saved budget action">
      <h3>Saved budget action</h3>
      <p>{attempt ? `${attempt.action.kind.replaceAll("_", " ")} · target ${attempt.action.targetId}` : "Unreadable recovery data"}</p>
      {attempt?.action.kind === "request_exception" && <blockquote>{attempt.action.justification}</blockquote>}
      {attempt?.action.kind === "decide_exception" && <p>Requested decision: {attempt.action.decision}.</p>}
      <p>Budget actions are locked while this copy is retained. Checking is read-only and never retries the action. A missing or pending result does not prove failure.</p>
      {!recoveryAllowed && attempt && <p>Current permission is required to check this action. Its local copy is preserved.</p>}
      <div className={styles.actions}><button type="button" disabled={pending || Boolean(storageError) || !recoveryAllowed} onClick={() => run()}>Check saved budget result</button></div>
      <label className={styles.consent}><input type="checkbox" disabled={pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I reviewed the saved state and understand that clearing this local copy does not cancel an action that may still finish.</span></label>
      <button type="button" disabled={pending || !confirmed || Boolean(attempt && !recoveryAllowed)} onClick={reset}>Clear local budget action and reload</button>
    </section>}
    {storageError && <p role="alert" className="form-error">{storageError}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {pending && <p role="status">Checking budget action…</p>}
    {result && attempt && <section className={styles.result} role="status"><h3>Current saved budget result</h3>
      <p>{budgetActionResultText(attempt, result)}</p>
      <p>This is the current entity state, not a new immutable receipt. Other authorized actions may happen later.</p>
      <a href="/ai-settings" className="button-secondary">Reload current budgets and approvals</a>
    </section>}
    <p className={styles.help}>Action details, including the business explanation, stay in this browser tab under the current account and workspace. They are not encrypted; closing the tab may lose this local copy. No credentials are stored.</p>
  </div>;
}
