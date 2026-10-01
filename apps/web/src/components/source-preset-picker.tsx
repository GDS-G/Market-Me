"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { presetErrorMessage, presetPayloadData, readPresetResponse } from "./preparation-preset-contract";
import { parseSourcePresetChoices, sourcePresetSelectionKey, type SourcePresetChoice, type SourcePresetChoices } from "./source-preset-copy";
import type { SourcePreparationBindingScope } from "./source-preparation-binding-request";
import styles from "./preparation-preset.module.css";

interface Props extends SourcePreparationBindingScope {
  disabled: boolean;
  onCopy: (choice: SourcePresetChoice) => Promise<boolean>;
}

/** Choice browsing is read-only. Applying values always requires a separate acknowledgement. */
export function SourcePresetPicker(props: Props) {
  const [choices, setChoices] = useState<SourcePresetChoices>();
  const [selectedId, setSelectedId] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const selected = choices?.items.find(item => item.id === selectedId);
  const key = selected ? sourcePresetSelectionKey(props, selected) : "";
  const acknowledged = Boolean(key) && acknowledgement === key;

  async function load(page: number) {
    if (props.disabled || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(""); setSelectedId(""); setAcknowledgement("");
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch(`/api/v1/preparation-presets/choices?workspaceId=${encodeURIComponent(props.workspaceId)}&page=${page}`,
        { cache: "no-store", signal: request.signal });
      const payload = await readPresetResponse(response);
      if (!mounted.current || request.signal.aborted) return;
      if (!response.ok) { setChoices(undefined); setError(presetErrorMessage(payload, "Preset choices could not be loaded. No source settings changed.")); return; }
      setChoices(parseSourcePresetChoices(presetPayloadData(payload), props.workspaceId, page));
    } catch {
      if (mounted.current && !request.signal.aborted) { setChoices(undefined); setError("No validated preset choices were loaded. Your source settings are unchanged."); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
      if (controller.current === request) controller.current = undefined;
    }
  }

  async function copy() {
    if (!selected || selected.archived || !acknowledged || props.disabled || inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      if (await props.onCopy(selected) && mounted.current) setAcknowledgement("");
    } catch {
      if (mounted.current) setError("The preset copy was not confirmed. Review the current source settings before trying again.");
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }

  return <section className={styles.notice} aria-label="Copy preset into source preparation">
    <h2>Reuse a preparation preset</h2>
    <p>Choose reusable values from this workspace. Copying replaces unsaved preparation settings only; it never changes source synchronization or the approval-linked enabled checkbox, saves a binding or queues work.</p>
    <div className={styles.actions}>
      <button type="button" disabled={props.disabled || pending} onClick={() => void load(1)}>{choices ? "Refresh preset choices" : "Browse preparation presets"}</button>
      <Link href="/campaigns/presets">Manage preset library</Link>
    </div>
    {choices && <>
      <label className="field"><span>Saved preparation preset</span>
        <select value={selectedId} disabled={props.disabled || pending} onChange={event => { setSelectedId(event.target.value); setAcknowledgement(""); setError(""); }}>
          <option value="">Choose a saved preset</option>
          {choices.items.map(item => <option key={item.id} value={item.id} disabled={item.archived}>{item.title} · v{item.versionNumber}{item.archived ? " · archived" : ""}</option>)}
        </select>
      </label>
      {!choices.items.length && <p>No presets on this page. Create one in the library or check another page.</p>}
      <nav className={styles.actions} aria-label="Source preset choice pages">
        <button type="button" disabled={props.disabled || pending || choices.page <= 1} onClick={() => void load(choices.page - 1)}>Previous preset page</button>
        <span>Page {choices.page} · up to 50 saved presets</span>
        <button type="button" disabled={props.disabled || pending || !choices.more || choices.page >= 2_000} onClick={() => void load(choices.page + 1)}>Next preset page</button>
      </nav>
      {choices.more && choices.page >= 2_000 && <p>The bounded browsing limit is reached; this is not the complete library.</p>}
      {selected && <p>Selected immutable v{selected.versionNumber}, observed library revision {selected.revision}. Current availability and profile limits are checked when copying; later preset edits never follow copied values.</p>}
      <label className="check-field"><input type="checkbox" checked={acknowledged} disabled={props.disabled || pending || !selected || selected.archived}
        onChange={event => setAcknowledgement(event.target.checked ? key : "")} /><span>Replace my unsaved reusable source-preparation settings with this selected preset version.</span></label>
      <div className={styles.actions}><button type="button" disabled={props.disabled || pending || !acknowledged || selected?.archived}
        onClick={() => void copy()}>Copy preset into source settings</button></div>
    </>}
    {pending && <p role="status">Loading reviewed preset values; no source settings are being saved.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
