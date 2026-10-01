"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import {
  addSourcePreparationAudience,
  initialSourcePreparationBindingValues,
  isScopedSourcePreparationPlanPreview,
  moveSourcePreparationAudience,
  removeSourcePreparationAudience,
  sourcePreparationBindingRequest,
  sourcePreparationBindingRequestPath,
  sourcePreparationPlanPreviewRequest,
  sourcePreparationPlanPreviewRequestPath,
  type SourcePreparationBindingScope,
  type SourcePreparationBindingValues,
  type SourcePreparationBindingView,
  type SourcePreparationCommandView,
  type SourcePreparationPlanPreviewView,
} from "./source-preparation-binding-request";
import { SourcePreparationCommandStatus } from "./source-preparation-command-status";
import { SourcePreparationPlanPreview } from "./source-preparation-plan-preview";
import styles from "./source-preparation-binding.module.css";
import { SourcePresetPicker } from "./source-preset-picker";
import { copySourcePresetValues, parseSourcePresetVersion, type SourcePresetChoice } from "./source-preset-copy";
import { presetErrorMessage, presetPayloadData, readPresetResponse } from "./preparation-preset-contract";
import { readSourcePreparationSaveResult } from "./source-preparation-save-result";

export interface SourcePreparationChoice { id: string; name: string; versionNumber?: number }

export interface SourcePreparationBindingFormProps extends SourcePreparationBindingScope {
  sourceVersion: number;
  sourceEnabled: boolean;
  canWrite: boolean;
  initialBinding?: SourcePreparationBindingView;
  commands: readonly SourcePreparationCommandView[];
  brands: readonly SourcePreparationChoice[];
  audiences: readonly SourcePreparationChoice[];
  destinations: readonly { id: string; title: string }[];
}

