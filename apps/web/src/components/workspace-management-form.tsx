"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { makeWorkspaceAttempt, normalizeWorkspaceName, persistWorkspaceAttempt, restoreWorkspaceAttempt, runWorkspaceAttempt,
  workspaceStorageKey, type WorkspaceAttempt, type WorkspaceReceipt, type WorkspaceScope } from "./workspace-management-contract";
import styles from "./workspace-management.module.css";

export type WorkspaceFormProps = WorkspaceScope & { organizationName: string; currentName?: string; revision?: number };
const subscribe = () => () => {}, browser = () => true, server = () => false;
export function WorkspaceManagementForm(props: WorkspaceFormProps) {
  return useSyncExternalStore(subscribe, browser, server)
    ? <WorkspaceEditor key={`${workspaceStorageKey(props)}:${props.revision ?? 0}`} {...props} />
    : <p role="status">Loading saved workspace requests…</p>;
}
function WorkspaceEditor(props: WorkspaceFormProps) {
  const storageKey = workspaceStorageKey(props);
  const [restored] = useState(() => {
    try { const raw = sessionStorage.getItem(storageKey); return { raw, attempt: restoreWorkspaceAttempt(raw, props), error: "" }; }
    catch { return { raw: undefined, attempt: undefined, error: "Recovery data cannot be read safely. Check existing workspaces before clearing it; an earlier request may have succeeded." }; }
  });
  const [attempt, setAttempt] = useState<WorkspaceAttempt | undefined>(restored.attempt);
  const [storageError, setStorageError] = useState(restored.error);
  const [name, setName] = useState(restored.attempt?.request.name ?? props.currentName ?? "");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<WorkspaceReceipt | undefined>(), [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true), retained = useRef(restored.raw);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const frozen = pending || Boolean(attempt) || Boolean(storageError);

  async function run(lookup = false) {
    if (inFlight.current || storageError) return;
    inFlight.current = true; setPending(true); setError(""); setResult(undefined);
    let exact = attempt;
    try {
      if (!exact) {
        if (lookup) return;
        const values = { requestId: crypto.randomUUID(), name: normalizeWorkspaceName(name) };
        exact = makeWorkspaceAttempt(props, props.operation === "create"
          ? { operation: "create", organizationId: props.organizationId, ...values }
          : { operation: "rename", workspaceId: props.workspaceId, expectedRevision: props.revision ?? 0, ...values });
      }
      try {
        // Freeze the exact locally retained request before sending; failure means no network call.
        persistWorkspaceAttempt(sessionStorage, props, exact); retained.current = JSON.stringify(exact); setAttempt(exact); setName(exact.request.name);
      } catch {
        setStorageError("Recovery storage could not retain this request safely. Nothing was sent by this action. Reload to recover any earlier request, or restore browser storage."); return;
      }
      const saved = await runWorkspaceAttempt(sessionStorage, props, exact, lookup);
      if (mounted.current) setResult(saved);
    } catch (failure) {
      if (mounted.current) setError(attempt || retained.current
        ? `${failure instanceof Error && failure.message.length < 1_200 ? failure.message : "No confirmed result was received."} Your saved request is retained. Check its result or retry that same request.`
        : "Review the workspace name and current settings. No request was sent.");
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }
  function reset() {
    if (!confirmed || inFlight.current) return;
    try {
      const current = sessionStorage.getItem(storageKey);
      // Never discard a different request that appeared after this form loaded.
      if (retained.current !== undefined && current !== retained.current) throw new Error("Recovery data changed; reload before clearing it.");
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error("Recovery storage was not cleared.");
      inFlight.current = true; setPending(true);
      // A full read obtains the current revision and authority; stale props are never reused.
      window.location.reload();
    } catch { setStorageError("The saved request could not be cleared safely. Reload before trying again; no new request was sent."); }
  }
  return <div className={styles.editor}>
    {(attempt || storageError) && <section className={styles.notice} aria-label="Saved workspace request">
      <h3>Saved workspace request</h3>
      <p>{attempt ? `${attempt.request.operation} · ${attempt.request.name} · request ${attempt.request.requestId}` : "Unreadable recovery data"}</p>
      <p>Editing is locked while this request is retained. A missing result does not prove the earlier request failed. Checking is read-only; retrying reuses the exact request identifier and settings.</p>
      <div className={styles.actions}>
        <button type="button" disabled={pending || Boolean(storageError) || !attempt} onClick={() => void run(true)}>Check saved result</button>
        <button type="button" disabled={pending || Boolean(storageError) || !attempt} onClick={() => void run()}>Retry same request</button>
      </div>
      <label className={styles.consent}><input type="checkbox" disabled={pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I checked for earlier success and understand a separate request could create another workspace or rename it again.</span></label>
      <button type="button" disabled={pending || !confirmed} onClick={reset}>Clear local request and reload settings</button>
    </section>}
    <form onSubmit={event => { event.preventDefault(); void run(); }}>
      <fieldset className={styles.fieldset} disabled={frozen}>
        <legend><h3>{props.operation === "create" ? "Create an empty workspace" : "Rename this workspace"}</h3></legend>
        <WorkspaceManagementBoundary operation={props.operation} organizationName={props.organizationName} revision={props.revision} />
        <label className="field"><span>Workspace display name</span><input required maxLength={120} value={name} onChange={event => setName(event.target.value)} autoComplete="off" />
          <small>1–120 characters. Leading, trailing and repeated spaces are normalized.</small></label>
        <button type="submit" className="button-primary">{props.operation === "create" ? "Create workspace" : "Save workspace name"}</button>
      </fieldset>
    </form>
    {storageError && <p role="alert" className="form-error">{storageError}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {pending && <p role="status">Checking your exact workspace request…</p>}
    {result && <section className={styles.result} role="status"><h3>Confirmed original result</h3>
      <p>{result.operation === "create" ? "Created" : "Renamed"} “{result.name}” · settings revision {result.revision}.</p>
      <p>Workspace ID: {result.workspaceId}</p><p>This receipt describes the original outcome, not the current name or your current access. Your active workspace has not been switched.</p>
      <a href="/settings" className="button-secondary">Reload current settings and workspace choices</a>
      {result.operation === "create" && <p>Then select the new workspace in the sidebar and choose Switch workspace. Access is checked again when switching.</p>}
    </section>}
    <p className={styles.help}>The exact name and request identifier are retained for this account and scope in this browser tab. Closing the tab may lose this local recovery copy. Server receipts remain unless their workspace or organization is erased, or a restore predates the request. No credentials are stored.</p>
  </div>;
}
export function WorkspaceManagementBoundary({ operation, organizationName, revision }: { operation: "create" | "rename"; organizationName: string; revision?: number }) {
  return <div className={styles.boundary}><p>Organization: <strong>{organizationName}</strong></p>{operation === "create"
    ? <p>You will be its only workspace owner. It starts with one default Brand and UTC timezone; no other members, content, provider connections, profiles or automation are copied. Creation does not switch your current workspace.</p>
    : <p>Loaded settings revision: {revision}. Only the display name changes. Workspace ID, internal slug, timezone, Brand/Profile names, content and member permissions stay unchanged.</p>}</div>;
}
