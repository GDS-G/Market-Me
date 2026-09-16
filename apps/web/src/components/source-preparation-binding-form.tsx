"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import {
  addSourcePreparationAudience,
  initialSourcePreparationBindingValues,
  isScopedSourcePreparationBinding,
  moveSourcePreparationAudience,
  removeSourcePreparationAudience,
  sourcePreparationBindingRequest,
  sourcePreparationBindingRequestPath,
  type SourcePreparationBindingScope,
  type SourcePreparationBindingValues,
  type SourcePreparationBindingView,
  type SourcePreparationCommandView,
} from "./source-preparation-binding-request";
import { SourcePreparationCommandStatus } from "./source-preparation-command-status";
import styles from "./source-preparation-binding.module.css";

export interface SourcePreparationChoice { id: string; name: string; versionNumber?: number }

export interface SourcePreparationBindingFormProps extends SourcePreparationBindingScope {
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function save() {
    if (!props.canWrite || pending) return;
    setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch(sourcePreparationBindingRequestPath(props), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: sourcePreparationBindingRequest(values),
      });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        setError(typeof payload?.error?.message === "string" ? payload.error.message : "The preparation binding was not saved.");
        return;
      }
      if (!isScopedSourcePreparationBinding(payload?.data, props)) {
        setError("The server returned an invalid preparation binding. Check the current source before saving again.");
        return;
      }
      setBinding(payload.data);
      setValues(initialSourcePreparationBindingValues(props.workspaceId, payload.data));
      setMessage(payload.data.enabled
        ? "Saved. Only a future explicit approval transition can queue a draft-only preparation with these settings."
        : "Disabled for future approval transitions. Commands already queued remain durable and are not canceled.");
      router.refresh();
    } catch {
      setError("The save result is uncertain. Load the current source before trying again; no automatic retry was sent.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <form className="resource-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <section className="form-section">
        <div><h2>Approval-linked draft preparation</h2>
          <p>When enabled, each future explicit approval of an exact Content Package from this source durably queues one General Announcement draft-only preparation using the saved settings. Existing approvals are not processed retroactively.</p></div>
        <fieldset className={styles.fieldset} disabled={!props.canWrite || pending}>
          <div className="field-grid">
            <label className="check-field field-wide"><input type="checkbox" checked={values.enabled} onChange={(event) => setValues({ ...values, enabled: event.target.checked })} /><span>Queue a draft-only preparation after each future exact approval</span></label>
            <label className="field"><span>Campaign name</span><input required maxLength={200} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label>
            <label className="field"><span>Timezone</span><input required maxLength={100} value={values.timezone} onChange={(event) => setValues({ ...values, timezone: event.target.value })} /><small>For example UTC or America/Chicago. This does not schedule or activate anything.</small></label>
            <label className="field field-wide"><span>Description (optional)</span><textarea maxLength={5_000} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} /></label>
            <label className="field"><span>Current published Brand Profile version (optional)</span><select value={values.brandProfileVersionId ?? ""} onChange={(event) => setValues(withOptional(values, "brandProfileVersionId", event.target.value))}>
              <option value="">No Brand Profile</option>
              {values.brandProfileVersionId && !props.brands.some((item) => item.id === values.brandProfileVersionId) && <option value={values.brandProfileVersionId}>Saved Brand version is no longer current</option>}
              {props.brands.map((item) => <option key={item.id} value={item.id}>{choiceLabel(item)}</option>)}
            </select></label>
            <label className="field"><span>Published Destination (optional)</span><select value={values.destinationId ?? ""} onChange={(event) => setValues(withOptional(values, "destinationId", event.target.value))}>
              <option value="">No Destination</option>
              {values.destinationId && !props.destinations.some((item) => item.id === values.destinationId) && <option value={values.destinationId}>Saved Destination is no longer published</option>}
              {props.destinations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select><small>Historical planning context only. External publication still requires a separately approved preview and explicit action.</small></label>
            <label className="field"><span>Information depth</span><select value={values.informationDepth} onChange={(event) => setValues({ ...values, informationDepth: event.target.value as SourcePreparationBindingValues["informationDepth"] })}>
              {INFORMATION_DEPTHS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select></label>
            <label className="field"><span>Promotional strength</span><select value={values.promotionalStrength} onChange={(event) => setValues({ ...values, promotionalStrength: event.target.value as SourcePreparationBindingValues["promotionalStrength"] })}>
              {PROMOTIONAL_STRENGTHS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select></label>
            <AudienceOrderEditor values={values} audiences={props.audiences} onChange={setValues} />
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
      <div className="form-actions"><button className="button-primary" type="submit" disabled={!props.canWrite || pending}>{pending ? "Saving binding…" : binding ? "Save preparation binding" : "Create preparation binding"}</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-help" role="status">{message}</p>}
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
