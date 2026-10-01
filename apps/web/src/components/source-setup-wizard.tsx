"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { normalizeSourceSetup, SOURCE_SETUP_FILE_TYPES, SOURCE_SETUP_IGNORED_FOLDERS, type SourceSetupInput } from "@market-me/domain";
import type { SourceSetupReceipt } from "@market-me/database";
import { createSourceSetupAttempt, isSourceSetupFolderPage, isSourceSetupReceipt, restoreSourceSetupAttempt,
  sourceSetupResultPath, sourceSetupStorageKey, type SourceSetupAttempt, type SourceSetupFolderPage, type SourceSetupScope } from "./source-setup-request";
import { SourceSetupReview } from "./source-setup-review";
import styles from "./source-setup.module.css";

export interface SourceSetupProps extends SourceSetupScope {
  connections: readonly { id: string; name: string; provider: "google_drive" | "onedrive" | "sharepoint" }[];
  companions: readonly { id: string; name: string; health: string }[];
  contextPacks: readonly { id: string; expectedVersionId: string; name: string; versionNumber: number }[];
}
type Folder = { providerLocationId: string; name: string };
const stepNames = ["Connection", "Folder", "Intake rules", "Review & save"];
const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function initialInput(workspaceId: string): SourceSetupInput {
  return { workspaceId, requestId: crypto.randomUUID(), name: "", provider: "google_drive", storageConnectionId: "",
    location: { providerLocationId: "", displayPath: "" }, recursive: true, readinessMode: "immediate",
    stabilizationWindowSeconds: 120, fileTypes: ["images", "documents", "presentations", "spreadsheets"],
    ignoredFolders: ["Archive", "Drafts", "Internal"], contextPacks: [], autonomyMode: "approval_required" };
}
function safeMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return fallback;
  const error = payload.error;
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.length <= 500 ? error.message : fallback;
}

export function SourceSetupWizard(props: SourceSetupProps) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  return hydrated ? <SourceSetupEditor key={`${props.workspaceId}:${props.userId}`} {...props} /> : <p role="status">Loading source setup and any saved request…</p>;
}

