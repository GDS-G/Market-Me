import type { ExactPreviewSnapshotV1 } from "@market-me/database";
import styles from "./campaign-preparation-form.module.css";

export function ExactPreviewDisplay({ snapshot, fingerprint, connectionName, historical = false }: {
  snapshot: ExactPreviewSnapshotV1; fingerprint: string; connectionName?: string; historical?: boolean;
}) {
  return <section className={styles.receipt} aria-labelledby="exact-preview-heading">
    <div><h2 id="exact-preview-heading">{historical ? "Captured exact preview" : "Review this exact preview"}</h2>
      <p>{historical ? "This is the immutable finalization snapshot, not a fresh eligibility check." : "These bytes, account identity, and fingerprint came from one current server selection. Finalization checks them again."}</p></div>
    <div className={styles.notice} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{snapshot.preview.renderedContent}</div>
    <dl><dt>Provider / account</dt><dd>{snapshot.connection.provider.replaceAll("_", " ")}{connectionName ? ` · ${connectionName} (current display label)` : ""}</dd>
      {Object.entries(snapshot.connection.identity).map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{key}</dt><dd>{value ?? "Not applicable"}</dd></div>)}
      <dt>Characters</dt><dd>{snapshot.preview.characterCount}{snapshot.preview.characterLimit === null ? "" : ` / ${snapshot.preview.characterLimit}`}</dd>
      <dt>Destination</dt><dd>{snapshot.destination?.canonicalUrl ?? "No Destination"}</dd>
      <dt>Link mode</dt><dd>{snapshot.preview.linkMode}{snapshot.trackedLink && <small>{snapshot.trackedLink.publicRedirectUrl} · expires {snapshot.trackedLink.expiresAtUtcMicros ?? "without a fixed expiry"}</small>}</dd>
      <dt>Attachments</dt><dd>None · text only</dd>
      <dt>Preview captured at</dt><dd>{snapshot.preview.createdAtUtcMicros}</dd>
    </dl>
    <details><summary>Exact review identifiers</summary><dl><dt>Fingerprint</dt><dd>{fingerprint}</dd><dt>Preview</dt><dd>{snapshot.lineage.previewId}</dd><dt>Approved draft version</dt><dd>{snapshot.lineage.contentDraftVersionId}</dd><dt>Capability observation</dt><dd>{snapshot.preview.capabilityObservedAtUtcMicros}</dd></dl></details>
  </section>;
}