export function SourcePreparationBindingForm(props: SourcePreparationBindingFormProps) {
  const router = useRouter();
  const [binding, setBinding] = useState(props.initialBinding);
  const [values, setValues] = useState<SourcePreparationBindingValues>(() => initialSourcePreparationBindingValues(props.workspaceId, props.initialBinding));
  const [preview, setPreview] = useState<SourcePreparationPlanPreviewView>();
  const [pending, setPending] = useState<"preview" | "save" | "copy">();
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const copyController = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; copyController.current?.abort(); };
  }, []);

  async function copyPreset(selected: SourcePresetChoice): Promise<boolean> {
    if (!props.canWrite || saveUncertain || inFlight.current || selected.archived) return false;
    inFlight.current = true; setPending("copy"); setError(""); setMessage("");
    const controller = new AbortController(); copyController.current = controller;
    try {
      const response = await fetch(`/api/v1/preparation-presets/${selected.id}/copy-settings`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ workspaceId: props.workspaceId, expectedRevision: selected.revision, versionNumber: selected.versionNumber }),
      });
      const payload = await readPresetResponse(response);
      if (!mounted.current || controller.signal.aborted) return false;
      if (!response.ok) { setError(presetErrorMessage(payload, "This preset could not be copied. Your source settings are unchanged.")); return false; }
      const version = parseSourcePresetVersion(presetPayloadData(payload), props.workspaceId, selected);
      setValues(current => copySourcePresetValues(current, version.configuration));
      setPreview(undefined);
      setMessage(`Copied “${version.title}” v${version.versionNumber} into this form only. Enablement and binding revision are unchanged. Review and preview the settings, then save separately if intended.`);
      return true;
    } catch {
      if (mounted.current && !controller.signal.aborted) setError("No validated preset values were copied. Your source settings and preview are unchanged.");
      return false;
    } finally {
      inFlight.current = false; copyController.current = undefined;
      if (mounted.current) setPending(undefined);
    }
  }

  async function save() {
    if (!props.canWrite || saveUncertain || inFlight.current) return;
    inFlight.current = true;
    setPending("save"); setPreview(undefined); setError(""); setMessage("");
    try {
      const response = await fetch(sourcePreparationBindingRequestPath(props), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: sourcePreparationBindingRequest(values),
      });
      const result = await readSourcePreparationSaveResult(response, props);
      if (!mounted.current) return;
      if (result.kind !== "saved") {
        setSaveUncertain(result.kind === "uncertain");
        setError(result.message);
        return;
      }
      setBinding(result.binding);
      setValues(initialSourcePreparationBindingValues(props.workspaceId, result.binding));
      setMessage(result.binding.enabled
        ? "Saved. Only a future explicit approval transition can queue a draft-only preparation with these settings."
        : "Disabled for future approval transitions. Commands already queued remain durable and are not canceled.");
      router.refresh();
    } catch {
      if (!mounted.current) return;
      setSaveUncertain(true);
      setError("The save result is uncertain. Load the current source before trying again; no automatic retry was sent.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(undefined);
    }
  }

  async function previewPlan() {
    if (!props.canWrite || saveUncertain || inFlight.current) return;
    inFlight.current = true;
    setPending("preview"); setPreview(undefined); setError(""); setMessage("");
    try {
      const response = await fetch(sourcePreparationPlanPreviewRequestPath(props), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: sourcePreparationPlanPreviewRequest(values, props.sourceVersion),
      });
      const payload = await response.json().catch(() => undefined);
      if (!mounted.current) return;
      if (!response.ok) {
        setError(typeof payload?.error?.message === "string"
          ? `Preview blocked: ${payload.error.message}`
          : "The current settings could not be previewed.");
        return;
      }
      if (!isScopedSourcePreparationPlanPreview(payload?.data, props) || payload.data.source.version !== props.sourceVersion) {
        setError("The server returned an invalid preparation preview. Reload this Smart Source before trying again.");
        return;
      }
      setPreview(payload.data);
      setMessage("Previewed from the current unsaved form values. Saving remains a separate action.");
    } catch {
      if (!mounted.current) return;
      setError("The preview result is uncertain. No automatic retry was sent and no settings were saved.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(undefined);
    }
  }

  function changeValues(next: SourcePreparationBindingValues) {
    setValues(next);
    setPreview(undefined);
    setError("");
    setMessage("");
  }

  return <>
    <form className="resource-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {props.canWrite && <SourcePresetPicker key={`${props.workspaceId}:${props.smartSourceId}:${props.sourceVersion}:${binding?.revision ?? 0}`}
        workspaceId={props.workspaceId} smartSourceId={props.smartSourceId} disabled={Boolean(pending) || saveUncertain} onCopy={copyPreset} />}
      {saveUncertain && <section className={styles.notice} aria-label="Uncertain preparation binding save">
        <h2>Load current settings before continuing</h2><p>A previous save may have succeeded. Preset copying, preview and further saves are locked until this page loads current server state. Existing queued work is not changed.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload current source settings</button>
      </section>}
      <section className="form-section">
        <div><h2>Approval-linked draft preparation</h2>
          <p>When enabled, each future explicit approval of an exact Content Package from this source durably queues one General Announcement draft-only preparation using the saved settings. Existing approvals are not processed retroactively.</p></div>
        <fieldset className={styles.fieldset} disabled={!props.canWrite || Boolean(pending) || saveUncertain}>
          <div className="field-grid">
            <label className="check-field field-wide"><input type="checkbox" checked={values.enabled} onChange={(event) => changeValues({ ...values, enabled: event.target.checked })} /><span>Queue a draft-only preparation after each future exact approval</span></label>
            <label className="field"><span>Campaign name</span><input required maxLength={200} value={values.name} onChange={(event) => changeValues({ ...values, name: event.target.value })} /></label>
            <label className="field"><span>Timezone</span><input required maxLength={100} value={values.timezone} onChange={(event) => changeValues({ ...values, timezone: event.target.value })} /><small>For example UTC or America/Chicago. This does not schedule or activate anything.</small></label>
            <label className="field field-wide"><span>Description (optional)</span><textarea maxLength={5_000} value={values.description} onChange={(event) => changeValues({ ...values, description: event.target.value })} /></label>
            <label className="field"><span>Current published Brand Profile version (optional)</span><select value={values.brandProfileVersionId ?? ""} onChange={(event) => changeValues(withOptional(values, "brandProfileVersionId", event.target.value))}>
              <option value="">No Brand Profile</option>
              {values.brandProfileVersionId && !props.brands.some((item) => item.id === values.brandProfileVersionId) && <option value={values.brandProfileVersionId}>Saved Brand version is no longer current</option>}
              {props.brands.map((item) => <option key={item.id} value={item.id}>{choiceLabel(item)}</option>)}
            </select></label>
            <label className="field"><span>Published Destination (optional)</span><select value={values.destinationId ?? ""} onChange={(event) => changeValues(withOptional(values, "destinationId", event.target.value))}>
              <option value="">No Destination</option>
              {values.destinationId && !props.destinations.some((item) => item.id === values.destinationId) && <option value={values.destinationId}>Saved Destination is no longer published</option>}
              {props.destinations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select><small>Historical planning context only. External publication still requires a separately approved preview and explicit action.</small></label>
            <label className="field"><span>Information depth</span><select value={values.informationDepth} onChange={(event) => changeValues({ ...values, informationDepth: event.target.value as SourcePreparationBindingValues["informationDepth"] })}>
              {INFORMATION_DEPTHS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select></label>
            <label className="field"><span>Promotional strength</span><select value={values.promotionalStrength} onChange={(event) => changeValues({ ...values, promotionalStrength: event.target.value as SourcePreparationBindingValues["promotionalStrength"] })}>
              {PROMOTIONAL_STRENGTHS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select></label>
            <AudienceOrderEditor values={values} audiences={props.audiences} onChange={changeValues} />
          </div>
        </fieldset>
      </section>
      <section className={styles.notice} aria-label="Preparation safety boundary">
        <p><strong>Future approvals only.</strong> Saving, editing, enabling, or disabling this binding never processes an existing approval.</p>
        <p><strong>Queued commands are durable snapshots.</strong> A later edit or disable affects only later approval transitions and does not cancel work already queued.</p>
        <p><strong>Draft-only boundary.</strong> Preparation does not approve or finalize a Campaign or draft, activate a Campaign, create an external publication action, send content, or call a provider.</p>
        {!props.sourceEnabled && <p><strong>Source synchronization is paused.</strong> That setting controls content intake only; it does not disable this separate binding. Future explicit approvals can still queue draft-only preparation while the binding is enabled.</p>}
      </section>
      {!props.canWrite && <p className="form-help">Read-only access. Owners, admins, and editors can configure approval-linked preparation.</p>}
      {binding && <p className="form-help">Saved binding revision {binding.revision}. Last updated <time dateTime={binding.updatedAt}>{binding.updatedAt}</time>.</p>}
      <div className="form-actions">
        <button className="button-secondary" type="button" disabled={!props.canWrite || Boolean(pending) || saveUncertain} onClick={() => void previewPlan()}>
          {pending === "preview" ? "Previewing setup…" : "Preview this setup"}
        </button>
        <button className="button-primary" type="submit" disabled={!props.canWrite || Boolean(pending) || saveUncertain}>
          {pending === "save" ? "Saving binding…" : binding ? "Save preparation binding" : "Create preparation binding"}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-help" role="status">{message}</p>}
      {preview && <SourcePreparationPlanPreview preview={preview} />}
    </form>
    <SourcePreparationCommandHistory workspaceId={props.workspaceId} commands={props.commands} />
  </>;
}

function AudienceOrderEditor({ values, audiences, onChange }: {
  values: SourcePreparationBindingValues;
  audiences: readonly SourcePreparationChoice[];
  onChange: (values: SourcePreparationBindingValues) => void;
}) {
  return <fieldset className={`${styles.audiences} field-wide`}>
    <legend>Current published Audience Profile versions (optional)</legend>
    <p>Selected order is retained and determines generated audience-variant order. No selection produces one General audience draft.</p>
    <div className={styles.availableAudiences}>
      {audiences.map((audience) => <label key={audience.id}><input type="checkbox" checked={values.audienceProfileVersionIds.includes(audience.id)}
        onChange={(event) => onChange({ ...values, audienceProfileVersionIds: event.target.checked
          ? addSourcePreparationAudience(values.audienceProfileVersionIds, audience.id)
          : removeSourcePreparationAudience(values.audienceProfileVersionIds, audience.id) })} />{choiceLabel(audience)}</label>)}
      {!audiences.length && <span>No current published Audience Profile versions are available.</span>}
    </div>
    {values.audienceProfileVersionIds.length > 0 && <ol className={styles.orderedAudiences}>
      {values.audienceProfileVersionIds.map((id, index) => {
        const audience = audiences.find((item) => item.id === id);
        return <li key={id}><div className={styles.orderedAudienceRow}><span>{audience ? choiceLabel(audience) : `Unavailable saved Audience version (${id})`}</span>
          <div className={styles.audienceActions}>
            <button className="button-secondary" type="button" disabled={index === 0} aria-label={`Move ${audience?.name ?? id} earlier`} onClick={() => onChange({ ...values, audienceProfileVersionIds: moveSourcePreparationAudience(values.audienceProfileVersionIds, id, -1) })}>Up</button>
            <button className="button-secondary" type="button" disabled={index === values.audienceProfileVersionIds.length - 1} aria-label={`Move ${audience?.name ?? id} later`} onClick={() => onChange({ ...values, audienceProfileVersionIds: moveSourcePreparationAudience(values.audienceProfileVersionIds, id, 1) })}>Down</button>
            <button className="button-secondary" type="button" onClick={() => onChange({ ...values, audienceProfileVersionIds: removeSourcePreparationAudience(values.audienceProfileVersionIds, id) })}>Remove</button>
          </div></div></li>;
      })}
    </ol>}
  </fieldset>;
}

export function SourcePreparationCommandHistory({ workspaceId, commands }: { workspaceId: string; commands: readonly SourcePreparationCommandView[] }) {
  return <section className={`resource-panel ${styles.history}`}><h2>Recent durable preparation commands</h2>
    <p>Each row is the immutable snapshot queued by one exact approval transition. Later binding edits or disablement do not change or cancel it.</p>
    {!commands.length ? <p>No approval-linked preparation command has been queued for this source.</p> : <div className={styles.commands}>{commands.map((command, index) => <SourcePreparationCommandStatus
      key={`${command.contentPackageId}:${command.contentPackageVersion}:${command.bindingRevision}:${command.createdAt}:${index}`}
      workspaceId={workspaceId} command={command} showPackageLink />)}</div>}
  </section>;
}

function choiceLabel(choice: SourcePreparationChoice): string {
  return `${choice.name}${choice.versionNumber === undefined ? "" : ` · v${choice.versionNumber}`}`;
}

function withOptional(values: SourcePreparationBindingValues, field: "brandProfileVersionId" | "destinationId", value: string): SourcePreparationBindingValues {
  const next = { ...values };
  delete next[field];
  return value ? { ...next, [field]: value } : next;
}
