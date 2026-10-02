import type { PreparationPreview } from "./campaign-preparation-preview-contract";
import styles from "./campaign-preparation-form.module.css";

export function CampaignPreparationPreview({ preview }: { preview: PreparationPreview }) {
  const evidenceById = new Map(preview.evidence.map(item => [item.id, item]));
  return <section className={`${styles.notice} ${styles.preview}`} aria-labelledby="preparation-preview-heading">
    <h2 id="preparation-preview-heading">Unsaved campaign and draft preview</h2>
    <p>Nothing was saved, approved, scheduled or sent. This uses the exact approved package and current settings shown below. Preparing still rechecks them; this preview is not a permission to publish.</p>
    <dl><dt>Campaign</dt><dd>{preview.configuration.name} · Awareness · Draft only</dd>
      <dt>Approved package</dt><dd>{preview.contentPackage.title} · revision {preview.contentPackage.version}</dd>
      <dt>Brand</dt><dd>{preview.brand ? `${preview.brand.name} · v${preview.brand.versionNumber}` : "No Brand Profile selected"}</dd>
      <dt>Destination context</dt><dd>{preview.destination?.title ?? "No Destination selected"} — not a publishing account or inserted link</dd>
      <dt>Presentation</dt><dd>{preview.configuration.informationDepth.replaceAll("_", " ")} depth · {preview.configuration.promotionalStrength.replaceAll("_", " ")} promotion</dd></dl>
    <h3>What preparation would create</h3>
    <ol><li>One draft-only planning Campaign with a manual review step. It cannot run outbound work.</li>
      <li>{preview.variants.length} working, channel-neutral draft{preview.variants.length === 1 ? "" : "s"}, in the audience order below.</li>
      <li>A saved preparation result for recovery. Draft approval, exact channel preview, finalization and launch remain separate.</li></ol>
    <p>No account, attachment or schedule is selected. This deterministic preview makes no model request and reserves no AI spending; it is not a provider-price estimate or a final channel preview.</p>
    {preview.variants.map(variant => <article key={variant.position} className={styles.previewDraft}>
      <h3>{variant.audience.name}{variant.audience.kind === "audience" ? ` · v${variant.audience.versionNumber}` : " audience"}</h3>
      <h4>{variant.draft.headline}</h4><p className={styles.previewCopy}>{variant.draft.body}</p>
      {variant.draft.callToAction && <p><strong>Call to action:</strong> {variant.draft.callToAction}</p>}
      <p>{variant.draft.rationale}</p>
      <details><summary>Evidence behind this draft</summary><ul>{variant.draft.claims.filter(claim => claim.kind === "fact").map((claim, index) =>
        <li key={index}><blockquote>{claim.text}</blockquote>{claim.evidenceItemIds.map(id => {
          const evidence = evidenceById.get(id)!;
          return <div key={id}><span>{evidence.provenance.replaceAll("_", " ")}</span><ul>{evidence.sourceReferences.map((reference, position) => <li key={position}><code>{reference}</code></li>)}</ul></div>;
        })}</li>)}</ul><p>These are approved evidence citations, not independent verification of source truth.</p></details>
    </article>)}
    <details><summary>Preview identity and limits</summary><p>{preview.generator.provider}/{preview.generator.model} · generator {preview.generator.version} · {preview.generator.promptVersion}</p>
      <p>Exact package review: <code>{preview.contentPackage.reviewFingerprint}</code></p>
      <p>Editing settings or reloading the package review clears this preview. Changes made elsewhere are checked again when you preview or prepare; this is a point-in-time observation.</p></details>
  </section>;
}
