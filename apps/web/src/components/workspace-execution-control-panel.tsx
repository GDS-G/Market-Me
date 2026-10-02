"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createExecutionControlGate, ExecutionControlClientError, EXECUTION_CONTROL_BROWSER_LIMITS, loadExecutionSnapshot,
  makeExecutionAttempt, parseExecutionSnapshot, runExecutionAttempt,
  type ExecutionControlAttempt, type ExecutionControlReceipt, type ExecutionControlScope, type ExecutionControlSnapshot } from "./workspace-execution-control-contract";
import styles from "./workspace-execution-control-panel.module.css";

type Props = ExecutionControlScope & { initial: ExecutionControlSnapshot };
export function WorkspaceExecutionControlPanel(props: Props) {
  return <ExecutionEditor key={JSON.stringify([props.userId, props.workspaceId, props.initial.canManage,
    props.initial.canManage ? props.initial.actorIncarnationId : null])} {...props} />;
}
function ExecutionEditor({ userId, workspaceId, initial }: Props) {
  const scope = { userId, workspaceId }, router = useRouter();
  const [current, setCurrent] = useState<ExecutionControlSnapshot | undefined>(() => parseExecutionSnapshot(initial, scope));
  const [preview, setPreview] = useState<ExecutionControlSnapshot>(), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<ExecutionControlAttempt>(), [result, setResult] = useState<ExecutionControlReceipt>();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [gate] = useState(createExecutionControlGate), mounted = useRef(true), retained = useRef<ExecutionControlAttempt | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null), resultHeading = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gate.cancel(); }; }, [gate]);
  useEffect(() => { if (preview && !attempt) heading.current?.focus(); }, [preview, attempt]);
  useEffect(() => { if (result) resultHeading.current?.focus(); }, [result]);
  async function load(review: boolean) {
    if (review && retained.current && !result) return;
    const operation = gate.begin(); if (!operation) return;
    setPending(true); setError("");
    try {
      const next = await loadExecutionSnapshot(scope, operation.signal);
      if (mounted.current && operation.current()) {
        setCurrent(next);
        if (review) {
          if (!next.canManage) throw new ExecutionControlClientError("Current workspace administration is required. Reload after an access change.");
          retained.current = undefined; setAttempt(undefined); setResult(undefined);
          setPreview(next); setReason(""); setConfirmed(false);
        }
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ExecutionControlClientError ? failure.message : "Current state could not be loaded. No change was sent; check any original request before another action.");
    } finally { operation.finish(); if (mounted.current) setPending(false); }
  }
  async function run(lookup: boolean) {
    if (!lookup && (retained.current || !confirmed || !preview?.canManage)) return;
    const operation = gate.begin(); if (!operation) return;
    setPending(true); setError("");
    try {
      const exact = retained.current ?? (!lookup && preview ? makeExecutionAttempt(scope, preview, crypto.randomUUID(), reason) : undefined);
      if (!exact) throw new ExecutionControlClientError("Review current state before making a change.");
      retained.current = exact; setAttempt(exact); setCurrent(undefined);
      const receipt = await runExecutionAttempt(exact, scope, lookup, operation.signal);
      if (mounted.current && operation.current()) {
        setResult(receipt); router.refresh();
        try {
          const latest = await loadExecutionSnapshot(scope, operation.signal);
          if (mounted.current && operation.current()) setCurrent(latest);
        } catch {
          if (mounted.current) setError("The original change is confirmed, but current state could not be refreshed. Read current state before reviewing another change.");
        }
      }
    } catch (failure) {
      if (mounted.current) setError(operation.signal.aborted
        ? "The response was interrupted or timed out. The change may already have committed; check the original result without resending."
        : failure instanceof ExecutionControlClientError ? failure.message : "No confirmed result was received. Check the original request before another action.");
    } finally { operation.finish(); if (mounted.current) setPending(false); }
  }
  const reopening = preview?.state === "paused";
  return <div className={styles.panel}>
    <section className={styles.state} aria-label="Observed workspace execution state">
      <h2>{current ? current.state === "paused" ? "Workspace execution is paused" : "Workspace execution hold is off" : "Current state needs verification"}</h2>
      {current && <><p>Revision {current.revision} · last changed <time dateTime={current.changedAt}>{current.changedAt}</time> (UTC).</p>
        {current.canManage && current.reason && <p>Last change reason: {current.reason}</p>}
        <p>{current.state === "paused" ? "New publishing, companion claims and billable AI text attempts are blocked in this workspace."
          : "This additional hold is absent. Every normal approval, schedule, budget, rights and execution control still applies."}</p></>}
      <div className={styles.actions}><button type="button" disabled={pending} onClick={() => void load(false)}>Read current execution state</button>
        {current?.canManage && (!attempt || result) && <button type="button" ref={trigger} disabled={pending || current.revision >= EXECUTION_CONTROL_BROWSER_LIMITS.revision}
          className={current.state === "open" ? styles.danger : undefined} onClick={() => void load(true)}>{current.state === "open" ? "Review workspace pause" : "Review workspace reopening"}</button>}</div>
      {current && !current.canManage && <p>Only a current workspace owner or administrator can change this hold. Contact your workspace administrator.</p>}
      {current && current.revision >= EXECUTION_CONTROL_BROWSER_LIMITS.revision && <p role="alert">The revision limit is exhausted. New changes cannot be submitted.</p>}
    </section>
    <section className={styles.notice}><h2>What this control does</h2>
      <p>This is a workspace-wide admission hold, not a deployment-wide shutdown. It does not delete campaigns, approvals, drafts, queues, connections or history.</p>
      <p>Already-admitted work may finish. A pause cannot recall delivered content, cancel an already-admitted provider request or stop an already-open companion browser action. Reconciliation and actual-cost settlement remain available.</p>
      <p>Reopening only removes this hold. It does not enable stopped AI, reactivate workers or connections, restore member access, approve work, revive expired schedules or restart individually paused campaigns.</p>
      <p>Campaign steps marked Execution held need an explicit campaign Resume after reopening. Their current policy and scheduling requirements are checked again. An uncertain prior provider outcome never authorizes a resend.</p>
    </section>
    {preview?.canManage && !attempt && <form className={styles.notice} aria-label="Confirm workspace execution change" onSubmit={event => { event.preventDefault(); void run(false); }}>
      <h3 ref={heading} tabIndex={-1}>{reopening ? "Review reopening this workspace" : "Review pausing this workspace"}</h3>
      <p>Change {preview.state === "open" ? "hold off → paused" : "paused → hold off"}, from revision {preview.revision}. This review will be rejected if the state or your grant changes.</p>
      <label className={styles.reason}>Reason for this execution change<input value={reason} maxLength={EXECUTION_CONTROL_BROWSER_LIMITS.reason} required autoComplete="off" disabled={pending}
        onChange={event => setReason(event.target.value)} aria-describedby="execution-reason-help" /></label>
      <p id="execution-reason-help">1–500 characters, retained in the audit. Do not include credentials or unnecessary personal information.</p>
      <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />
        <span>{reopening ? "I understand this removes only the workspace hold; other controls and paused campaigns remain unchanged."
          : "I understand this blocks new admissions in this workspace, but already-admitted work may finish."}</span></label>
      <div className={styles.actions}><button type="submit" className={reopening ? undefined : styles.danger} disabled={pending || !confirmed || !reason.trim()}>{reopening ? "Reopen workspace execution" : "Pause workspace execution"}</button>
        <button type="button" disabled={pending} onClick={() => { setPreview(undefined); setConfirmed(false); setReason(""); trigger.current?.focus(); }}>Cancel execution review</button></div>
    </form>}
    {attempt && <section className={styles.notice} aria-label="Original execution-change request"><h3>Original execution-change request</h3>
      <p>Request {attempt.request.requestId} · intended state {attempt.request.state} · reviewed revision {attempt.request.expectedRevision}.</p>
      <p>Checking is read-only and never repeats the change. An absent result does not prove the request failed. No new change can be reviewed here until this original result is confirmed.</p>
      <button type="button" disabled={pending} onClick={() => void run(true)}>Check original execution result</button>
      <p>This exact intent stays only in this open panel&apos;s memory. Reloading, changing account/workspace or leaving loses the local reference; server receipts remain.</p>
    </section>}
    {pending && <p role="status">Checking workspace execution…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <section className={styles.notice} role="status"><h3 ref={resultHeading} tabIndex={-1}>Confirmed original execution change</h3>
      <p>{result.previousState} → {result.state}, revision {result.revision}, at <time dateTime={result.changedAt}>{result.changedAt}</time> (UTC).</p>
      <p>This receipt is historical. Later authorized changes may have changed current state; checking this receipt never reapplies it.</p>
    </section>}
    <a href="/settings/execution">Reload execution settings</a>
  </div>;
}
