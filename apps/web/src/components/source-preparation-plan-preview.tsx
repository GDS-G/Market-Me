import type { SourcePreparationPlanPreviewView } from "./source-preparation-binding-request";
import styles from "./source-preparation-binding.module.css";

export function SourcePreparationPlanPreview({ preview }: { preview: SourcePreparationPlanPreviewView }) {
  const reviewStep = preview.campaign.steps[0];
  return <section className={`resource-panel ${styles.preview}`} aria-label="Preparation plan preview" aria-live="polite">
    <div className={styles.previewHeader}>
      <div>
        <p className={styles.previewEyebrow}>Preview this setup</p>
        <h2>Your preparation plan</h2>
      </div>
      <span className={preview.enabled ? styles.previewReady : styles.previewPaused}>
        {preview.enabled ? "Ready to save" : "Proposed setting: disabled"}
      </span>
    </div>

    <p>This preview shows what your current form settings would do. Save separately to apply them. Your saved settings stay in effect until then.</p>

    <div className={styles.previewFlow}>
      <div><strong>1. Future trigger</strong><span>{preview.enabled
        ? "A later explicit approval of an exact Content Package from this Smart Source can queue preparation after these settings are saved."
        : "If you save these disabled settings, later approvals will not queue new preparation. Work already queued is unaffected."}</span></div>
      <div><strong>2. Draft-only preparation</strong><span>When enabled, General Announcement v{preview.template.version} creates one planning Campaign and the draft variants below, ready for review.</span></div>
      <div><strong>3. Manual review</strong><span>{reviewStep.name} through a manual approval handoff. Human review remains required.</span></div>
    </div>

    <dl className={styles.previewDetails}>
      <div><dt>Smart Source</dt><dd>{preview.source.name} · v{preview.source.version} · {preview.source.enabled ? "sync enabled" : "synchronization paused"}</dd></div>
      <div><dt>Campaign name</dt><dd>{preview.template.name}</dd></div>
      <div><dt>Description</dt><dd>{preview.template.description || "No description"}</dd></div>
      <div><dt>Objective</dt><dd>{preview.campaign.objective}</dd></div>
      <div><dt>Information depth</dt><dd>{displayChoice(preview.settings.informationDepth)}</dd></div>
      <div><dt>Promotional strength</dt><dd>{displayChoice(preview.settings.promotionalStrength)}</dd></div>
      <div><dt>Timezone</dt><dd>{preview.settings.timezone}</dd></div>
      <div><dt>Brand</dt><dd>{preview.brandProfile ? `${preview.brandProfile.name} · v${preview.brandProfile.versionNumber}${preview.brandProfile.current ? "" : " · no longer current"}` : "No Brand Profile"}</dd></div>
      <div><dt>Destination</dt><dd>{preview.destination ? `${preview.destination.title}${preview.destination.current ? "" : " · no longer published"}` : "No Destination"}</dd></div>
    </dl>

    <div className={styles.previewVariants}>
      <h3>Proposed draft variants</h3>
      <ol>{preview.draftVariants.map((variant, index) => <li key={`${variant.kind}:${index}`}>
        {variant.kind === "audience" ? `${variant.label} · v${variant.versionNumber}${variant.current ? "" : " · no longer current"}` : variant.label}
      </li>)}</ol>
      <p>{preview.draftVariants.length === 1 && preview.draftVariants[0]?.kind === "general"
        ? "No Audience Profile is selected, so the plan contains one General draft."
        : "Audience variants retain the authored order shown here."}</p>
    </div>

    {preview.referenceValidation === "retained_for_disabled_safe_stop" && <p className={styles.previewAdvisory} role="status">
      <strong>Some saved selections are out of date.</strong> You can still save these disabled settings to stop future preparation. Choose current published selections before enabling preparation again.
    </p>}

    <div className={styles.previewBoundary}>
      <h3>Ready for review</h3>
      <p>Previewing creates no Campaign or drafts. Actual wording is generated from an approved Content Package during preparation. Preparation leaves the result <strong>Prepared—not activated</strong>; review, approval, and launch remain separate steps.</p>
    </div>
  </section>;
}

function displayChoice(value: string): string {
  return value.replaceAll("_", " ");
}