function SourceSetupEditor(props: SourceSetupProps) {
  const storageKey = sourceSetupStorageKey(props);
  const [restored] = useState(() => {
    try { return { attempt: restoreSourceSetupAttempt(sessionStorage.getItem(storageKey), props), error: "" }; }
    catch { return { attempt: undefined, error: "The saved request could not be read safely. Check your existing sources before clearing it; an earlier save may have succeeded." }; }
  });
  const [attempt, setAttempt] = useState<SourceSetupAttempt | undefined>(restored.attempt);
  const [values, setValues] = useState<SourceSetupInput>(() => restored.attempt?.input ?? initialInput(props.workspaceId));
  const [step, setStep] = useState(restored.attempt ? 3 : 0);
  const [storageError, setStorageError] = useState(restored.error);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<SourceSetupReceipt>();
  const [reviewed, setReviewed] = useState(false);
  const [rootConfirmed, setRootConfirmed] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [trail, setTrail] = useState<Folder[]>([]);
  const [folderPage, setFolderPage] = useState<SourceSetupFolderPage>();
  const [manualLocation, setManualLocation] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const options = props.connections.filter((connection) => connection.provider === values.provider);
  const rootSelected = values.location.providerLocationId === "root" || values.location.providerLocationId.endsWith(":root");
  const connectionName = values.provider === "local" ? props.companions.find((item) => item.id === values.location.providerLocationId)?.name ?? "Previously selected desktop"
    : props.connections.find((item) => item.id === values.storageConnectionId)?.name ?? "Previously selected connection";
  const contextNames = values.contextPacks.map((selected) => {
    const pack = props.contextPacks.find((item) => item.id === selected.id && item.expectedVersionId === selected.expectedVersionId);
    return pack ? `${pack.name} · v${pack.versionNumber}` : "Previously selected Context Pack (refresh required for a new setup)";
  });
  function change<K extends keyof SourceSetupInput>(key: K, value: SourceSetupInput[K]) {
    if (inFlight.current || attempt) return;
    setValues((previous) => ({ ...previous, [key]: value })); setReviewed(false); setError("");
  }
  function chooseProvider(provider: SourceSetupInput["provider"]) {
    if (inFlight.current || attempt) return;
    setValues((current) => ({ ...current, provider, storageConnectionId: provider === "local" ? undefined : "", location: { providerLocationId: "", displayPath: "" } }));
    setTrail([]); setFolderPage(undefined); setManualLocation(""); setManualLabel(""); setRootConfirmed(false); setError("");
  }
  function chooseConnection(id: string) {
    change("storageConnectionId", id); change("location", { providerLocationId: "", displayPath: "" });
    setTrail([]); setFolderPage(undefined); setRootConfirmed(false); setManualLocation(""); setManualLabel("");
  }
  function advance() {
    if (inFlight.current || attempt || storageError) return;
    setError("");
    try {
      if (step === 0 && (values.name.trim().length < 2 || values.name.trim().length > 120)) throw new Error("Give your source a name between 2 and 120 characters.");
      if (step === 0 && values.provider !== "local" && !options.some((item) => item.id === values.storageConnectionId)) throw new Error("Choose an active storage connection, or connect one first.");
      if (step === 1 && !values.location.providerLocationId) throw new Error("Explicitly choose the folder or paired desktop to use.");
      if (step === 1 && rootSelected && !rootConfirmed) throw new Error("Confirm the broad root-folder scope before continuing.");
      if (step === 2) setValues(normalizeSourceSetup(values));
      setStep((current) => Math.min(3, current + 1)); setReviewed(false);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) { setError(error instanceof Error ? error.message : "Review the setup settings."); }
  }
  async function browse(nextTrail: Folder[], cursor?: string) {
    if (inFlight.current || attempt || values.provider === "local" || !values.storageConnectionId) return;
    const current = nextTrail.at(-1);
    if (!current) return;
    inFlight.current = true; setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/smart-sources/setup/browse", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: props.workspaceId, connectionId: values.storageConnectionId,
          provider: values.provider, locationId: current.providerLocationId, ...(cursor ? { cursor } : {}) }) });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok || !isSourceSetupFolderPage(payload?.data)) throw new Error(safeMessage(payload, "Folder browsing could not complete. Try opening the folder again."));
      setTrail(nextTrail); setFolderPage(payload.data);
      setValues((previous) => ({ ...previous, location: { providerLocationId: "", displayPath: "" } }));
      setRootConfirmed(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Folder browsing failed. No source was created."); }
    finally { inFlight.current = false; setPending(false); }
  }
  function chooseCurrentFolder() {
    const folder = trail.at(-1);
    if (!folder || !folderPage) return;
    change("location", { providerLocationId: folder.providerLocationId, displayPath: trail.map((item) => item.name).join(" / ") });
    setRootConfirmed(false);
  }
  function selectManualFolder() {
    try {
      const candidate = normalizeSourceSetup({ ...values, location: { providerLocationId: manualLocation, displayPath: manualLabel },
        readinessMode: "immediate", fileTypes: ["documents"], contextPacks: [] });
      change("location", candidate.location); setRootConfirmed(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Review the advanced folder reference."); }
  }
  function reset() {
    if (inFlight.current || !resetConfirmed) return;
    try {
      sessionStorage.removeItem(storageKey);
      setAttempt(undefined); setReceipt(undefined); setValues(initialInput(props.workspaceId)); setStep(0);
      setStorageError(""); setError(""); setMessage(""); setReviewed(false); setRootConfirmed(false); setResetConfirmed(false);
      setTrail([]); setFolderPage(undefined); setManualLocation(""); setManualLabel("");
    } catch { setStorageError("Browser storage is unavailable. No new setup request was sent."); }
  }
  async function save(checkOnly = false) {
    if (inFlight.current || storageError || (!attempt && (!reviewed || step !== 3))) return;
    inFlight.current = true; setPending(true); setError(""); setMessage("");
    try {
      let exact = attempt;
      if (!exact) {
        if (checkOnly) return;
        exact = createSourceSetupAttempt(props, values);
        try { sessionStorage.setItem(storageKey, JSON.stringify(exact)); }
        catch { setStorageError("Browser storage is unavailable. No request was sent. Restore session storage access before saving."); return; }
        setAttempt(exact);
      }
      const response = await fetch(checkOnly
        ? `/api/v1/smart-sources/setup?${new URLSearchParams({ workspaceId: exact.input.workspaceId, requestId: exact.input.requestId })}`
        : "/api/v1/smart-sources/setup", checkOnly ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exact.input) });
      const payload = await response.json().catch(() => undefined);
      const result = checkOnly ? payload?.data : payload?.data?.receipt;
      if (response.ok && isSourceSetupReceipt(result, exact.input)) { setReceipt(result); return; }
      if (checkOnly && response.ok && result === null) {
        setMessage("No committed result is visible yet. An earlier request may still be processing. Retry these same settings safely; do not assume the earlier save failed."); return;
      }
      throw new Error(safeMessage(payload, "The save result could not be confirmed. Check the saved result or retry the same settings."));
    } catch (error) { setError(error instanceof Error ? error.message : "Connection interrupted. Check the saved result before starting another setup."); }
    finally { inFlight.current = false; setPending(false); }
  }

  return <div className={styles.setup}>
    <ol className={styles.steps} aria-label="Source setup progress">{stepNames.map((name, index) => <li key={name} aria-current={index === step ? "step" : undefined}>{index + 1}. {name}</li>)}</ol>
    {(storageError || error || message) && <div role={storageError || error ? "alert" : "status"} className={`${styles.notice} ${storageError || error ? styles.error : ""}`}>{storageError || error || message}</div>}
    {receipt ? <section className={`${styles.panel} ${styles.success}`} aria-label="Saved source result">
      <h2>{receipt.name} was created paused</h2><p>This is the original creation receipt. The source may have been edited or enabled since then; open its current configuration to check. Retrying this request never resets or creates it again.</p>
      <Link className={styles.primary} href={sourceSetupResultPath(receipt)}>Continue to source configuration</Link>
    </section> : <form onSubmit={(event) => { event.preventDefault(); if (step < 3) advance(); else void save(); }}>
      <section className={styles.panel}>
        <h2 ref={heading} tabIndex={-1}>{stepNames[step]}</h2>
        <fieldset className={styles.fieldset} disabled={pending || Boolean(attempt) || Boolean(storageError)}>
          {step === 0 && <>
            <p>Start with one content location. Your source will stay paused while you finish setting it up.</p>
            <label className={styles.field}>Source name<input maxLength={120} value={values.name} onChange={(event) => change("name", event.target.value)} placeholder="Product launches" autoComplete="off" /></label>
            <div className={styles.grid}><label className={styles.field}>Where does your content live?<select value={values.provider} onChange={(event) => chooseProvider(event.target.value as SourceSetupInput["provider"])}>
              <option value="google_drive">Google Drive</option><option value="onedrive">OneDrive</option><option value="sharepoint">SharePoint</option><option value="local">Paired desktop folder</option>
            </select></label>{values.provider !== "local" && <label className={styles.field}>Connected account<select value={values.storageConnectionId ?? ""} onChange={(event) => chooseConnection(event.target.value)}>
              <option value="">Choose an account</option>{options.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select></label>}</div>
            {values.provider !== "local" && !options.length && <p>No active connection is available for this provider. <Link href="/integrations">Connect storage</Link>, then reload this page.</p>}
            {values.provider === "sharepoint" && <p>SharePoint folder browsing currently starts from an explicit library reference. Automatic site/library discovery is not available yet.</p>}
          </>}
          {step === 1 && <>
            <p>Choose only the folder you want this source to monitor. Opening folders lists their names; it does not scan content or enable monitoring.</p>
            {values.provider === "local" ? <>
              <label className={styles.field}>Paired desktop<select value={values.location.providerLocationId} onChange={(event) => change("location", { providerLocationId: event.target.value, displayPath: "Approved companion folder" })}>
                <option value="">Choose a paired desktop</option>{props.companions.map((worker) => <option value={worker.id} key={worker.id}>{worker.name} · {worker.health}</option>)}
              </select></label><p>The filesystem path stays on the desktop. After saving, explicitly bind an approved folder in the companion. This web page cannot browse your computer or grant path access.</p>
              {!props.companions.length && <p>No paired desktop is available. <Link href="/companion">Open companion setup</Link>.</p>}
            </> : <>
              {values.provider === "sharepoint" ? <div className={styles.grid}><label className={styles.field}>Library and starting folder reference<input value={manualLocation} onChange={(event) => setManualLocation(event.target.value)} placeholder="driveId:root" /></label><label className={styles.field}>Library label<input value={manualLabel} onChange={(event) => setManualLabel(event.target.value)} placeholder="Marketing library" /></label>
                <button className={styles.secondary} type="button" disabled={!manualLocation || !manualLabel} onClick={() => void browse([{ providerLocationId: manualLocation, name: manualLabel }])}>Open library folder</button></div>
                : <button className={styles.secondary} type="button" onClick={() => void browse([{ providerLocationId: "root", name: values.provider === "google_drive" ? "My Drive" : "OneDrive" }])}>Browse connected drive</button>}
              {trail.length > 0 && <div>
                <nav className={styles.breadcrumbs} aria-label="Folder path">{trail.map((folder, index) => <button type="button" key={`${index}:${folder.providerLocationId}`} onClick={() => void browse(trail.slice(0, index + 1))}>{folder.name}</button>)}</nav>
                {folderPage && <><p>{folderPage.folders.length} folders on this page. Files are hidden in the folder picker.</p>
                  {folderPage.incompleteSearch && <p role="status">The provider reports incomplete results. This list is not a complete inventory.</p>}
                  <ul className={styles.folderList}>{folderPage.folders.map((folder) => <li key={folder.providerLocationId}><button className={styles.secondary} type="button" onClick={() => void browse([...trail, folder])}>Open {folder.name}</button></li>)}</ul>
                  <div className={styles.actions}><button className={styles.secondary} type="button" onClick={chooseCurrentFolder}>Use this folder</button>{folderPage.nextCursor && <button className={styles.secondary} type="button" onClick={() => void browse(trail, folderPage.nextCursor)}>Next folder page</button>}</div>
                </>}
              </div>}
              <details className={styles.advanced}><summary>Advanced: enter a known folder reference</summary><p>For a shared drive or a folder outside this list. Access is not verified by entering an ID.</p>
                <div className={styles.grid}><label className={styles.field}>Folder reference<input value={manualLocation} onChange={(event) => setManualLocation(event.target.value)} /></label><label className={styles.field}>Folder label<input value={manualLabel} onChange={(event) => setManualLabel(event.target.value)} /></label></div>
                <button className={styles.secondary} type="button" onClick={selectManualFolder}>Use entered folder</button>
              </details>
            </>}
            {values.location.providerLocationId && <div className={styles.notice}><strong>Selected: {values.location.displayPath}</strong></div>}
            {rootSelected && <label className={styles.check}><input type="checkbox" checked={rootConfirmed} onChange={(event) => setRootConfirmed(event.target.checked)} /><span>I intend to select this drive/library root. Including subfolders may cover the entire accessible drive or library.</span></label>}
            <label className={styles.check}><input type="checkbox" checked={values.recursive} onChange={(event) => change("recursive", event.target.checked)} /><span>Include subfolders inside the selected location</span></label>
          </>}
          {step === 2 && <>
            <p>These choices translate into the existing intake rules. You can inspect advanced settings after saving.</p>
            <h3>Which file types should be included?</h3><div className={styles.choices}>{SOURCE_SETUP_FILE_TYPES.map((type) => <label className={styles.check} key={type}><input type="checkbox" checked={values.fileTypes.includes(type)} onChange={(event) => change("fileTypes", event.target.checked ? [...values.fileTypes, type] : values.fileTypes.filter((item) => item !== type))} /><span>{type[0].toUpperCase() + type.slice(1)}</span></label>)}</div>
            <p>Video and audio can be indexed, but transcription, captioning and full media understanding are not included in this setup.</p>
            <h3>Ignore files inside these folders</h3><div className={styles.choices}>{SOURCE_SETUP_IGNORED_FOLDERS.map((folder) => <label className={styles.check} key={folder}><input type="checkbox" checked={values.ignoredFolders.includes(folder)} onChange={(event) => change("ignoredFolders", event.target.checked ? [...values.ignoredFolders, folder] : values.ignoredFolders.filter((item) => item !== folder))} /><span>{folder}</span></label>)}</div>
            <p>Temporary Office files are also ignored. Exclusions filter eligible files; they do not guarantee that a provider will omit folder metadata from a scan.</p>
            <div className={styles.grid}><label className={styles.field}>When is content ready?<select value={values.readinessMode} onChange={(event) => {
              change("readinessMode", event.target.value as SourceSetupInput["readinessMode"]);
              if (event.target.value === "related_files" && values.relatedFileMinimum === undefined) change("relatedFileMinimum", 2);
              if (event.target.value === "ready_marker" && !values.readyMarker) change("readyMarker", "READY");
            }}><option value="immediate">Each file after it settles</option><option value="related_files">Wait for supporting files</option><option value="ready_marker">Wait for a ready marker</option></select></label>
              <label className={styles.field}>Let files settle for<select value={values.stabilizationWindowSeconds} onChange={(event) => change("stabilizationWindowSeconds", Number(event.target.value))}><option value={30}>30 seconds</option><option value={120}>2 minutes — recommended</option><option value={300}>5 minutes</option><option value={900}>15 minutes</option></select></label>
              {values.readinessMode === "related_files" && <label className={styles.field}>Minimum related files<input type="number" min={1} max={100} value={values.relatedFileMinimum ?? 2} onChange={(event) => change("relatedFileMinimum", Number(event.target.value))} /></label>}
              {values.readinessMode === "ready_marker" && <label className={styles.field}>Ready marker<input maxLength={100} value={values.readyMarker ?? "READY"} onChange={(event) => change("readyMarker", event.target.value)} /><small>Uses the existing filename/metadata marker rule, not arbitrary instructions.</small></label>}
            </div>
            <h3>Optional Context Packs</h3>{props.contextPacks.length ? props.contextPacks.map((pack) => <label className={styles.check} key={pack.id}><input type="checkbox" checked={values.contextPacks.some((item) => item.id === pack.id)} onChange={(event) => change("contextPacks", event.target.checked ? [...values.contextPacks, { id: pack.id, expectedVersionId: pack.expectedVersionId }] : values.contextPacks.filter((item) => item.id !== pack.id))} /><span>{pack.name} · published v{pack.versionNumber}</span></label>) : <p>No published Context Packs are available. You can add one later.</p>}
            <label className={styles.field}>How should results be handled?<select value={values.autonomyMode} onChange={(event) => change("autonomyMode", event.target.value as SourceSetupInput["autonomyMode"])}><option value="approval_required">Review required</option><option value="draft_only">Draft only</option></select><small>Source setup does not create marketing drafts or send content. Optional draft preparation is configured separately. Autonomous sending is not enabled here.</small></label>
          </>}
        </fieldset>
        {step === 3 && <SourceSetupReview input={values} connectionName={connectionName} contextNames={contextNames} />}
        {step === 3 && !attempt && <label className={styles.check}><input type="checkbox" disabled={pending || Boolean(storageError)} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the selected scope and understand this saves a paused source.</span></label>}
        {!attempt && <div className={styles.actions}>
          {step > 0 && <button className={styles.secondary} type="button" disabled={pending || Boolean(storageError)} onClick={() => { setStep((current) => current - 1); setReviewed(false); setError(""); }}>Back</button>}
          {step < 3 ? <button className={styles.primary} type="button" disabled={pending || Boolean(storageError)} onClick={advance}>Continue</button>
            : <button className={styles.primary} type="submit" disabled={pending || !reviewed || Boolean(storageError)}>Save paused source</button>}
        </div>}
      </section>
    </form>}
    {attempt && !receipt && <section className={styles.notice} aria-label="Recover source setup"><h3>Resume the exact saved request</h3><p>These settings are locked because a save may have succeeded. Check the result or retry the same request; both preserve its identity, even after a reload.</p><div className={styles.actions}>
      <button type="button" className={styles.secondary} disabled={pending || Boolean(storageError)} onClick={() => void save(true)}>Check saved result</button>
      <button type="button" className={styles.primary} disabled={pending || Boolean(storageError)} onClick={() => void save()}>Retry same settings</button>
    </div></section>}
    {(attempt || storageError) && <details className={styles.advanced}><summary>Start a separate setup</summary><p>This does not cancel an earlier request or delete a source. A separate request can create another source. Check existing sources first.</p>
      <label className={styles.check}><input type="checkbox" disabled={pending} checked={resetConfirmed} onChange={(event) => setResetConfirmed(event.target.checked)} /><span>I understand an earlier request may already have created a source.</span></label>
      <button type="button" className={styles.secondary} disabled={pending || !resetConfirmed} onClick={reset}>Start a separate setup</button>
    </details>}
    {pending && <p role="status">Working… Your selections are locked until this request finishes.</p>}
  </div>;
}
